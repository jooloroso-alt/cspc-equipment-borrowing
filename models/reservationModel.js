// models/reservationModel.js - all SQL about reservations.
const { db } = require('../db');
const { COLLEGE_CODES } = require('../helpers');

const STATUSES = ['in_approval', 'approved', 'declined', 'checked_out', 'returned', 'cancelled'];

// A reservation is overdue when it is still open and its due date has passed.
const OVERDUE = `(r.status IN ('in_approval','approved','checked_out')
                  AND r.due_date IS NOT NULL AND r.due_date < NOW())`;
const STARTS_TODAY = `(DATE(r.start_date) = CURDATE() AND r.status IN ('in_approval','approved'))`;

const BASE = `
  SELECT r.id, r.status, r.qty, r.start_date, r.due_date, r.auto_checkout, r.notes, r.user_id,
         a.name AS asset_name, a.asset_tag, a.college, u.full_name AS requested_by,
         ${OVERDUE} AS is_overdue
  FROM reservations r
  JOIN assets a ON a.id = r.asset_id
  JOIN users  u ON u.id = r.user_id`;

// ---- LIST with filters (userId = null means "everyone", used by admin) ----
async function list({ userId, status, q, period, college }) {
  const where = [];
  const params = [];

  if (userId) { where.push('r.user_id = ?'); params.push(userId); }

  if (status === 'overdue')      where.push(OVERDUE);
  else if (status === 'today')   where.push(STARTS_TODAY);
  else if (STATUSES.includes(status)) { where.push('r.status = ?'); params.push(status); }

  if (COLLEGE_CODES.includes(college)) { where.push('a.college = ?'); params.push(college); }

  if (q) {
    where.push('(a.name LIKE ? OR a.asset_tag LIKE ? OR u.full_name LIKE ? OR r.notes LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  // The period is mapped through a list WE wrote - never interpolate user input.
  const PERIODS = {
    today: 'DATE(r.start_date) = CURDATE()',
    week:  'YEARWEEK(r.start_date, 1) = YEARWEEK(CURDATE(), 1)',
    month: 'YEAR(r.start_date) = YEAR(CURDATE()) AND MONTH(r.start_date) = MONTH(CURDATE())'
  };
  if (PERIODS[period]) where.push(PERIODS[period]);

  const sql = BASE + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
              ' ORDER BY r.start_date DESC LIMIT 200';
  const [rows] = await db.query(sql, params);
  return rows;
}

// ---- Numbers for the four coloured cards ----
async function counts(userId) {
  const params = [];
  let sql = `SELECT SUM(r.status = 'in_approval') AS in_approval,
                    SUM(r.status = 'declined')    AS declined,
                    SUM(${STARTS_TODAY})          AS start_today,
                    SUM(${OVERDUE})               AS overdue
             FROM reservations r`;
  if (userId) { sql += ' WHERE r.user_id = ?'; params.push(userId); }
  const [rows] = await db.query(sql, params);
  const n = (v) => Number(v || 0);   // SUM() returns NULL on an empty table
  return { in_approval: n(rows[0].in_approval), declined: n(rows[0].declined),
           start_today: n(rows[0].start_today), overdue: n(rows[0].overdue) };
}

async function pendingCount() {
  const [rows] = await db.query("SELECT COUNT(*) AS n FROM reservations WHERE status = 'in_approval'");
  return rows[0].n;
}

// ---- Stock check: how many units are in use AT THE BUSIEST MOMENT of [start, due)? ----
// rows = the open reservations that overlap that time. A request without a return time never ends.
const toDate = (s) => (s instanceof Date ? s : new Date(String(s).replace(' ', 'T')));
function peakUsage(rows, start, due) {
  const S = toDate(start).getTime();
  const E = due ? toDate(due).getTime() : Infinity;
  const events = [];
  for (const r of rows) {
    const from = Math.max(new Date(r.start_date).getTime(), S);
    const to = Math.min(r.due_date ? new Date(r.due_date).getTime() : Infinity, E);
    events.push([from, Number(r.qty)], [to, -Number(r.qty)]);
  }
  // At the same moment, returns (-) are counted before new loans (+), because the end time is exclusive
  events.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  let now = 0, peak = 0;
  for (const [, delta] of events) { now += delta; if (now > peak) peak = now; }
  return peak;
}

// ---- Create a request ONLY if enough units are free for the whole time ----
// Runs inside a transaction that locks the asset row, so two students clicking at the same moment
// can never take the last unit twice.
async function createIfAvailable({ assetId, userId, qty, status, start, due, autoCheckout, notes }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[asset]] = await conn.query('SELECT quantity, maintenance_qty FROM assets WHERE id = ? FOR UPDATE', [assetId]);
    if (!asset) { await conn.rollback(); return { ok: false, reason: 'asset' }; }

    let sql = `SELECT start_date, due_date, qty FROM reservations
               WHERE asset_id = ? AND status IN ('in_approval','approved','checked_out')
                 AND (due_date IS NULL OR due_date > ?)`;
    const params = [assetId, start];
    if (due) { sql += ' AND start_date < ?'; params.push(due); }
    const [rows] = await conn.query(sql, params);

    const free = asset.quantity - asset.maintenance_qty - peakUsage(rows, start, due);   // units under maintenance can't be booked
    if (qty > free) { await conn.rollback(); return { ok: false, reason: 'full', free: Math.max(0, free) }; }

    const [r] = await conn.query(
      `INSERT INTO reservations (asset_id, user_id, qty, status, start_date, due_date, auto_checkout, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [assetId, userId, qty, status, start, due, autoCheckout ? 1 : 0, notes || null]);
    await conn.commit();
    return { ok: true, id: r.insertId };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---- Check out (hand the units over). Refuses if the units are still borrowed by someone else ----
async function checkout(id) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[res]] = await conn.query('SELECT id, asset_id, qty, status FROM reservations WHERE id = ? FOR UPDATE', [id]);
    if (!res || !['in_approval', 'approved'].includes(res.status)) { await conn.rollback(); return { ok: false, reason: 'status' }; }

    const [[asset]] = await conn.query('SELECT quantity, maintenance_qty FROM assets WHERE id = ? FOR UPDATE', [res.asset_id]);
    const [[row]] = await conn.query(
      "SELECT COALESCE(SUM(qty), 0) AS taken FROM reservations WHERE asset_id = ? AND status = 'checked_out'", [res.asset_id]);
    const available = asset.quantity - asset.maintenance_qty - Number(row.taken);
    if (res.qty > available) { await conn.rollback(); return { ok: false, reason: 'stock', available: Math.max(0, available) }; }

    await conn.query("UPDATE reservations SET status = 'checked_out' WHERE id = ?", [id]);
    await conn.commit();
    return { ok: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---- Most units that students need AT THE SAME TIME from now on (borrowed or requested) ----
// The admin cannot put more units into maintenance than would leave this many in service.
async function peakCommitted(assetId) {
  const [rows] = await db.query(
    `SELECT start_date, due_date, qty FROM reservations
     WHERE asset_id = ? AND status IN ('in_approval','approved','checked_out')
       AND (due_date IS NULL OR due_date > NOW())`, [assetId]);
  return peakUsage(rows, new Date(), null);
}

// ---- Everything an e-mail about one request needs (who, what, when) ----
async function findDetails(id) {
  const [rows] = await db.query(
    `SELECT r.id, r.qty, r.start_date, r.due_date, r.notes,
            a.name AS asset_name, a.asset_tag, u.full_name, u.email
     FROM reservations r
     JOIN assets a ON a.id = r.asset_id
     JOIN users  u ON u.id = r.user_id
     WHERE r.id = ?`, [id]);
  return rows[0];
}

// ---- Safe status change: only works if the CURRENT status is allowed ----
// ownerId (optional) adds "AND user_id = ?" so users can only touch their own rows.
async function transition(id, to, allowedFrom, ownerId = null) {
  let sql = 'UPDATE reservations SET status = ? WHERE id = ? AND status IN (?)';
  const params = [to, id, allowedFrom];
  if (ownerId) { sql += ' AND user_id = ?'; params.push(ownerId); }
  const [r] = await db.query(sql, params);
  return r.affectedRows === 1;
}

async function remove(id) {
  const [r] = await db.query('DELETE FROM reservations WHERE id = ?', [id]);
  return r.affectedRows === 1;
}

// ---- Calendar: open bookings of ONE college touching [rangeStart, rangeEnd) ----
async function forRange(rangeStart, rangeEnd, college) {
  const [rows] = await db.query(
    `SELECT r.id, r.status, r.start_date, r.due_date, r.user_id,
            a.name AS asset_name, u.full_name AS requested_by
     FROM reservations r
     JOIN assets a ON a.id = r.asset_id
     JOIN users  u ON u.id = r.user_id
     WHERE r.status IN ('in_approval','approved','checked_out')
       AND r.start_date < ? AND (r.due_date IS NULL OR r.due_date >= ?)
       AND a.college = ?
     ORDER BY r.start_date`,
    [rangeEnd, rangeStart, college]);
  return rows;
}

// ---- "Auto check in/out": runs on every page load ----
async function runAutomation() {
  const [due] = await db.query(`SELECT id FROM reservations
                                WHERE auto_checkout = 1 AND status = 'approved' AND start_date <= NOW()
                                  AND (due_date IS NULL OR due_date > NOW())`);
  for (const r of due) await checkout(r.id);        // only checks out when the units are really back
  await db.query(`UPDATE reservations SET status = 'returned'
                  WHERE auto_checkout = 1 AND status = 'checked_out'
                    AND due_date IS NOT NULL AND due_date <= NOW()`);
}

module.exports = { list, counts, pendingCount, createIfAvailable, checkout, peakCommitted, findDetails, transition,
                   remove, forRange, runAutomation };