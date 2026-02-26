'use strict';

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host  : 'smtp.gmail.com',
  port  : 465,
  secure: true,
  auth  : {
    user: process.env.EMAIL_FROM,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const FROM_NAME = process.env.EMAIL_FROM_NAME || 'BlockAuth Security';
const FROM      = `"${FROM_NAME}" <${process.env.EMAIL_FROM}>`;
// ─── OTP Email ────────────────────────────────────────────────────────────

/**
 * Send OTP verification email.
 * @param {object} opts - { to, otp, wallet, location, level, expiresIn }
 */
async function sendOTP({ to, otp, wallet, location, level, expiresIn }) {
  const minutes = Math.round(expiresIn / 60);
  const isCritical = level === 'CRITICAL';

  const subject = isCritical
    ? '⚠️ Urgent: Verify your BlockAuth login'
    : '🔐 Your BlockAuth verification code';

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0d1117; color: #e2e8f0; margin: 0; padding: 0; }
    .wrapper { max-width: 520px; margin: 40px auto; background: #161b22;
               border: 1px solid #30363d; border-radius: 12px; overflow: hidden; }
    .header  { background: ${isCritical ? '#7f1d1d' : '#0c2a1a'}; padding: 28px 32px;
               border-bottom: 2px solid ${isCritical ? '#ef4444' : '#00ff88'}; }
    .header h1 { margin: 0; font-size: 20px;
                 color: ${isCritical ? '#fca5a5' : '#4ade80'}; }
    .body    { padding: 32px; }
    .otp-box { background: #0d1117; border: 1px solid ${isCritical ? '#ef4444' : '#00ff88'};
               border-radius: 10px; text-align: center; padding: 24px; margin: 24px 0; }
    .otp-code { font-size: 40px; font-weight: 700; letter-spacing: 16px;
                color: ${isCritical ? '#ef4444' : '#00ff88'};
                font-family: 'Courier New', monospace; }
    .meta    { background: #0d1117; border-radius: 8px; padding: 14px 18px;
               font-size: 13px; color: #8b949e; margin-top: 20px; }
    .meta span { color: #e2e8f0; font-weight: 600; }
    .footer  { padding: 20px 32px; font-size: 12px; color: #484f58;
               border-top: 1px solid #21262d; }
    p { line-height: 1.7; margin: 0 0 14px; font-size: 15px; color: #ffffff;}
  </style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>${isCritical ? '⚠️ Security Alert — Action Required' : '🔐 Verify Your Identity'}</h1>
  </div>
  <div class="body">
    <p>${isCritical
      ? 'We detected a <strong style="color:#fca5a5">high-risk login attempt</strong> on your BlockAuth account. Your session has been <strong>suspended</strong> until you verify your identity.'
      : 'We detected a login from an unfamiliar device or location. Please use the code below to confirm it\'s you.'
    }</p>

    <div class="otp-box">
      <div class="otp-code">${otp}</div>
    </div>

    <div class="meta">
      <div>Wallet: <span>${wallet.slice(0, 12)}…${wallet.slice(-4)}</span></div>
      <div>Location: <span>${location}</span></div>
      <div>Expires in: <span>${minutes} minutes</span></div>
    </div>

    <p style="margin-top:24px;font-size:13px;color:#8b949e;">
      Never share this code with anyone. BlockAuth will never ask for it by phone or chat.
      If you did not attempt this login, your wallet may be compromised — change your security settings immediately.
    </p>
  </div>
  <div class="footer">
    This email was sent by BlockAuth · Do not reply to this email
  </div>
</div>
</body>
</html>
  `.trim();

 await transporter.sendMail({
  from   : FROM,
  to,
  subject,
  html   : bodyHtml,
  text   : `Your BlockAuth verification code is: ${otp}\nExpires in ${minutes} minutes.`,
}); 
}

// ─── Security Alert Email (Critical — no OTP, just alert) ────────────────

/**
 * Send a security alert email for critical logins.
 * @param {object} opts - { to, wallet, ip, location, device, reasons }
 */
async function sendSecurityAlert({ to, wallet, ip, location, device, reasons }) {
  const subject = '🚨 Suspicious login attempt on your BlockAuth account';

  const reasonsHtml = reasons.map(r => `<li>${r}</li>`).join('');

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0d1117; color: #e2e8f0; margin: 0; }
    .wrapper { max-width: 520px; margin: 40px auto; background: #161b22;
               border: 1px solid #30363d; border-radius: 12px; overflow: hidden; }
    .header  { background: #7f1d1d; padding: 28px 32px;
               border-bottom: 2px solid #ef4444; }
    .header h1 { margin: 0; font-size: 20px; color: #fca5a5; }
    .body    { padding: 32px; }
    .meta    { background: #0d1117; border-radius: 8px; padding: 14px 18px;
               font-size: 13px; color: #8b949e; margin: 20px 0; }
    .meta div { margin: 4px 0; }
    .meta span { color: #e2e8f0; font-weight: 600; }
    ul { color: #fca5a5; font-size: 14px; padding-left: 20px; line-height: 2; }
    p  { line-height: 1.7; font-size: 15px; margin: 0 0 14px; color: #ffffff;}
    .footer { padding: 20px 32px; font-size: 12px; color: #484f58;
              border-top: 1px solid #21262d; }
  </style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>🚨 Suspicious Login Detected</h1>
  </div>
  <div class="body">
    <p>A login attempt on your BlockAuth-protected account was flagged as <strong style="color:#fca5a5">CRITICAL risk</strong> and has been blocked.</p>
    <div class="meta">
      <div>Wallet: <span>${wallet.slice(0,12)}…${wallet.slice(-4)}</span></div>
      <div>IP Address: <span>${ip}</span></div>
      <div>Location: <span>${location}</span></div>
      <div>Device: <span>${device}</span></div>
    </div>
    <p><strong>Why it was flagged:</strong></p>
    <ul>${reasonsHtml}</ul>
    <p style="margin-top:20px;font-size:13px;color:#8b949e;">
      If this was you, check the verification code email sent separately. If this was NOT you, secure your wallet immediately.
    </p>
  </div>
  <div class="footer">BlockAuth Security · Do not reply</div>
</div>
</body>
</html>
  `.trim();

  await transporter.sendMail({
  from   : FROM,
  to,
  subject,
  html   : bodyHtml,
  text   : `Suspicious login detected.\nIP: ${ip}\nLocation: ${location}\nDevice: ${device}`,
}); 
}

module.exports = { sendOTP, sendSecurityAlert };
