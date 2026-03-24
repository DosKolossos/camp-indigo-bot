const db = require('../db/database');

const XP_PER_LEVEL = 20;

function getPlayerByDiscordUserId(discordUserId) {
  return db.prepare(`
    SELECT *
    FROM players
    WHERE discord_user_id = ?
  `).get(discordUserId);
}

function getPlayerById(id) {
  return db.prepare(`
    SELECT *
    FROM players
    WHERE id = ?
  `).get(id);
}

function calculateLevelFromXp(xp) {
  return Math.max(1, Math.floor(xp / XP_PER_LEVEL) + 1);
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

  return getPlayerById(result.lastInsertRowid);
}

function allPlayers() {
  return db.prepare(`SELECT * FROM players ORDER BY created_at ASC`).all();
}

function updatePlayerProgress(discordUserId, changes = {}) {
  const fields = [];
  const values = [];

  if (typeof changes.xp === 'number') {
    fields.push('xp = xp + ?');
    values.push(changes.xp);
  }

  if (typeof changes.wood === 'number') {
    fields.push('wood = wood + ?');
    values.push(changes.wood);
  }

  if (typeof changes.food === 'number') {
    fields.push('food = food + ?');
    values.push(changes.food);
  }

  if (typeof changes.stone === 'number') {
    fields.push('stone = stone + ?');
    values.push(changes.stone);
  }

  if (typeof changes.contribution === 'number') {
    fields.push('contribution = contribution + ?');
    values.push(changes.contribution);
  }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(discordUserId);

  db.prepare(`
    UPDATE players
    SET ${fields.join(', ')}
    WHERE discord_user_id = ?
  `).run(...values);

  const player = getPlayerByDiscordUserId(discordUserId);
  if (!player) return null;

  const targetLevel = calculateLevelFromXp(player.xp);
  if (targetLevel !== player.level) {
    db.prepare(`
      UPDATE players
      SET level = ?, updated_at = ?
      WHERE discord_user_id = ?
    `).run(targetLevel, new Date().toISOString(), discordUserId);

    return getPlayerByDiscordUserId(discordUserId);
  }

  return player;
}

function getCampTotals() {
  return db.prepare(`
    SELECT
      COUNT(*) as players,
      COALESCE(SUM(wood), 0) as wood,
      COALESCE(SUM(food), 0) as food,
      COALESCE(SUM(stone), 0) as stone,
      COALESCE(SUM(contribution), 0) as contribution,
      COALESCE(SUM(xp), 0) as xp
    FROM players
  `).get();
}

module.exports = {
  XP_PER_LEVEL,
  calculateLevelFromXp,
  getPlayerByDiscordUserId,
  createPlayer,
  allPlayers,
  updatePlayerProgress,
  getCampTotals
};
