// models/userModel.js - all SQL about users.
const { db } = require('../db');

async function findByEmail(email) {
  const [rows] = await db.query(
    `SELECT id, full_name, email, password_hash, role, college, email_verified
     FROM users WHERE email = ?`, [email]);
  return rows[0];
}

// New accounts are ALWAYS role "user" and NOT verified. Admins are created in the database only.
// The expiry is computed by MySQL itself (24 hours from now).
async function create({ fullName, email, passwordHash, college, tokenHash }) {
  const [r] = await db.query(
    `INSERT INTO users (full_name, email, password_hash, role, college, email_verified,
                        verify_token_hash, verify_expires)
     VALUES (?, ?, ?, 'user', ?, 0, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
    [fullName, email, passwordHash, college, tokenHash]);
  return r.insertId;
}

// Registering again with an email that was NEVER verified: nobody has proven they own it yet,
// so the newest sign-up takes over the pending account (new name, college, password and link).
async function replaceUnverified({ id, fullName, passwordHash, college, tokenHash }) {
  const [r] = await db.query(
    `UPDATE users SET full_name = ?, password_hash = ?, college = ?, verify_token_hash = ?,
                      verify_expires = DATE_ADD(NOW(), INTERVAL 24 HOUR)
     WHERE id = ? AND email_verified = 0 AND role = 'user'`,
    [fullName, passwordHash, college, tokenHash, id]);
  return r.affectedRows === 1;
}

// A new link replaces the old one (used by "Resend verification email")
async function setVerifyToken(id, tokenHash) {
  await db.query(
    `UPDATE users SET verify_token_hash = ?, verify_expires = DATE_ADD(NOW(), INTERVAL 24 HOUR)
     WHERE id = ? AND email_verified = 0`, [tokenHash, id]);
}

// Works once: the token is erased as soon as it is used, and it expires after 24 hours.
async function verifyByTokenHash(tokenHash) {
  const [r] = await db.query(
    `UPDATE users SET email_verified = 1, verify_token_hash = NULL, verify_expires = NULL
     WHERE verify_token_hash = ? AND verify_expires > NOW() AND email_verified = 0`, [tokenHash]);
  return r.affectedRows === 1;
}

module.exports = { findByEmail, create, replaceUnverified, setVerifyToken, verifyByTokenHash };