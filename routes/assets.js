// routes/assets.js - admin-only equipment management, one tab per college.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const A = require('../models/assetModel');
const R = require('../models/reservationModel');
const { requireAdmin, csrfValid, flash } = require('../middleware/auth');
const { COLLEGES, COLLEGE_CODES } = require('../helpers');

const router = express.Router();

// After every action the admin lands back on the SAME college tab:  /assets?college=CEA
const tabUrl = (college) => '/assets' + (COLLEGE_CODES.includes(college) ? '?college=' + college : '');

// ----- Equipment photos -----
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'equipment');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// The photo is read into memory first (max 2 MB) and only written to disk after every check passes
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 5 } });

// What the file REALLY is, judged by its first bytes - not by its name or what the browser says.
// Only JPG, PNG and WEBP are accepted (no SVG/HTML, which could carry scripts).
function imageType(buf) {
  if (buf.length > 12 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
// Delete an old photo file safely (basename() makes sure it stays inside the uploads folder)
const removeFile = (name) => name && fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(name))).catch(() => {});

// Clean + validate the form fields. Returns { data } or { error }.
function readAsset(body) {
  const data = {
    name: String(body.name || '').trim(),
    tag: String(body.asset_tag || '').trim(),
    college: String(body.college || ''),
    category: String(body.category || '').trim() || 'General',
    quantity: String(body.quantity === undefined ? '1' : body.quantity).trim(),
    maintenance: String(body.maintenance === undefined ? '0' : body.maintenance).trim()      // units under maintenance
  };
  if (!data.name || data.name.length > 120) return { error: 'Asset name is required (max 120 characters).' };
  if (!data.tag || data.tag.length > 40) return { error: 'Asset tag is required (max 40 characters).' };
  if (!COLLEGE_CODES.includes(data.college)) return { error: 'Please choose a college.' };
  if (data.category.length > 60) return { error: 'Category is too long (max 60 characters).' };
  if (!/^\d{1,3}$/.test(data.quantity) || Number(data.quantity) < 1) return { error: 'Quantity must be a whole number from 1 to 999.' };
  data.quantity = Number(data.quantity);
  if (!/^\d{1,3}$/.test(data.maintenance)) return { error: 'Units in maintenance must be a whole number (0 or more).' };
  data.maintenance = Number(data.maintenance);
  if (data.maintenance > data.quantity) return { error: 'Units in maintenance cannot be more than the quantity.' };
  return { data };
}

// ----- The page: one tab per college -----
router.get('/assets', requireAdmin, async (req, res, next) => {
  try {
    const all = await A.list();
    const tabs = COLLEGES.map((c) => {
      const items = all.filter((a) => a.college === c.code);
      return { ...c, items, units: items.reduce((n, a) => n + a.quantity, 0) };
    });
    const current = tabs.find((t) => t.code === req.query.college) || tabs[0];   // unknown value -> first tab
    res.render('assets', { title: 'Assets', tabs, current });
  } catch (e) { next(e); }
});

router.post('/assets', requireAdmin, async (req, res, next) => {
  const back = tabUrl(String(req.body.college || ''));
  try {
    const { data, error } = readAsset(req.body);
    if (error) flash(req, 'error', error);
    else { await A.create(data); flash(req, 'success', 'Asset added.'); }
    res.redirect(back);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') { flash(req, 'error', 'That asset tag already exists.'); return res.redirect(back); }
    next(e);
  }
});

router.post('/assets/:id', requireAdmin, async (req, res, next) => {
  const back = tabUrl(String(req.body.college || ''));
  try {
    const id = Number.parseInt(req.params.id, 10);
    const { data, error } = readAsset(req.body);
    // Units that are borrowed now, or that students already asked for at the same time, must stay in service
    const mustStay = !error && Number.isInteger(id)
      ? Math.max(await A.borrowedUnits(id), await R.peakCommitted(id)) : 0;
    if (error || !Number.isInteger(id)) flash(req, 'error', error || 'Invalid asset.');
    else if (data.quantity - data.maintenance < mustStay) {
      flash(req, 'error', `At least ${mustStay} unit${mustStay === 1 ? '' : 's'} must stay in service, because students have borrowed or requested ` +
                          `${mustStay === 1 ? 'it' : 'them'} at the same time. Lower the units in maintenance (or raise the quantity).`);
    }
    else flash(req, (await A.update(id, data)) ? 'success' : 'error', 'Asset saved.');
    res.redirect(back);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') { flash(req, 'error', 'That asset tag already exists.'); return res.redirect(back); }
    next(e);
  }
});

router.post('/assets/:id/delete', requireAdmin, async (req, res, next) => {
  let back = '/assets';
  try {
    const id = Number.parseInt(req.params.id, 10);
    const asset = Number.isInteger(id) ? await A.findById(id) : null;
    back = tabUrl(asset && asset.college);
    if (asset && (await A.remove(id))) { removeFile(asset.image); flash(req, 'success', 'Asset deleted.'); }
    else flash(req, 'error', 'Could not delete that asset.');
    res.redirect(back);
  } catch (e) {
    // The database refuses to delete an asset that still has reservation history
    if (e.code === 'ER_ROW_IS_REFERENCED_2') {
      flash(req, 'error', 'This asset has reservation history, so it cannot be deleted. Put all of its units in maintenance instead.');
      return res.redirect(back);
    }
    next(e);
  }
});

// ----- Upload / replace a photo (multipart form) -----
router.post('/assets/:id/image', requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, async (err) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      const asset = Number.isInteger(id) ? await A.findById(id) : null;
      const back = tabUrl(asset && asset.college);

      if (err) {
        flash(req, 'error', err.code === 'LIMIT_FILE_SIZE' ? 'That photo is too big (max 2 MB).' : 'Upload failed. Please try again.');
        return res.redirect(back);
      }
      // The token is inside the multipart form, so it is checked here instead of in app.js
      if (!csrfValid(req, req.body && req.body._csrf)) {
        return res.status(403).render('error', { title: 'Blocked', message: 'Invalid or missing security token. Go back, refresh the page, and try again.' });
      }
      const type = req.file ? imageType(req.file.buffer) : null;
      if (!asset || !type) {
        flash(req, 'error', 'Please choose a JPG, PNG or WEBP photo.');
        return res.redirect(back);
      }

      const filename = crypto.randomBytes(16).toString('hex') + '.' + type;     // random name, never the uploaded one
      await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), req.file.buffer, { flag: 'wx' });
      await A.setImage(id, filename);
      removeFile(asset.image);                                                  // the old photo is no longer needed
      flash(req, 'success', 'Photo saved.');
      res.redirect(back);
    } catch (e) { next(e); }
  });
});

// ----- Remove a photo (the equipment goes back to the placeholder) -----
router.post('/assets/:id/image/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const asset = Number.isInteger(id) ? await A.findById(id) : null;
    if (asset) { await A.setImage(id, null); removeFile(asset.image); flash(req, 'success', 'Photo removed.'); }
    res.redirect(tabUrl(asset && asset.college));
  } catch (e) { next(e); }
});

module.exports = router;