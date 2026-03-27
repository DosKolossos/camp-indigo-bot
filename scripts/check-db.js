const Database = require('better-sqlite3');

const db = new Database('./camp_indigo.db');

console.log('players:', db.prepare('SELECT COUNT(*) AS c FROM players').get());

console.log(
  'totals:',
  db.prepare(`
    SELECT
      COALESCE(SUM(contribution), 0) AS contribution,
      COALESCE(SUM(xp), 0) AS xp,
      COUNT(*) AS players
    FROM players
  `).get()
);

console.log(
  'sample players:',
  db.prepare(`
    SELECT discord_username, guild_key, pokemon_key, contribution, xp, level
    FROM players
    ORDER BY contribution DESC
    LIMIT 5
  `).all()
);