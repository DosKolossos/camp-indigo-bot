const fs = require('fs');
const path = require('path');

if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(process.cwd(), 'camp_indigo.preview.db');
}

const { buildCampStatusPayload } = require('../src/services/campStatusService');
const Database = require('better-sqlite3');

function seedPreviewDb() {
  const db = new Database(process.env.DB_PATH);
  const now = new Date().toISOString();

  db.prepare('DELETE FROM player_activity_log').run();
  db.prepare('DELETE FROM players').run();

  const insertPlayer = db.prepare(`
    INSERT INTO players (
      discord_user_id, discord_username, pokemon_key, guild_key,
      level, xp, wood, food, stone, contribution, exploration_points,
      ore, fiber, scrap, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertPlayer.run('preview-user-1', 'DosKolossos', 'pikachu', 'nimbus', 12, 1600, 12, 8, 6, 120, 900, 4, 3, 2, now, now);
  insertPlayer.run('preview-user-2', 'CampScout', 'treecko', 'nimbus', 11, 1500, 8, 6, 4, 90, 760, 3, 4, 1, now, now);

  const insertLog = db.prepare(`
    INSERT INTO player_activity_log (
      discord_user_id, action_key, contribution_delta, exploration_points_delta,
      xp_delta, wood_delta, food_delta, stone_delta, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertLog.run('preview-user-1', 'arbeiten', 20, 0, 40, 1, 0, 1, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
  insertLog.run('preview-user-2', 'erkunden', 0, 18, 18, 1, 1, 0, new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());
  db.close();
}

async function main() {
  // Loading database.js creates all currently required tables before the preview is seeded.
  require('../src/db/database');
  seedPreviewDb();

  const payload = await buildCampStatusPayload('nimbus');
  const embed = payload.embeds?.[0]?.toJSON?.() || payload.embeds?.[0] || {};
  const lines = [
    embed.title || 'Camp-Fortschritt',
    '',
    embed.description || '',
    '',
    ...(embed.fields || []).flatMap(field => [field.name, field.value, ''])
  ];

  const outDir = path.join(process.cwd(), 'tmp');
  const outPath = path.join(outDir, 'camp-preview.txt');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, `${lines.join('\n').trim()}\n`, 'utf8');
  console.log(`Textvorschau geschrieben nach: ${outPath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
