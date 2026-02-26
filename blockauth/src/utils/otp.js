'use strict';

const crypto = require('crypto');

const OTP_LENGTH = Number(process.env.OTP_LENGTH) || 6;

/**
 * Generate a cryptographically secure numeric OTP.
 * Uses crypto.randomInt to avoid modulo bias.
 */
function generateOTP() {
  const max  = 10 ** OTP_LENGTH;      // e.g. 1_000_000 for 6 digits
  const code = crypto.randomInt(0, max);
  return code.toString().padStart(OTP_LENGTH, '0');
}

/**
 * Hash an OTP with a per-session salt using HMAC-SHA256.
 * We store the hash in Redis — never the plaintext.
 */
function hashOTP(otp, salt) {
  return crypto
    .createHmac('sha256', salt)
    .update(otp)
    .digest('hex');
}

/**
 * Constant-time comparison to prevent timing attacks.
 */
function verifyOTP(submittedOtp, storedHash, salt) {
  const submittedHash = hashOTP(submittedOtp, salt);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(submittedHash),
      Buffer.from(storedHash)
    );
  } catch {
    return false;
  }
}

/**
 * Generate a random salt for HMAC.
 */
function generateSalt() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { generateOTP, hashOTP, verifyOTP, generateSalt };
