// routes/equipment.js - the equipment of the student's OWN college only.
const express = require('express');
const A = require('../models/assetModel');
const { requireUser } = require('../middleware/auth');
const { COLLEGES } = require('../helpers');

const router = express.Router();

router.get('/equipment', requireUser, async (req, res, next) => {
  try {
    const college = COLLEGES.find((c) => c.code === req.session.user.college);
    if (!college) {
      return res.status(403).render('error', { title: 'No college', message: 'Your account has no college. Please contact the property office.' });
    }
    const items = await A.list(college.code);      // the college comes from the SESSION, never from the URL
    res.render('equipment', { title: 'Equipment', college, items });
  } catch (e) { next(e); }
});

module.exports = router;