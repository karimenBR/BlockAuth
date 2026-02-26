'use strict';

/**
 * ══════════════════════════════════════════════════════════════
 *  AGENT 4 — OTP GENERATOR & VERIFIER
 *
 *  Responsibilities:
 *    1. Generate a CSPRNG 6-digit code
 *    2. Store HMAC-SHA256 hash in Redis with TTL
 *    3. Dispatch plaintext code via Email (SendGrid) + SMS (Twilio)
 *    4. On verify() call: validate hash, track attempts, block on excess
 *    5. Issue a full JWT when verification passes
 *    6. Clean up Redis state after success or expiry
 * ══════════════════════════════════════════════════════════════
 */

const jwt    = require('jsonwebtoken');
const redis  = require('../utils/redis');
const { generateOTP, hashOTP, verifyOTP, generateSalt } = require('../utils/otp');
const mailer = require('../utils/mailer');
const sms    = require('../utils/sms');
const logger = require('../utils/logger');

const OTP_TTL      = Number(process.env.OTP_TTL_SECONDS)  || 300;   // 5 min
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) || 3;

/**
 * Extract the address portion from a did:ethr identifier
 */
function extractAddressFromDID(did) {
  const parts = did.split(':');
  return parts[parts.length - 1];
}

// Redis key helpers
const otpKey      = (wallet) => `blockauth:otp:${wallet.toLowerCase()}`;
const attemptsKey = (wallet) => `blockauth:otp_attempts:${wallet.toLowerCase()}`;

/**
 * Initiate an OTP challenge.
 * Called by Agent 3 when risk is MEDIUM or CRITICAL.
 *
 * @param {object} ctx - { wallet, email, phone, ip, geo, level }
 * @returns {object}   - { channels } e.g. { channels: ['email', 'sms'] }
 */
// In initiate() function, before the email try/catch

async function initiate(ctx) {
  const { wallet, email, phone, ip, geo, level } = ctx;
  
  const otp  = generateOTP();
  const salt = generateSalt();
  const hash = hashOTP(otp, salt);
  console.log('=== OTP DEBUG ===');
  console.log('email:', email);
  console.log('phone:', phone);
  console.log('otp:', otp);  // TEMP — remove in production
  console.log('EMAIL_FROM:', process.env.EMAIL_FROM);
  console.log('GMAIL_APP_PASSWORD set:', !!process.env.GMAIL_APP_PASSWORD);
  // Store hash + salt in Redis (NEVER plaintext)
  await redis.setJSON(otpKey(wallet), { hash, salt, wallet, level }, OTP_TTL);

  // Reset attempt counter
  await redis.del(attemptsKey(wallet));

  const channels = [];
  const locationStr = geo ? `${geo.city}, ${geo.country}` : ip;

  // ── Dispatch via email ────────────────────────────────────
  if (email) {
    try {
      await mailer.sendOTP({ to: email, otp, wallet, location: locationStr, level, expiresIn: OTP_TTL });
      channels.push('email');
      logger.info(`[Agent4] OTP dispatched via email to ${maskEmail(email)}`);
    } catch (err) {
      logger.error(`[Agent4] Email dispatch failed: ${err.message}`);
    }
  }

  // ── Dispatch via SMS ─────────────────────────────────────
  if (phone) {
    try {
      await sms.sendOTP({ to: phone, otp, location: locationStr, level });
      channels.push('sms');
      logger.info(`[Agent4] OTP dispatched via SMS to ${maskPhone(phone)}`);
    } catch (err) {
      logger.error(`[Agent4] SMS dispatch failed: ${err.message}`);
    }
  }

  if (channels.length === 0) {
    logger.warn(`[Agent4] No delivery channel available for wallet ${wallet.slice(0,10)}…`);
  }

  return { channels };
}

/**
 * Verify a submitted OTP code.
 * Called from the /otp/verify endpoint.
 *
 * @param {object} params - { wallet, submittedCode, pendingToken }
 * @returns {object}      - { success, action, accessToken?, message, attemptsLeft? }
 */
async function verify({ wallet, submittedCode, pendingToken }) {

  let pendingDid = null;

  // ── 1. Validate pending token ─────────────────────────────
  try {

    const decoded = jwt.verify(pendingToken, process.env.JWT_SECRET);
    console.log('pending token decoded:', decoded);
    console.log('wallet match:', decoded.sub, '===', wallet.toLowerCase());
    console.log('type match:', decoded.type);
    if (decoded.sub !== wallet.toLowerCase() || decoded.type !== 'pending_otp') {
      return { success: false, action: 'INVALID_TOKEN', message: 'Invalid or expired pending token.' };
    }
    pendingDid = decoded.did || null;
    
    // Verify DID if present
    if (pendingDid) {
      const didAddress = extractAddressFromDID(pendingDid);
      if (didAddress.toLowerCase() !== wallet.toLowerCase()) {
        logger.warn(`[Agent4] DID verification failed: DID=${pendingDid}, wallet=${wallet}`);
        return { 
          success: false, 
          action: 'INVALID_TOKEN', 
          message: 'DID verification failed: DID does not match wallet.' 
        };
      }
    }
  } catch {
    return { success: false, action: 'INVALID_TOKEN', message: 'Pending token expired. Please log in again.' };
  }

  // ── 2. Load stored OTP data ───────────────────────────────
  const stored = await redis.getJSON(otpKey(wallet));
  if (!stored) {
    return { success: false, action: 'OTP_EXPIRED', message: 'OTP expired. Please log in again.' };
  }

  // ── 3. Check attempt count ────────────────────────────────
  const attempts = await redis.increment(attemptsKey(wallet), OTP_TTL);
  const attemptsLeft = MAX_ATTEMPTS - attempts;

  if (attempts > MAX_ATTEMPTS) {
    // Exceed limit — clean up and hard block
    await cleanup(wallet);
    logger.warn(`[Agent4] HARD_BLOCK wallet=${wallet.slice(0,10)}… too many failed attempts`);
    return {
      success: false,
      action : 'HARD_BLOCK',
      message: 'Too many failed attempts. This session has been blocked. Please contact support.',
    };
  }

  // ── 4. Verify the code ────────────────────────────────────
  const isValid = verifyOTP(submittedCode, stored.hash, stored.salt);

  if (!isValid) {
    logger.info(`[Agent4] Wrong code wallet=${wallet.slice(0,10)}… attempts=${attempts}/${MAX_ATTEMPTS}`);
    return {
      success      : false,
      action       : 'WRONG_CODE',
      attemptsLeft : Math.max(0, attemptsLeft),
      message      : `Incorrect code. ${Math.max(0, attemptsLeft)} attempt(s) remaining.`,
    };
  }

  // ── 5. Success — issue full JWT and clean up ──────────────
  await cleanup(wallet);

  const payload = { sub: wallet.toLowerCase(), type: 'verified', mfa: true };
  if (pendingDid) payload.did = pendingDid;

  const accessToken = jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );

  logger.info(`[Agent4] OTP VERIFIED wallet=${wallet.slice(0,10)}… session granted`);

  return {
    success     : true,
    action      : 'VERIFIED',
    accessToken,
    expiresIn   : process.env.JWT_EXPIRES_IN || '1h',
    message     : 'Identity verified. Access granted.',
  };
}

async function cleanup(wallet) {
  await redis.del(otpKey(wallet));
  await redis.del(attemptsKey(wallet));
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone) {
  return phone.slice(0, 4) + '****' + phone.slice(-2);
}

module.exports = { initiate, verify };
