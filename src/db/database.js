const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(process.cwd(), 'camp_indigo.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL UNIQUE,
    discord_username TEXT NOT NULL,
    pokemon_key TEXT NOT NULL,
    guild_key TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    wood INTEGER NOT NULL DEFAULT 0,
    food INTEGER NOT NULL DEFAULT 0,
    stone INTEGER NOT NULL DEFAULT 0,
    contribution INTEGER NOT NULL DEFAULT 0,
    guild_role_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

module.exports = db;
