// test-mail.js
const nodemailer = require('nodemailer');
require('dotenv').config({ path: '../.env' }); // ← fix path

const t = nodemailer.createTransport({
  host  : 'smtp.gmail.com',
  port  : 465,
  secure: true,
  auth  : {
    user: process.env.EMAIL_FROM,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

console.log('EMAIL_FROM:', process.env.EMAIL_FROM);
console.log('PASS set:', !!process.env.GMAIL_APP_PASSWORD);
console.log('PASS length:', process.env.GMAIL_APP_PASSWORD?.length);

t.verify((err, ok) => {
  if (err) console.error('FAILED:', err.message);
  else console.log('SUCCESS — Gmail connected!');
});