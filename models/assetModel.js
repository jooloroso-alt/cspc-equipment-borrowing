// models/assetModel.js - all SQL about assets (equipment).
const { db } = require('../db');

const num = (v) => Number(v || 0);          // SUM() comes back as text or NULL

// maintenance_qty = units under maintenance (cannot be borrowed); the rest can still be booked
// borrowed        = units that are checked out RIGHT NOW (worked out from reservations, so it never goes out of sync)
// available       = quantity - maintenance_qty - borrowed
// list()           -> every college (admin)
// list('CCS')      -> only that college (students)
async function list(college = null) {
  const params = [];
  let where = '';
  if (college) { where = 'WHERE a.college = ?'; params.push(college); }
  const [rows] = await db.query(
    `SELECT a.id, a.name, a.asset_tag, a.college, a.category, a.quantity, a.maintenance_qty, a.image,
            COALESCE((SELECT SUM(r.qty) FROM reservations r
                      WHERE r.asset_id = a.id AND r.status = 'checked_out'), 0) AS borrowed
     FROM assets a ${where} ORDER BY a.college, a.name, a.asset_tag`, params);
  return rows.map((a) => {
    const borrowed = num(a.borrowed);
    const usable = a.quantity - a.maintenance_qty;                 // units that can be borrowed at all
    return { ...a, borrowed, usable, available: Math.max(0, usable - borrowed) };
  });
}

// Equipment a student may book: their own college only, and at least one unit NOT under maintenance
async function listBookable(college) {
  const [rows] = await db.query(
    `SELECT id, name, asset_tag, college, quantity, maintenance_qty FROM assets
     WHERE college = ? AND quantity > maintenance_qty ORDER BY name, asset_tag`, [college]);
  return rows;
}

async function findById(id) {
  const [rows] = await db.query('SELECT id, name, college, quantity, maintenance_qty, image FROM assets WHERE id = ?', [id]);
  return rows[0];
}

// Units of one asset that are checked out right now
async function borrowedUnits(id) {
  const [rows] = await db.query(
    "SELECT COALESCE(SUM(qty), 0) AS n FROM reservations WHERE asset_id = ? AND status = 'checked_out'", [id]);
  return num(rows[0].n);
}

async function create({ name, tag, college, category, quantity, maintenance }) {
  const [r] = await db.query(
    'INSERT INTO assets (name, asset_tag, college, category, quantity, maintenance_qty) VALUES (?, ?, ?, ?, ?, ?)',
    [name, tag, college, category, quantity, maintenance]);
  return r.insertId;
}

async function update(id, { name, tag, college, category, quantity, maintenance }) {
  const [r] = await db.query(
    'UPDATE assets SET name = ?, asset_tag = ?, college = ?, category = ?, quantity = ?, maintenance_qty = ? WHERE id = ?',
    [name, tag, college, category, quantity, maintenance, id]);
  return r.affectedRows === 1;
}

// Save (or clear, with null) the photo file name of an asset
async function setImage(id, filename) {
  const [r] = await db.query('UPDATE assets SET image = ? WHERE id = ?', [filename, id]);
  return r.affectedRows === 1;
}

async function remove(id) {
  const [r] = await db.query('DELETE FROM assets WHERE id = ?', [id]);
  return r.affectedRows === 1;
}

module.exports = { list, listBookable, findById, borrowedUnits, create, update, setImage, remove };