// routes/auth.js - register (with email verification), login, resend link, logout.
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const users = require('../models/userModel');
const { sendVerificationEmail } = require('../mailer');
const { flash } = require('../middleware/auth');
const { COLLEGE_CODES, lettersOnly, expectedStudentEmail, STUDENT_EMAIL_DOMAIN } = require('../helpers');

const router = express.Router();
const COST = 12;                                   // bcrypt work factor (course minimum is 10)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);
// DUMMY_HASH: when the email does not exist we still run one bcrypt compare, so the
// response time does not reveal which emails are registered.
const BASE_URL = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');

// ----- Rate limits: slow down people who guess passwords or spam sign-ups -----
// Login and resend are counted per connection AND per email, so one student guessing a
// password is blocked without blocking a whole computer lab that shares one connection.
const tooMany = (req, res) => res.status(429).render('error', {
  title: 'Too many attempts', message: 'Too many attempts. Please wait a while and try again.' });
const perIpAndEmail = (req) => `${ipKeyGenerator(req.ip)}|${String((req.body && req.body.email) || '').trim().toLowerCase().slice(0, 160)}`;
const base = { standardHeaders: true, legacyHeaders: false, handler: tooMany };
const loginLimiter  = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 10, keyGenerator: perIpAndEmail });
const resendLimiter = rateLimit({ ...base, windowMs: 60 * 60 * 1000, limit: 5,  keyGenerator: perIpAndEmail });
const signupLimiter = rateLimit({ ...base, windowMs: 60 * 60 * 1000, limit: 30 });

// ----- Verification token: the email gets the token, the database keeps only its hash -----
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const newToken = () => { const token = crypto.randomBytes(32).toString('hex'); return { token, hash: hashToken(token) }; };

const NAME_RE = /^\p{L}[\p{L} .'-]{0,59}$/u;        // letters, spaces, dot, apostrophe, hyphen
const clean = (v) => String(v || '').trim().replace(/\s+/g, ' ');

router.get('/', (req, res) => res.redirect(req.session.user ? '/reservations' : '/login'));

// ----- LOGIN -----
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/reservations');
  res.render('login', { title: 'Log in' });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await users.findByEmail(email);
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !ok) {                            // same message for both cases on purpose
      flash(req, 'error', 'Invalid email or password.');
      return res.redirect('/login');
    }
    // Only said AFTER the password was right, so strangers cannot probe which emails exist
    if (!user.email_verified) {
      flash(req, 'error', 'Please verify your email first. Open the link we sent you, or request a new one below.');
      return res.redirect('/login');
    }
    // regenerate() = brand-new session id after login (stops session fixation)
    req.session.regenerate((err) => {
  if (err) return next(err);

  req.session.user = {
    id: user.id,
    name: user.full_name,
    role: user.role,
    college: user.college
  };

  req.session.save((err) => {
    if (err) return next(err);
    res.redirect('/reservations');
  });
});
  } catch (e) {
    next(e);
  }
});
// ----- REGISTER (students -> role "user") -----
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/reservations');
  res.render('register', { title: 'Create account' });
});

router.post('/register', signupLimiter, async (req, res, next) => {
  try {
    const first = clean(req.body.first_name);
    const middle = clean(req.body.middle_name);
    const last = clean(req.body.last_name);
    const college = String(req.body.college || '');
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const fullName = [first, middle, last].filter(Boolean).join(' ');

    let problem = null;

    if (!NAME_RE.test(first) || !NAME_RE.test(last) ||
        (middle && !NAME_RE.test(middle)) ||
        !lettersOnly(first) || !lettersOnly(last) ||
        fullName.length > 120) {
      problem = 'Please enter your first and last name using letters only (middle name is optional).';
    } else if (!COLLEGE_CODES.includes(college)) {
      problem = 'Please choose your college.';
    } else if (email !== expectedStudentEmail(first, last)) {
      problem = 'Only CSPC student emails in the right format are accepted';
    } else if (Buffer.byteLength(password) < 10 ||
               Buffer.byteLength(password) > 72) {
      problem = 'Password must be 10 to 72 characters.';
    } else if (password !== String(req.body.confirm || '')) {
      problem = 'Passwords do not match.';
    }

    if (problem) {
      flash(req, 'error', problem);
      return res.redirect('/register');
    }

    const inUse = () => {
      flash(req, 'error', 'This CSPC email is already in use, so you cannot create another account with it. Please log in instead.');
      return res.redirect('/register');
    };

    const existing = await users.findByEmail(email);

    if (existing && existing.email_verified) return inUse();

    const hash = await bcrypt.hash(password, COST);
    const { token, hash: tokenHash } = newToken();
    let sent = true;

    try {
      if (existing) {
        if (!(await users.replaceUnverified({
          id: existing.id,
          fullName,
          passwordHash: hash,
          college,
          tokenHash
        }))) return inUse();
      } else {
        await users.create({
          fullName,
          email,
          passwordHash: hash,
          college,
          tokenHash
        });
      }

      await sendVerificationEmail(
        email,
        first,
        `${BASE_URL}/verify/${token}`
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return inUse();

      console.error('Sign-up error:', e.message);
      sent = false;
    }

    if (sent) {
      flash(req, 'success', `A verification link was sent to ${email}. Open it within 24 hours, then log in.`);
    } else {
      flash(req, 'error', 'Your account was created, but we could not send the email. Use "Resend verification email" in a few minutes.');
    }

    res.redirect('/login');
  } catch (e) {
    next(e);
  }
});
// ----- VERIFY (the link in the email) -----
router.get('/verify/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    const ok = /^[0-9a-f]{64}$/.test(token) && (await users.verifyByTokenHash(hashToken(token)));
    flash(req, ok ? 'success' : 'error',
      ok ? 'Email verified! You can log in now.'
         : 'This verification link is invalid or has expired. Request a new one below.');
    res.redirect(ok ? '/login' : '/resend-verification');
  } catch (e) { next(e); }
});

// ----- RESEND the verification email -----
router.get('/resend-verification', (req, res) => res.render('resend', { title: 'Resend verification' }));

router.post('/resend-verification', resendLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = email ? await users.findByEmail(email) : null;
    if (user && user.role === 'user' && !user.email_verified) {
      const { token, hash } = newToken();
      await users.setVerifyToken(user.id, hash);
      try { await sendVerificationEmail(user.email, user.full_name.split(' ')[0], `${BASE_URL}/verify/${token}`); }
      catch (e) { console.error('Mail error:', e.message); }
    }
    flash(req, 'success', 'If that email has an unverified account, a new verification link was sent.');
    res.redirect('/login');
  } catch (e) { next(e); }
});

// ----- LOGOUT (POST + CSRF token, so another site cannot log you out) -----
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;