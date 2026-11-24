-- =====================================================================
-- database.sql  -  CSPC Equipment Borrowing System
-- Import with phpMyAdmin (Import tab) or:  mysql -u root < database.sql
-- WARNING: the DROP TABLE lines wipe existing data. Fine for first setup.
-- =====================================================================
CREATE DATABASE IF NOT EXISTS equipment_borrowing
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE equipment_borrowing;

DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS users;

-- ---------- USERS (both roles live here; "role" decides access) -------
CREATE TABLE users (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  full_name         VARCHAR(120) NOT NULL,
  email             VARCHAR(160) NOT NULL UNIQUE,      -- UNIQUE: no duplicate accounts
  password_hash     VARCHAR(255) NOT NULL,             -- bcrypt hash, never the password
  role              ENUM('user','admin') NOT NULL DEFAULT 'user',
  college           ENUM('CCS','CEA','CHS','CAS','CTHBM','CTDE') NULL,   -- students only; admin has none
  email_verified    TINYINT(1) NOT NULL DEFAULT 0,     -- 1 = the student clicked the link in the email
  verify_token_hash CHAR(64) NULL,                     -- SHA-256 of the link token (never the token itself)
  verify_expires    DATETIME NULL,                     -- the link stops working after this time
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- ASSETS (the equipment that can be borrowed) ---------------
CREATE TABLE assets (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  asset_tag  VARCHAR(40)  NOT NULL UNIQUE,
  college    ENUM('CCS','CEA','CHS','CAS','CTHBM','CTDE') NOT NULL,   -- which college owns it
  category   VARCHAR(60)  NOT NULL DEFAULT 'General',
  quantity   INT NOT NULL DEFAULT 1,                           -- how many units the college owns
  image      VARCHAR(80)  NULL,                                -- photo file name (uploaded by the admin)
  status     ENUM('available','maintenance') NOT NULL DEFAULT 'available',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_assets_college (college)
);

-- ---------- RESERVATIONS (one row per borrow request) -----------------
-- Life cycle:  in_approval -> approved -> checked_out -> returned
--              in_approval -> declined | cancelled
CREATE TABLE reservations (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  asset_id      INT NOT NULL,
  user_id       INT NOT NULL,
  qty           INT NOT NULL DEFAULT 1,                -- how many units this request borrows
  status        ENUM('in_approval','approved','declined','checked_out','returned','cancelled')
                NOT NULL DEFAULT 'in_approval',
  start_date    DATETIME NOT NULL,
  due_date      DATETIME NULL,                     -- NULL = "indefinite return"
  auto_checkout TINYINT(1) NOT NULL DEFAULT 0,     -- the "Auto check in/out" box
  notes         VARCHAR(255) NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_res_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_res_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  INDEX idx_res_asset_dates (asset_id, start_date, due_date),
  INDEX idx_res_user_status (user_id, status)
);

-- ---------- SAMPLE DATA ------------------------------------------------
-- Passwords (bcrypt cost 12):  admin = Admin@12345   |   students = User@12345
-- CHANGE THESE before showing the system to anyone outside class.
-- Student emails follow the CSPC format: first 2 letters of first name + last name @my.cspc.edu.ph
INSERT INTO users (full_name, email, password_hash, role, college, email_verified) VALUES
 ('CSPC Property Office', 'admin@cspc.local',          '$2b$12$zMy934LHwcysXC3T4iYpOue6ynzHpkTHgZGedx3yYQa4AWG7zOdSW', 'admin', NULL,  1),
 ('Emily Ly',             'emly@my.cspc.edu.ph',       '$2b$12$uWED1w4m704.yWzoQsVX/OOsqjl4wAvPppB.KbRSWj5b8MyXoe1Zq', 'user',  'CCS', 1),
 ('Juan Dela Cruz',       'judelacruz@my.cspc.edu.ph', '$2b$12$uWED1w4m704.yWzoQsVX/OOsqjl4wAvPppB.KbRSWj5b8MyXoe1Zq', 'user',  'CEA', 1),
 ('Maria Santos',         'masantos@my.cspc.edu.ph',   '$2b$12$uWED1w4m704.yWzoQsVX/OOsqjl4wAvPppB.KbRSWj5b8MyXoe1Zq', 'user',  'CHS', 1);

INSERT INTO assets (name, asset_tag, college, category, status) VALUES
 -- CCS - College of Computer Studies (ids 1-4)
 ('Laptop (Lenovo ThinkPad)',  'CCS-LT-01', 'CCS', 'Laptop',     'available'),
 ('Arduino Starter Kit',       'CCS-AK-01', 'CCS', 'Electronics','available'),
 ('Network Switch Kit',        'CCS-NS-01', 'CCS', 'Networking', 'available'),
 ('LCD Projector',             'CCS-PJ-01', 'CCS', 'AV',         'available'),
 -- CEA - College of Engineering and Architecture (ids 5-8)
 ('Theodolite',                'CEA-TH-01', 'CEA', 'Surveying',  'available'),
 ('Total Station',             'CEA-TS-01', 'CEA', 'Surveying',  'available'),
 ('Digital Multimeter',        'CEA-DM-01', 'CEA', 'Electrical', 'available'),
 ('Laser Distance Meter',      'CEA-LD-01', 'CEA', 'Measuring',  'maintenance'),
 -- CHS - College of Health Sciences (ids 9-12)
 ('Blood Pressure Apparatus',  'CHS-BP-01', 'CHS', 'Clinical',   'available'),
 ('Stethoscope Set',           'CHS-ST-01', 'CHS', 'Clinical',   'available'),
 ('CPR Training Manikin',      'CHS-CM-01', 'CHS', 'Training',   'available'),
 ('Pulse Oximeter',            'CHS-PO-01', 'CHS', 'Clinical',   'available'),
 -- CAS - College of Arts and Sciences (ids 13-16)
 ('Digital Voice Recorder',    'CAS-VR-01', 'CAS', 'AV',         'available'),
 ('Compound Microscope',       'CAS-MS-01', 'CAS', 'Laboratory', 'available'),
 ('Digital Camera',            'CAS-DC-01', 'CAS', 'Camera',     'available'),
 ('Portable PA System',        'CAS-PA-01', 'CAS', 'AV',         'available'),
 -- CTHBM - College of Tourism, Hospitality and Business Management (ids 17-20)
 ('Stand Mixer',               'CTHBM-MX-01', 'CTHBM', 'Kitchen', 'available'),
 ('Chafing Dish Set',          'CTHBM-CD-01', 'CTHBM', 'Catering','available'),
 ('Bar Tools Set',             'CTHBM-BT-01', 'CTHBM', 'Bar',     'available'),
 ('Wireless Microphone Set',   'CTHBM-WM-01', 'CTHBM', 'AV',      'available');

-- Dates are relative to NOW() so the dashboard cards always show data.
-- Each student only borrows from THEIR college:  Emily = CCS (assets 1-4), Juan = CEA (5-8), Maria = CHS (9-12)
INSERT INTO reservations (asset_id, user_id, status, start_date, due_date, auto_checkout, notes) VALUES
 (1,  2, 'in_approval', NOW() - INTERVAL 20 DAY, NOW() - INTERVAL 18 DAY, 0, 'Thesis documentation'),
 (2,  2, 'in_approval', NOW() - INTERVAL 15 DAY, NOW() - INTERVAL 12 DAY, 0, NULL),
 (7,  3, 'in_approval', NOW() - INTERVAL 9 DAY,  NOW() - INTERVAL 7 DAY,  0, 'Electrical lab'),
 (3,  2, 'declined',    NOW() - INTERVAL 5 DAY,  NOW() - INTERVAL 4 DAY,  0, 'Network lab activity'),
 (4,  2, 'approved',    NOW() + INTERVAL 1 HOUR, NOW() + INTERVAL 5 HOUR, 0, 'Class presentation'),
 (6,  3, 'checked_out', NOW() - INTERVAL 1 DAY,  NOW() + INTERVAL 2 DAY,  0, 'Field survey'),
 (5,  3, 'returned',    NOW() - INTERVAL 30 DAY, NOW() - INTERVAL 28 DAY, 0, NULL),
 (2,  2, 'in_approval', NOW() + INTERVAL 3 DAY,  NOW() + INTERVAL 4 DAY,  1, 'Auto check in/out demo'),
 (7,  3, 'in_approval', NOW() + INTERVAL 2 DAY,  NOW() + INTERVAL 3 DAY,  0, 'Wiring exercise'),
 (10, 4, 'in_approval', NOW() + INTERVAL 1 DAY,  NOW() + INTERVAL 2 DAY,  0, 'Skills laboratory');