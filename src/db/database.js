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
    ore INTEGER NOT NULL DEFAULT 0,
    fiber INTEGER NOT NULL DEFAULT 0,
    scrap INTEGER NOT NULL DEFAULT 0,
    weapon_tier INTEGER NOT NULL DEFAULT 0,
    armor_tier INTEGER NOT NULL DEFAULT 0,
    scanner_tier INTEGER NOT NULL DEFAULT 0,
    guild_role_id TEXT,
    sammeln_cooldown_until TEXT,
    arbeiten_cooldown_until TEXT,
    trainieren_cooldown_until TEXT,
    expedition_cooldown_until TEXT,
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

  CREATE TABLE IF NOT EXISTS boss_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_date TEXT NOT NULL UNIQUE,
    boss_key TEXT NOT NULL,
    boss_name TEXT NOT NULL,
    boss_power INTEGER NOT NULL,
    food_target INTEGER NOT NULL DEFAULT 10,
    food_invested INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'funding',
    spawn_at TEXT NOT NULL,
    resolve_at TEXT NOT NULL,
    spawned_at TEXT,
    resolved_at TEXT,
    success_roll INTEGER,
    success_chance REAL,
    team_power INTEGER NOT NULL DEFAULT 0,
    participant_count INTEGER NOT NULL DEFAULT 0,
    announced_spawn_at TEXT,
    announced_result_at TEXT,
    reward_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS boss_event_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    discord_user_id TEXT NOT NULL,
    donated_food INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT,
    participant_power INTEGER NOT NULL DEFAULT 0,
    reward_json TEXT,
    result_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(event_id, player_id),
    FOREIGN KEY(event_id) REFERENCES boss_events(id) ON DELETE CASCADE,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS player_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(player_id, item_key),
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS market_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_player_id INTEGER NOT NULL,
    buyer_player_id INTEGER,
    item_key TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    price_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sold_at TEXT,
    cancelled_at TEXT,
    FOREIGN KEY(seller_player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY(buyer_player_id) REFERENCES players(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_player_items_player_id
    ON player_items(player_id);

  CREATE INDEX IF NOT EXISTS idx_boss_events_status_spawn_at
    ON boss_events(status, spawn_at);

  CREATE INDEX IF NOT EXISTS idx_boss_event_players_event_id
    ON boss_event_players(event_id);

  CREATE INDEX IF NOT EXISTS idx_boss_event_players_player_id
    ON boss_event_players(player_id);

  CREATE INDEX IF NOT EXISTS idx_market_listings_status_created_at
    ON market_listings(status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_market_listings_seller_status
    ON market_listings(seller_player_id, status, created_at DESC);
`);

ensureColumn('players', 'contribution', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'exploration_points', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'food_credit', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'sammeln_cooldown_until', 'TEXT');
ensureColumn('players', 'arbeiten_cooldown_until', 'TEXT');
ensureColumn('players', 'trainieren_cooldown_until', 'TEXT');
ensureColumn('players', 'expedition_cooldown_until', 'TEXT');
ensureColumn('players', 'busy_until', 'TEXT');
ensureColumn('players', 'busy_activity', 'TEXT');
ensureColumn('players', 'ore', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'fiber', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'scrap', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'weapon_tier', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'armor_tier', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'scanner_tier', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('player_activity_log', 'exploration_points_delta', 'INTEGER NOT NULL DEFAULT 0');

module.exports = db;