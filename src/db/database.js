const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir =
  process.env.DB_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  '/data';

fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'camp_indigo.db');
console.log(`[db] using sqlite file: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;