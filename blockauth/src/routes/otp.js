'use strict';

/**
 * ══════════════════════════════════════════════════════════════
 *  OTP ROUTES
 *
 *  POST /otp/verify   → submit OTP code, get access token
 *  POST /otp/resend   → request a fresh OTP (rate-limited)
 * ══════════════════════════════════════════════════════════════
 */

const express   = require('express');
const rateLimit = require('express-rate-limit');
const jwt       = require('jsonwebtoken');

const agent4    = require('../agents/agent4_otp');
const redis     = require('../utils/redis');
const logger    = require('../utils/logger');

const router = express.Router();

/**
 * Extract the address portion from a did:ethr identifier
 */
function extractAddressFromDID(did) {
  const parts = did.split(':');
  return parts[parts.length - 1];
}

// Strict rate-limit on verify: max 10 per wallet per 15 min
const verifyLimiter = rateLimit({
  windowMs   : 15 * 60 * 1000,
  max        : 10,
  keyGenerator: (req) => req.body?.wallet || req.ip,
  message    : { error: 'Too many verification attempts.' },
});

// Resend: max 3 per 10 min
const resendLimiter = rateLimit({
  windowMs   : 10 * 60 * 1000,
  max        : 3,
  keyGenerator: (req) => req.body?.wallet || req.ip,
  message    : { error: 'Too many resend requests. Please wait.' },
});

// ─────────────────────────────────────────────────────────────
//  POST /otp/verify
//
//  Body: {
//    wallet       : "0x...",
//    code         : "123456",
//    pendingToken : "<JWT from /auth/login OTP_REQUIRED response>"
//  }
//
//  Returns:
//    { success: true,  action: "VERIFIED",    accessToken, expiresIn }
//    { success: false, action: "WRONG_CODE",  attemptsLeft, message }
//    { success: false, action: "HARD_BLOCK",  message }
//    { success: false, action: "OTP_EXPIRED", message }
// ─────────────────────────────────────────────────────────────
router.post('/verify', verifyLimiter, async (req, res, next) => {
  try {
    const { wallet, code, pendingToken } = req.body;

    if (!wallet || !code || !pendingToken) {
      return res.status(400).json({
        error: 'wallet, code, and pendingToken are all required.',
      });
    }

    if (!/^[0-9]{4,8}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid code format.' });
    }

    // Pre-verify the pending token to check DID consistency
    try {
      const decoded = jwt.verify(pendingToken, process.env.JWT_SECRET);
      
      // If DID is present, verify it matches the wallet
      if (decoded.did) {
        const didAddress = extractAddressFromDID(decoded.did);
        if (didAddress.toLowerCase() !== wallet.toLowerCase()) {
          logger.warn(`[OTP] DID verification failed: DID=${decoded.did}, wallet=${wallet}`);
          return res.status(401).json({ 
            error: 'DID verification failed: DID does not match wallet.' 
          });
        }
      }
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired pending token.' });
    }

    const result = await agent4.verify({
      wallet,
      submittedCode: code,
      pendingToken,
    });

    const statusCode = result.success ? 200 : result.action === 'HARD_BLOCK' ? 403 : 401;
    return res.status(statusCode).json(result);

  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /otp/resend
//
//  Body: {
//    wallet       : "0x...",
//    pendingToken : "<JWT from /auth/login response>",
//    channel      : "email" | "sms"   // optional, defaults to all
//  }
// ─────────────────────────────────────────────────────────────
router.post('/resend', resendLimiter, async (req, res, next) => {
  try {
    const { wallet, pendingToken, channel } = req.body;

    if (!wallet || !pendingToken) {
      return res.status(400).json({ error: 'wallet and pendingToken are required.' });
    }

    // Load the stored OTP context (must exist and not be expired)
    const stored = await redis.getJSON(`blockauth:otp:${wallet.toLowerCase()}`);
    if (!stored) {
      return res.status(410).json({
        error: 'OTP session expired. Please log in again.',
      });
    }

    // We don't expose the stored hash — we can't re-send the same code
    // safely without the plaintext. Generate a fresh one instead.
    // The user's email/phone must come from the pending JWT claims.
    let decoded;
    try {
      decoded = jwt.verify(pendingToken, process.env.JWT_SECRET);
      
      // Verify DID if present
      if (decoded.did) {
        const didAddress = extractAddressFromDID(decoded.did);
        if (didAddress.toLowerCase() !== wallet.toLowerCase()) {
          logger.warn(`[OTP] Resend DID verification failed: DID=${decoded.did}, wallet=${wallet}`);
          return res.status(401).json({ 
            error: 'DID verification failed: DID does not match wallet.' 
          });
        }
      }
    } catch {
      return res.status(401).json({ error: 'Pending token expired.' });
    }

    // Re-initiate — this generates a new code and resets the attempt counter
    // NOTE: email/phone are expected to be stored in the pending JWT
    // (populated during /auth/login — set these in agent3 if you persist them)
    const email = decoded.email || null;
    const phone = decoded.phone || null;

    if (!email && !phone) {
      return res.status(422).json({
        error: 'No contact information on file to resend OTP.',
      });
    }

    const otpResult = await agent4.initiate({
      wallet,
      email : channel === 'sms'   ? null  : email,
      phone : channel === 'email' ? null  : phone,
      ip    : decoded.ip    || 'unknown',
      geo   : decoded.geo   || null,
      level : stored.level  || 'MEDIUM',
    });

    logger.info(`[OTP/resend] New code dispatched for wallet=${wallet.slice(0,10)}… channels=${otpResult.channels}`);

    return res.json({
      success  : true,
      channels : otpResult.channels,
      message  : 'A new verification code has been sent.',
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
