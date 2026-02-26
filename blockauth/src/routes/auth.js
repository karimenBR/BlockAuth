'use strict';

/**
 * ══════════════════════════════════════════════════════════════
 *  AUTH ROUTES
 *
 *  POST /auth/nonce      → generate SIWE nonce for wallet
 *  POST /auth/login      → verify SIWE signature → run all 4 agents
 *  GET  /auth/me         → decode and return current JWT claims
 * ══════════════════════════════════════════════════════════════
 */

const express  = require('express');
const { SiweMessage } = require('siwe');
const rateLimit = require('express-rate-limit');
const crypto   = require('crypto');
const jwt      = require('jsonwebtoken');

const redis    = require('../utils/redis');
const agent1   = require('../agents/agent1_detector');
const agent2   = require('../agents/agent2_scorer');
const agent3   = require('../agents/agent3_executor');
const logger   = require('../utils/logger');

const router   = express.Router();

const DID_REGEX = /^did:ethr(?::[a-zA-Z0-9]+)?:0x[0-9a-fA-F]{40}$/;

/**
 * Extract the address portion from a did:ethr identifier
 * e.g., "did:ethr:0xAbc..." or "did:ethr:mainnet:0xAbc..." → "0xAbc..."
 */
function extractAddressFromDID(did) {
  const parts = did.split(':');
  // did:ethr:0xAddr or did:ethr:network:0xAddr
  return parts[parts.length - 1];
}

// Tighter rate limit on login endpoint
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,   // 10 min
  max     : 20,
  message : { error: 'Too many login attempts. Try again in 10 minutes.' },
  keyGenerator: (req) => req.body?.address || req.ip,
});

// ── Nonce key helpers ─────────────────────────────────────────
const nonceKey = (nonce) => `blockauth:nonce:${nonce}`;
const NONCE_TTL = 5 * 60;   // 5 minutes

// ─────────────────────────────────────────────────────────────
//  POST /auth/nonce
//  Body: { address: "0x..." }
//  Returns: { nonce }
// ─────────────────────────────────────────────────────────────
router.post('/nonce', async (req, res, next) => {
  try {
    const { address } = req.body;

    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Valid Ethereum address required.' });
    }

    const nonce = crypto.randomBytes(16).toString('hex');

    // Store nonce bound to address so it can't be replayed
    await redis.setJSON(nonceKey(nonce), { address: address.toLowerCase(), used: false }, NONCE_TTL);

    return res.json({ nonce });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /auth/login
//
//  Body: {
//    message   : <SIWE message string>,
//    signature : <wallet signature>,
//    email     : "user@example.com",   // optional but needed for OTP
//    phone     : "+21612345678",       // optional
//  }
//
//  Returns one of:
//    { action: "ALLOW",        accessToken, expiresIn, riskScore }
//    { action: "OTP_REQUIRED", pendingToken, otpChannel, riskScore, riskLevel }
// ─────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { message: rawMessage, signature, email, phone, did } = req.body;

    if (did && !DID_REGEX.test(did)) {
      return res.status(400).json({ error: 'Invalid DID format. Expected did:ethr.' });
    }

    if (!rawMessage || !signature) {
      return res.status(400).json({ error: 'message and signature are required.' });
    }

    // ── Step 1: Parse and verify SIWE message ─────────────
    let siweMessage;
    try {
      siweMessage = new SiweMessage(rawMessage);
    } catch {
      return res.status(400).json({ error: 'Invalid SIWE message format.' });
    }

    // Validate signature
    let verifyResult;
    try {
  verifyResult = await siweMessage.verify({ signature });
    } catch (verifyErr) {
      logger.warn(`[Auth] SIWE verify error: ${verifyErr.type || verifyErr.message}`);
      return res.status(401).json({ error: 'Signature verification failed.' });
    }

    if (!verifyResult.success) {
      return res.status(401).json({ error: 'Invalid signature.' });
    }

    const { address: wallet, nonce, domain } = siweMessage;

    // ── Step 1.5: Verify DID matches wallet (if provided) ─
    if (did) {
      const didAddress = extractAddressFromDID(did);
      if (didAddress.toLowerCase() !== wallet.toLowerCase()) {
        logger.warn(`[Auth] DID verification failed: DID=${did}, wallet=${wallet}`);
        return res.status(401).json({ 
          error: 'DID verification failed: DID address does not match wallet address.' 
        });
      }
      logger.info(`[Auth] DID verified: ${did}`);
    }

    // ── Step 2: Validate nonce (replay protection) ────────
    const storedNonce = await redis.getJSON(nonceKey(nonce));

    if (!storedNonce) {
      return res.status(401).json({ error: 'Nonce expired or invalid.' });
    }
    if (storedNonce.used) {
      return res.status(401).json({ error: 'Nonce already used.' });
    }
    if (storedNonce.address !== wallet.toLowerCase()) {
      return res.status(401).json({ error: 'Nonce address mismatch.' });
    }

    // Mark nonce as used (prevents replay)
    await redis.setJSON(nonceKey(nonce), { ...storedNonce, used: true }, 60);

    // ── Step 3: Build login context ───────────────────────
    const ip        = getClientIP(req);
    const userAgent = req.headers['user-agent'] || '';
    const timestamp = Date.now();

    const loginEvent = { wallet, ip, userAgent, timestamp, did };


    if (process.env.NODE_ENV !== 'production') {
    const spoofIP = req.headers['x-test-spoof-ip'];
    if (spoofIP) loginEvent.ip = spoofIP;

    const rawSignals = req.headers['x-test-signals'];
    if (rawSignals) {
      try {
        const injected = JSON.parse(rawSignals);
        const { signals, geo, device } = await agent1.detect(loginEvent);
        const allSignals = [...injected, ...signals];
        const riskResult = agent2.score(allSignals, { wallet });
        const actionResult = await agent3.execute(riskResult, {
          wallet, email, phone, did,
          ip: loginEvent.ip, geo, device, timestamp,
        });
        return res.json(actionResult);
      } catch {}
    }
}

    // ── Step 4: Run Agent 1 — Anomaly Detection ───────────
    logger.info(`[Pipeline] Starting for wallet=${wallet.slice(0,10)}… ip=${ip}`);
    const { signals, geo, device } = await agent1.detect(loginEvent);

    // ── Step 5: Run Agent 2 — Risk Scoring ────────────────
    const riskResult = agent2.score(signals, { wallet });

    // ── Step 6: Run Agent 3 — Action (may trigger Agent 4) ─
    const actionResult = await agent3.execute(riskResult, {
      wallet, email, phone, did, ip, geo, device, timestamp,
    });

    logger.info(
      `[Pipeline] Done wallet=${wallet.slice(0,10)}… ` +
      `score=${riskResult.score} action=${actionResult.action}`
    );

    return res.json(actionResult);

  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /auth/me
//  Header: Authorization: Bearer <accessToken>
//  Returns decoded JWT claims (for the integrating platform to use)
// ─────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'No token provided.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Additional verification: if DID is present, ensure it matches the wallet
    if (decoded.did) {
      const didAddress = extractAddressFromDID(decoded.did);
      if (didAddress.toLowerCase() !== decoded.sub.toLowerCase()) {
        logger.warn(`[Auth] Token DID mismatch: DID=${decoded.did}, wallet=${decoded.sub}`);
        return res.status(401).json({ error: 'Token validation failed: DID mismatch.' });
      }
    }
    
    return res.json({
      wallet   : decoded.sub,
      did      : decoded.did || null,
      didVerified: !!decoded.did,
      mfaVerified: !!decoded.mfa,
      issuedAt : new Date(decoded.iat * 1000).toISOString(),
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
    });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
});

// ── Helpers ───────────────────────────────────────────────────
function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip']                              ||
    req.socket?.remoteAddress                             ||
    '127.0.0.1'
  );
}

module.exports = router;
