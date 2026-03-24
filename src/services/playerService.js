const db = require('../db/database');

function getPlayerByDiscordUserId(discordUserId) {
  return db.prepare(`
    SELECT *
    FROM players
    WHERE discord_user_id = ?
  `).get(discordUserId);
}

function createPlayer({ discordUserId, discordUsername, pokemonKey, guildKey, guildRoleId = null }) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO players (
      discord_user_id,
      discord_username,
      pokemon_key,
      guild_key,
      guild_role_id,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(discordUserId, discordUsername, pokemonKey, guildKey, guildRoleId, now, now);

  return db.prepare(`
    SELECT *
    FROM players
    WHERE id = ?
  `).get(result.lastInsertRowid);
}

function allPlayers() {
  return db.prepare(`SELECT * FROM players ORDER BY created_at ASC`).all();
}

module.exports = {
  getPlayerByDiscordUserId,
  createPlayer,
  allPlayers
};
