// middleware/auth.js - route guards.
const crypto = require('crypto');

// requireLogin: any signed-in person.  requireAdmin: role must be "admin".
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('error', { title: 'Forbidden', message: 'This page is for administrators only.' });
  }
  next();
}

// Borrowing pages are for students/staff. Admins manage requests instead of making them.
function requireUser(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role === 'admin') return res.redirect('/reservations');
  next();
}

// Is the CSRF token sent with a form the same as the one saved in this session?
function csrfValid(req, sent) {
  const a = Buffer.from(String(sent || ''));
  const b = Buffer.from(String(req.session.csrf || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// One-time message shown after a redirect (e.g. "Reservation approved.")
function flash(req, type, text) {
  req.session.flash = { type, text };
}

module.exports = { requireLogin, requireAdmin, requireUser, csrfValid, flash };