// routes/reservations.js - the main table + all the buttons on it.
const express = require('express');
const R = require('../models/reservationModel');
const { sendReservationNotice } = require('../mailer');
const { requireLogin, flash } = require('../middleware/auth');

const router = express.Router();

// GET /reservations  - admin sees everything, a user sees only their own rows
router.get('/reservations', requireLogin, async (req, res, next) => {
  try {
    const isAdmin = req.session.user.role === 'admin';
    const scope = isAdmin ? null : req.session.user.id;     // null = no user filter
    const filters = {
      status: String(req.query.status || ''),
      q: String(req.query.q || '').trim().slice(0, 60),
      period: String(req.query.period || 'all'),
      college: isAdmin ? String(req.query.college || '') : ''     // students only ever see their own college
    };
    const [rows, counts] = await Promise.all([
      R.list({ userId: scope, ...filters }),
      R.counts(scope)
    ]);
    res.render('reservations', { title: 'Reservations', rows, counts, filters });
  } catch (e) { next(e); }
});

// Every button on the table is one entry here. "from" = statuses it may start from.
const ACTIONS = {
  approve:  { to: 'approved',    from: ['in_approval'],             adminOnly: true,  msg: 'Reservation approved.' },
  decline:  { to: 'declined',    from: ['in_approval'],             adminOnly: true,  msg: 'Reservation declined.' },
  checkout: { to: 'checked_out', from: ['in_approval', 'approved'], adminOnly: true,  msg: 'Asset checked out.' },
  return:   { to: 'returned',    from: ['checked_out'],             adminOnly: true,  msg: 'Asset marked as returned.' },
  cancel:   { to: 'cancelled',   from: ['in_approval', 'approved'], adminOnly: false, msg: 'Reservation cancelled.' },
  delete:   { adminOnly: true, msg: 'Reservation deleted.' }
};

// POST /reservations/:id/:action
router.post('/reservations/:id/:action', requireLogin, async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const isAdmin = req.session.user.role === 'admin';
    const rule = Object.prototype.hasOwnProperty.call(ACTIONS, req.params.action)
      ? ACTIONS[req.params.action] : null;

    if (!Number.isInteger(id) || !rule) {
      return res.status(404).render('error', { title: 'Not found', message: 'That action does not exist.' });
    }
    if (rule.adminOnly && !isAdmin) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Administrators only.' });
    }

    let ok, problem = 'That action is not possible for this reservation.';
    if (req.params.action === 'delete') ok = await R.remove(id);
    else if (req.params.action === 'checkout') {
      // Checking out hands units over, so it also checks that enough units are back in the office
      const out = await R.checkout(id);
      ok = out.ok;
      if (out.reason === 'stock') {
        problem = `Not enough units in stock: only ${out.available} available right now (the rest are still borrowed).`;
      }
    }
    else ok = await R.transition(id, rule.to, rule.from, isAdmin ? null : req.session.user.id);
    // For a normal user the owner check is inside the SQL, so they cannot touch other rows.

    // When the ADMIN approves, declines or cancels, the student is told by e-mail.
    // It is sent in the background: a slow or broken mail server never blocks or breaks the admin's click.
    const KIND = { approve: 'approved', decline: 'declined', cancel: 'cancelled' };
    if (ok && isAdmin && KIND[req.params.action]) {
      const details = await R.findDetails(id);
      sendReservationNotice(details, KIND[req.params.action])
        .catch((e) => console.error('Notification e-mail failed:', e.message));
    }

    flash(req, ok ? 'success' : 'error', ok ? rule.msg : problem);

    // Go back to the same filtered view (only paths that start with /reservations are allowed)
    const back = String(req.body.back || '');
    res.redirect(back.startsWith('/reservations') ? back : '/reservations');
  } catch (e) { next(e); }
});

module.exports = router;