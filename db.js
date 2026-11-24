// db.js - shared connection pool
const mysql = require('mysql2/promise');
require('dotenv').config();

const ssl = {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
};

const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: ssl,
    waitForConnections: true,
    connectionLimit: 5
});

module.exports = { db };