const fs = require('fs');
const path = require('path');

if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(process.cwd(), 'camp_indigo.preview.db');
}

const { buildCampStatusPayload } = require('../src/services/campStatusService');
const guilds = require('../src/config/guilds');
const Database = require('better-sqlite3');

function seedPreviewDb() {
  const db = new Database(process.env.DB_PATH);

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

  db.prepare('DELETE FROM player_activity_log').run();
  db.prepare('DELETE FROM players').run();

  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO players (
      discord_user_id, discord_username, pokemon_key, guild_key,
      level, xp, wood, food, stone, contribution, exploration_points, food_credit,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'preview-user-1',
    'DosKolossos',
    'pikachu',
    'nimbus',
    5,
    228,
    12,
    8,
    6,
    120,
    92,
    4,
    now,
    now
  );

  const insertLog = db.prepare(`
    INSERT INTO player_activity_log (
      discord_user_id, action_key, contribution_delta, exploration_points_delta, xp_delta, wood_delta, food_delta, stone_delta, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertLog.run('preview-user-1', 'arbeiten', 20, 0, 40, 1, 0, 1, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
  insertLog.run('preview-user-1', 'erkunden', 0, 18, 18, 1, 1, 0, new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString());
  insertLog.run('preview-user-1', 'sammeln', 0, 0, 12, 2, 2, 1, new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString());
  insertLog.run('preview-user-1', 'erkunden', 0, 14, 10, 0, 1, 1, new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString());

  db.close();
}

function getPreviewGuildKey() {
  const db = new Database(process.env.DB_PATH, { readonly: true });

  try {
    const row = db.prepare(`
      SELECT guild_key, COUNT(*) AS amount
      FROM players
      WHERE guild_key IS NOT NULL
        AND TRIM(guild_key) != ''
      GROUP BY guild_key
      ORDER BY amount DESC, guild_key ASC
      LIMIT 1
    `).get();

    if (row?.guild_key) {
      return row.guild_key;
    }

    return guilds[0]?.key || null;
  } finally {
    db.close();
  }
}

async function main() {
  seedPreviewDb();

  const guildKey = getPreviewGuildKey();
  const payload = await buildCampStatusPayload(guildKey);

  if (!payload?.files?.length) {
    console.error('Kein Bild gerendert.');
    process.exit(1);
  }

  const file = payload.files[0];
  const outDir = path.join(process.cwd(), 'tmp');
  const outPath = path.join(outDir, 'camp-preview.png');

  fs.mkdirSync(outDir, { recursive: true });

  let buffer = null;

  if (Buffer.isBuffer(file.attachment)) {
    buffer = file.attachment;
  } else if (file.data && Buffer.isBuffer(file.data)) {
    buffer = file.data;
  } else {
    console.error('Konnte Attachment nicht als Buffer lesen.');
    process.exit(1);
  }

  fs.writeFileSync(outPath, buffer);
  console.log(`Preview geschrieben nach: ${outPath} (Gilde: ${guildKey || 'Fallback'})`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
