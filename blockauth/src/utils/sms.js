'use strict';

const twilio = require('twilio');

let _client = null;

function getClient() {
  if (!_client) {
    _client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return _client;
}

/**
 * Send OTP via SMS using Twilio.
 * @param {object} opts - { to, otp, location, level }
 */
async function sendOTP({ to, otp, location, level }) {
  const urgency = level === 'CRITICAL'
    ? 'URGENT — '
    : '';

  const body =
    `${urgency}BlockAuth code: ${otp}\n` +
    `Login from: ${location}\n` +
    `Expires in 5 min. Never share this code.`;

  await getClient().messages.create({
    body,
    from: process.env.TWILIO_FROM_NUMBER,
    to,
  });
}

module.exports = { sendOTP };
