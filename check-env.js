// check-env.js - checks your mail settings WITHOUT printing the password.
const fs = require('fs');
require('dotenv').config({ quiet: true });

const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';
const from = process.env.MAIL_FROM || '';
const mask = (e) => e.replace(/^(.{2}).*(@.*)$/, '$1***$2');

console.log('SMTP_HOST      :', process.env.SMTP_HOST || '(empty)');
console.log('SMTP_PORT      :', process.env.SMTP_PORT || '(empty)', '| SMTP_SECURE:', process.env.SMTP_SECURE || '(empty)');
console.log('SMTP_USER      :', user ? mask(user) : '(empty)', '| length', user.length, '| looks like a full email:', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user));
console.log('SMTP_PASS      : length', pass.length, '(an app password is exactly 16)');
console.log('  has spaces/quotes:', /[\s'"]/.test(pass), '| only lowercase letters:', /^[a-z]+$/.test(pass));
console.log('MAIL_FROM      :', from ? from.replace(/[^<]*<?([^>]*)>?/, (m, a) => mask(a)) : '(empty)');
console.log('MAIL_FROM contains SMTP_USER:', user && from.toLowerCase().includes(user.toLowerCase()));

// "the last line wins": two SMTP_PASS lines means the lower one cancels the upper one
const lines = fs.readFileSync('.env', 'utf8').split(/\r?\n/);
for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']) {
  const n = lines.filter((l) => l.trim().startsWith(key + '=')).length;
  if (n !== 1) console.log(`PROBLEM: ${key} appears ${n} times in .env (it must appear exactly once)`);
}