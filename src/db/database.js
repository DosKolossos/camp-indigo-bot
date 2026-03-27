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

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some(column => column.name === columnName);

  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

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
    exploration_points INTEGER NOT NULL DEFAULT 0,
    food_credit INTEGER NOT NULL DEFAULT 0,
    guild_role_id TEXT,
    sammeln_cooldown_until TEXT,
    arbeiten_cooldown_until TEXT,
    trainieren_cooldown_until TEXT,
    busy_until TEXT,
    busy_activity TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS player_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL,
    action_key TEXT,
    contribution_delta INTEGER NOT NULL DEFAULT 0,
    exploration_points_delta INTEGER NOT NULL DEFAULT 0,
    xp_delta INTEGER NOT NULL DEFAULT 0,
    wood_delta INTEGER NOT NULL DEFAULT 0,
    food_delta INTEGER NOT NULL DEFAULT 0,
    stone_delta INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

ensureColumn('players', 'contribution', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'exploration_points', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'food_credit', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'sammeln_cooldown_until', 'TEXT');
ensureColumn('players', 'arbeiten_cooldown_until', 'TEXT');
ensureColumn('players', 'trainieren_cooldown_until', 'TEXT');
ensureColumn('players', 'busy_until', 'TEXT');
ensureColumn('players', 'busy_activity', 'TEXT');
ensureColumn('player_activity_log', 'exploration_points_delta', 'INTEGER NOT NULL DEFAULT 0');

module.exports = db;
