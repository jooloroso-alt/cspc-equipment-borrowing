// test-mail.js - sends ONE test email so you can check your SMTP settings.
// Usage:  node test-mail.js your-address@example.com
require('dotenv').config();
const { sendVerificationEmail } = require('./mailer');

const to = process.argv[2];
if (!to) { console.log('Usage: node test-mail.js your-address@example.com'); process.exit(1); }

console.log(process.env.SMTP_HOST
  ? `Using SMTP server ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`
  : 'SMTP_HOST is empty in .env, so nothing will really be sent (the link is only printed).');

sendVerificationEmail(to, 'Test', `${process.env.BASE_URL}/verify/this-is-only-a-test`)
  .then(() => { console.log('Done. If SMTP is set, check the inbox AND the Spam folder.'); process.exit(0); })
  .catch((e) => { console.error('FAILED:', e.message); process.exit(1); });