// mailer.js - sends every e-mail of the system (verification links and request notices).
// Three modes, chosen by environment variables:
//   1. RESEND_API_KEY set -> Resend HTTPS API (use this on hosts that block SMTP, e.g. Railway Hobby)
//   2. SMTP_HOST set      -> SMTP through Nodemailer (local development, or hosts that allow SMTP)
//   3. neither            -> the message is printed in the terminal (development only)
const nodemailer = require('nodemailer');
require('dotenv').config();
const { fmtDateTime } = require('./helpers');

const useApi = Boolean(process.env.RESEND_API_KEY);

let transport = null;
if (!useApi && process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// One place that really sends (or, in development, prints) a plain-text e-mail.
async function deliver({ to, subject, text }) {
  if (useApi) {
    // HTTPS (port 443) is open on every plan, unlike SMTP ports 465/587.
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(15000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Resend API ${res.status}: ${body.message || 'request failed'}`);
    console.log(`E-mail "${subject}" sent to ${to} (Resend id: ${body.id || 'unknown'})`);
    return;
  }
  if (!transport) {
    // Printing messages is ONLY acceptable on your own computer
    if (process.env.NODE_ENV === 'production') throw new Error('No mail service configured (set RESEND_API_KEY or SMTP_HOST)');
    console.log(`[DEV MAIL - no SMTP set] To: ${to} | Subject: ${subject}\n${text}\n[END DEV MAIL]`);
    return;
  }
  const info = await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
  // Shows in PowerShell, so you can tell "sent" from "never sent"
  console.log(`E-mail "${subject}" sent to ${to} (accepted by the mail server: ${info.accepted.join(', ') || 'nobody'})`);
}

async function sendVerificationEmail(to, name, link) {
  if (!useApi && !transport && process.env.NODE_ENV !== 'production') {
    console.log(`[DEV MAIL - no SMTP set] Verification link for ${to}: ${link}`);
    return;
  }
  await deliver({
    to,
    subject: 'Verify your CSPC Equipment Borrowing account',
    text: `Hi ${name},\n\nOpen this link to verify your email (valid for 24 hours):\n${link}\n\n` +
          `If you did not create this account, you can ignore this email.`
  });
}

// ---- Tell a student what the property office did with their request ----
const NOTICE = {
  approved:  { word: 'approved',  line: 'Good news! Your equipment request was APPROVED.',
               next: 'Please go to the property office at your start time to pick up the equipment.' },
  declined:  { word: 'declined',  line: 'Your equipment request was DECLINED by the property office.',
               next: 'You can send a new request for another time, or ask the property office why.' },
  cancelled: { word: 'cancelled', line: 'Your equipment request was CANCELLED by the property office.',
               next: 'You can send a new request if you still need the equipment.' }
};

// d = the row from reservationModel.findDetails();  kind = 'approved' | 'declined' | 'cancelled'
async function sendReservationNotice(d, kind) {
  const n = NOTICE[kind];
  if (!n || !d || !d.email) return;
  const base = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
  const lines = [
    `Hi ${String(d.full_name).split(' ')[0]},`, '',
    n.line, '',
    `Equipment: ${d.asset_name} (${d.asset_tag})`,
    `Quantity:  ${d.qty}`,
    `From:      ${fmtDateTime(d.start_date)}`,
    `Until:     ${fmtDateTime(d.due_date)}`
  ];
  if (d.notes) lines.push(`Your note: ${d.notes}`);
  lines.push('', n.next, '', `See all your requests: ${base}/reservations`, '', 'CSPC Equipment Borrowing');
  await deliver({ to: d.email, subject: `Your request was ${n.word}: ${d.asset_name}`, text: lines.join('\n') });
}

module.exports = { sendVerificationEmail, sendReservationNotice };