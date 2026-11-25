// app.js - starts the server and wires everything together.
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');

const R = require('./models/reservationModel');
const helpers = require('./helpers');
const { db } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Fail fast: a missing secret in production must stop the app, not silently weaken it.
if (isProd && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is not set. Refusing to start.');
  process.exit(1);
}

// Behind the host's HTTPS proxy: trust ONE hop so req.secure, secure cookies and
// the rate limiters' req.ip use the real client connection (X-Forwarded-* headers).
if (isProd) app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- Security headers (Content-Security-Policy etc.) ----
app.use(helmet({
  contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } },
  hsts: isProd ? { maxAge: 60 * 60 * 24, includeSubDomains: false } : false   // 1 day while testing; raise later
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));

// ---- Sessions: the cookie holds only an id, the data stays in the MySQL table "sessions" ----
// (the default MemoryStore would log everyone out on every redeploy and leaks memory)
const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 1000 * 60 * 60 * 2,
  createDatabaseTable: true          // creates table `sessions` on first start
}, db);

app.use(session({
  name: 'sid',
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,                 // JavaScript in the page cannot read the cookie
    sameSite: 'lax',                // not sent on cross-site POSTs
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 2      // 2 hours
  }
}));

// ---- Values every view can use (all synchronous, so the error page always works) ----
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.currentUrl = req.originalUrl;
  res.locals.flash = req.session.flash || null;       // show once, then clear
  delete req.session.flash;
  res.locals.pendingCount = 0;
  Object.assign(res.locals, helpers);                 // fmtDateTime, ymd, statusLabel, ...
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  next();
});

// ---- CSRF protection: every POST must carry the secret token from its own form ----
app.use((req, res, next) => {
  // File uploads are "multipart" forms: their fields can only be read AFTER the upload is parsed.
  // So the photo-upload route checks the token itself (routes/assets.js). Every other POST is checked here.
  const isPhotoUpload = req.method === 'POST' && req.is('multipart/form-data') && /^\/assets\/\d+\/image$/.test(req.path);
  if (req.method === 'POST' && !isPhotoUpload) {
    const sent = Buffer.from(String((req.body && req.body._csrf) || ''));
    const real = Buffer.from(req.session.csrf);
    if (sent.length !== real.length || !crypto.timingSafeEqual(sent, real)) {
      return res.status(403).render('error', { title: 'Blocked', message: 'Invalid or missing security token. Go back, refresh the page, and try again.' });
    }
  }
  next();
});

// ---- Signed-in extras: automatic check in/out + the admin bell badge ----
app.use(async (req, res, next) => {
  try {
    if (req.session.user) {
      await R.runAutomation();
      if (req.session.user.role === 'admin') res.locals.pendingCount = await R.pendingCount();
    }
    next();
  } catch (e) { next(e); }
});

// ---- Routes ----
app.use(require('./routes/auth'));
app.use(require('./routes/equipment'));
app.use(require('./routes/reservations'));
app.use(require('./routes/booking'));
app.use(require('./routes/assets'));

// ---- 404 and generic error page (no stack traces shown to users) ----
app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'Page not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Server error', message: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`Equipment Borrowing running on port ${PORT}`);
});