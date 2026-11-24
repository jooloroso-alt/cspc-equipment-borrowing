// helpers.js - small formatting functions used by routes AND views.

const STATUS_LABEL = {
  in_approval: 'In-approval', approved: 'Approved', declined: 'Declined',
  checked_out: 'Checked out', returned: 'Returned', cancelled: 'Cancelled'
};
const statusLabel = (s) => STATUS_LABEL[s] || s;

const pad = (n) => String(n).padStart(2, '0');

// Date -> "2026-10-18" (local time, used in URLs and the calendar)
const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

// Date -> "Jun 24, 2025 1:42 PM"  (same look as the screenshot)
const fmtDateTime = (d) => {
  if (!d) return 'Indefinite';
  const x = new Date(d);
  return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
         ' ' + x.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

// Date -> "1:42 PM"
const fmtTime = (d) =>
  new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// Date -> "2026-10-18T13:42"  (value format of <input type="datetime-local">)
const toInputValue = (d) => {
  const x = new Date(d);
  return `${ymd(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

// "2026-10-18T13:42" -> "2026-10-18 13:42:00" (MySQL DATETIME). Returns null if invalid.
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const toSqlDateTime = (v) => (DT_RE.test(v) && !isNaN(new Date(v)) ? v.replace('T', ' ') + ':00' : null);

// The five colleges that own equipment (code -> full name)
const COLLEGES = [
  { code: 'CCS',   name: 'College of Computer Studies' },
  { code: 'CEA',   name: 'College of Engineering and Architecture' },
  { code: 'CHS',   name: 'College of Health Sciences' },
  { code: 'CAS',   name: 'College of Arts and Sciences' },
  { code: 'CTHBM', name: 'College of Tourism, Hospitality and Business Management' },
  { code: 'CTDE',  name: 'College of Technological and Developmental Education' }
];
const COLLEGE_CODES = COLLEGES.map((c) => c.code);

// ---- Student email rule ----
// First 2 letters of the first name + the last name, then @my.cspc.edu.ph
// Example: Joshua Paul Veras -> joveras@my.cspc.edu.ph  (the middle name is not used)
const STUDENT_EMAIL_DOMAIN = '@my.cspc.edu.ph';
const lettersOnly = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z]/g, '');                  // removes accents, spaces, dots, hyphens
const expectedStudentEmail = (first, last) =>
  lettersOnly(first).slice(0, 2) + lettersOnly(last) + STUDENT_EMAIL_DOMAIN;

module.exports = { expectedStudentEmail, lettersOnly, STUDENT_EMAIL_DOMAIN, COLLEGES, COLLEGE_CODES,
                   statusLabel, ymd, fmtDateTime, fmtTime, toInputValue, toSqlDateTime };