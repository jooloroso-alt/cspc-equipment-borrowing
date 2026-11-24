// routes/booking.js - calendar (month/week) + booking form, for students only.
// Everything is limited to the college saved on the student's account.
const express = require('express');
const R = require('../models/reservationModel');
const A = require('../models/assetModel');
const { requireUser, flash } = require('../middleware/auth');
const { ymd, fmtTime, toInputValue, toSqlDateTime } = require('../helpers');

const router = express.Router();

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  d.setHours(0, 0, 0, 0);
  return isNaN(d) ? new Date(new Date().setHours(0, 0, 0, 0)) : d;
}

// GET /booking?view=month|week&date=YYYY-MM-DD
router.get('/booking', requireUser, async (req, res, next) => {
  try {
    const me = req.session.user;
    if (!me.college) {
      return res.status(403).render('error', { title: 'No college', message: 'Your account has no college. Please contact the property office.' });
    }
    const view = req.query.view === 'week' ? 'week' : 'month';
    const anchor = parseYmd(req.query.date);

    // 1. Work out which days to draw, the title, and the prev/next targets
    let first, last, title, prev, next;
    if (view === 'month') {
      const som = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const eom = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      first = addDays(som, -som.getDay());              // back up to Sunday
      last = addDays(eom, 6 - eom.getDay());            // forward to Saturday
      title = som.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      prev = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
      next = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    } else {
      first = addDays(anchor, -anchor.getDay());
      last = addDays(first, 6);
      const f = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      title = `${f(first)} - ${f(last)}, ${last.getFullYear()}`;
      prev = addDays(anchor, -7);
      next = addDays(anchor, 7);
    }
    const rangeEnd = addDays(last, 1);

    // 2. Bookings of the student's college in that range, then drop them into day cells
    const bookings = await R.forRange(first, rangeEnd, me.college);
    const todayKey = ymd(new Date());
    const days = [];
    for (let d = new Date(first); d < rangeEnd; d = addDays(d, 1)) {
      const dayStart = new Date(d), dayEnd = addDays(d, 1);
      const events = bookings
        .filter((b) => new Date(b.start_date) < dayEnd && (!b.due_date || new Date(b.due_date) >= dayStart))
        .map((b) => {
          const mine = b.user_id === me.id;
          const startsToday = new Date(b.start_date) >= dayStart;
          return {
            status: b.status, mine,
            // Other students' bookings only show the asset, never who booked it (privacy)
            label: (startsToday ? fmtTime(b.start_date) + ' ' : '') + b.asset_name +
                   (mine ? ' - ' + b.requested_by : ' (booked)')
          };
        });
      days.push({ ymd: ymd(d), num: d.getDate(), events, isToday: ymd(d) === todayKey,
                  inMonth: view === 'week' || d.getMonth() === anchor.getMonth() });
    }

    // 3. Form data (default: next full hour, for two hours)
    const startDefault = new Date(); startDefault.setHours(startDefault.getHours() + 1, 0, 0, 0);
    const dueDefault = new Date(startDefault.getTime() + 2 * 60 * 60 * 1000);
    const defaults = { start: toInputValue(startDefault), due: toInputValue(dueDefault) };

    res.render('booking', {
      title: 'Asset Booking', defaults,
      selectedAsset: Number.parseInt(req.query.asset, 10) || 0,   // set by the Book button on /equipment
      assets: await A.listBookable(me.college),                  // only this college's equipment
      cal: { view, title, days, todayYmd: todayKey, anchorYmd: ymd(anchor), prevYmd: ymd(prev), nextYmd: ymd(next) }
    });
  } catch (e) { next(e); }
});

// POST /booking - validate everything on the SERVER (never trust the browser)
router.post('/booking', requireUser, async (req, res, next) => {
  try {
    const me = req.session.user;
    const fail = (text) => { flash(req, 'error', text); return res.redirect('/booking'); };

    const assetId = Number.parseInt(req.body.asset_id, 10);
    const rawQty = String(req.body.qty === undefined ? '' : req.body.qty).trim();
    const qty = rawQty === '' ? 1 : Number(rawQty);              // blank = 1 unit
    const indefinite = req.body.indefinite === 'on';
    const notes = String(req.body.notes || '').trim().slice(0, 255);

    const start = toSqlDateTime(String(req.body.start || ''));
    const due = indefinite ? null : toSqlDateTime(String(req.body.due || ''));

    if (!Number.isInteger(assetId)) return fail('Please choose an asset.');
    if (rawQty !== '' && !/^\d{1,4}$/.test(rawQty) || qty < 1) return fail('Please enter a quantity of 1 or more.');
    if (!start) return fail('Please enter a valid start time.');
    if (!indefinite && !due) return fail('Please enter a valid return time, or tick "Indefinite return".');
    if (due && new Date(due.replace(' ', 'T')) <= new Date(start.replace(' ', 'T'))) {
      return fail('The return time must be after the start time.');
    }
    if (new Date(start.replace(' ', 'T')) < Date.now() - 5 * 60 * 1000) {
      return fail('The start time cannot be in the past.');
    }

    // The asset must exist, be available, AND belong to the student's own college.
    // This check is on the server, so editing the page in the browser cannot bypass it.
    const asset = await A.findById(assetId);
    if (!asset) return fail('That asset is not available for booking.');
    if (asset.college !== me.college) return fail('That equipment belongs to another college.');
    const usable = asset.quantity - asset.maintenance_qty;       // units under maintenance cannot be booked
    if (usable < 1) return fail('All units of that equipment are under maintenance right now.');
    if (qty > usable) {
      return fail(`Only ${usable} unit${usable === 1 ? '' : 's'} can be booked` +
                  (asset.maintenance_qty ? ` (${asset.maintenance_qty} under maintenance).` : '.'));
    }

    // The stock check and the insert happen together, so the last unit can never be taken twice
    const result = await R.createIfAvailable({
      assetId, userId: me.id, qty, start, due, notes,
      status: 'in_approval',                                // the admin approves it later
      autoCheckout: req.body.auto_checkout === 'on'
    });
    if (!result.ok) {
      return fail(result.free === 0
        ? 'All units of that equipment are already booked for part of the time you chose.'
        : `Only ${result.free} unit${result.free === 1 ? ' is' : 's are'} free for part of that time. Lower the quantity or choose another time.`);
    }
    flash(req, 'success', 'Request sent. Waiting for admin approval.');
    res.redirect('/booking?date=' + start.slice(0, 10));
  } catch (e) { next(e); }
});

module.exports = router;