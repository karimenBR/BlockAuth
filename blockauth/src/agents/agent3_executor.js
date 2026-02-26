'use strict';

/**
 * ══════════════════════════════════════════════════════════════
 *  AGENT 3 — ACTION EXECUTOR
 *
 *  Receives the risk classification from Agent 2 and decides
 *  what action to enforce. If OTP is required it calls Agent 4.
 *
 *  Decision table:
 *  ┌──────────┬────────────────────────────────────────────────┐
 *  │ LOW      │ ALLOW — issue JWT, log event                   │
 *  │ MEDIUM   │ OTP_REQUIRED — suspend session, call Agent 4   │
 *  │ CRITICAL │ OTP_REQUIRED — suspend session, call Agent 4   │
 *  │          │  + send security alert email regardless        │
 *  └──────────┴────────────────────────────────────────────────┘
 *
 *  Note: "block without OTP" is a separate outcome produced when
 *  Agent 4 reports too many failed attempts.
 * ══════════════════════════════════════════════════════════════
 */

const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const redis  = require('../utils/redis');
const agent4 = require('./agent4_otp');
const mailer = require('../utils/mailer');
const logger = require('../utils/logger');

const SESSION_TTL = 60 * 60;       // 1 hour for active sessions

/**
 * @param {object} riskResult  - { score, level, reasons } from Agent 2
 * @param {object} loginCtx    - { wallet, email, phone, ip, geo, device, timestamp }
 * @returns {object}           - action result
 */
async function execute(riskResult, loginCtx) {
  const { level, score, reasons } = riskResult;
  const { wallet, email, phone, ip, geo, device, timestamp, did } = loginCtx;

  // ── Always register/update session tracking ───────────────
  await trackSession(wallet, { ip, geo, timestamp });

  switch (level) {

    // ── LOW ────────────────────────────────────────────────────
    case 'LOW': {
      const token = issueJWT(wallet, loginCtx);
      await logEvent(wallet, 'ALLOWED', { score, ip, geo });

      logger.info(`[Agent3] ALLOW wallet=${wallet.slice(0,10)}… score=${score}`);

      return {
        action      : 'ALLOW',
        accessToken : token,
        expiresIn   : process.env.JWT_EXPIRES_IN || '1h',
        riskScore   : score,
        message     : 'Authentication successful.',
      };
    }

    // ── MEDIUM / CRITICAL ──────────────────────────────────────
    case 'MEDIUM':
    case 'CRITICAL': {
      // Suspend: issue a pending token (not a full session token)
      const pendingToken = issuePendingToken(wallet, did);

      // For CRITICAL, also fire an immediate alert email in background
      if (level === 'CRITICAL' && email) {
        sendCriticalAlert(email, { wallet, ip, geo, device, reasons }).catch(
          err => logger.error('[Agent3] Critical alert email failed:', err.message)
        );
      }

      // Call Agent 4 to generate and dispatch OTP
      const otpResult = await agent4.initiate({ wallet, email, phone, ip, geo, level });

      await logEvent(wallet, 'OTP_REQUIRED', { score, level, ip, geo });

      logger.info(`[Agent3] OTP_REQUIRED wallet=${wallet.slice(0,10)}… level=${level}`);

      return {
        action        : 'OTP_REQUIRED',
        pendingToken,             // platform holds this, submits with OTP verify call
        otpChannel    : otpResult.channels,
        otpExpiresIn  : Number(process.env.OTP_TTL_SECONDS) || 300,
        riskScore     : score,
        riskLevel     : level,
        reasons       : reasons.map(r => r.detail),
        message       : level === 'CRITICAL'
          ? 'Suspicious login detected. A verification code has been sent. A security alert has also been dispatched.'
          : 'Login from an unrecognised location or device. Please verify with the code sent to you.',
      };
    }

    default:
      throw new Error(`Unknown risk level: ${level}`);
  }
}

/**
 * Issue a full JWT session token (LOW risk path).
 */
function issueJWT(wallet, ctx) {
  const payload = {
    sub    : wallet.toLowerCase(),
    ip     : ctx.ip,
    geo    : ctx.geo?.country,
    device : ctx.device?.browser,
    iat    : Math.floor(Date.now() / 1000),
  };
  if (ctx.did) payload.did = ctx.did;

  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );
}

/**
 * Issue a short-lived "pending verification" token.
 * It only unlocks the OTP verify endpoint, not the platform.
 */
function issuePendingToken(wallet, did) {
  const payload = { sub: wallet.toLowerCase(), type: 'pending_otp' };
  if (did) payload.did = did;

  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: `${Number(process.env.OTP_TTL_SECONDS) || 300}s` }
  );
}

async function trackSession(wallet, { ip, geo, timestamp }) {
  const key  = `blockauth:sessions:${wallet.toLowerCase()}`;
  const list = (await redis.getJSON(key)) || [];
  list.unshift({ ip, geo, timestamp });
  if (list.length > 5) list.splice(5);
  await redis.setJSON(key, list, SESSION_TTL);
}

async function logEvent(wallet, action, meta) {
  const key = `blockauth:eventlog:${wallet.toLowerCase()}`;
  const log = (await redis.getJSON(key)) || [];
  log.unshift({ action, ...meta, ts: Date.now() });
  if (log.length > 100) log.splice(100);
  await redis.setJSON(key, log, 90 * 24 * 60 * 60);   // 90 days
}

async function sendCriticalAlert(email, { wallet, ip, geo, device, reasons }) {
  const locationStr = geo
    ? `${geo.city}, ${geo.country}`
    : ip;

  await mailer.sendSecurityAlert({
    to      : email,
    wallet,
    ip,
    location: locationStr,
    device  : `${device?.browser || 'Unknown'} / ${device?.os || 'Unknown'}`,
    reasons : reasons.map(r => r.detail),
  });
}

module.exports = { execute };
