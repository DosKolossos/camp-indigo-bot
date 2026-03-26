const db = require('../db/database');
const { calculateLevelFromXp } = require('./progressionService');

const ACTION_COOLDOWN_FIELDS = {
  sammeln: 'sammeln_cooldown_until',
  arbeiten: 'arbeiten_cooldown_until',
  trainieren: 'trainieren_cooldown_until'
};

function ensurePlayerColumn(name, definition) {
  const columns = db.prepare(`PRAGMA table_info(players)`).all();
  const exists = columns.some(column => column.name === name);

  if (!exists) {
    db.prepare(`ALTER TABLE players ADD COLUMN ${name} ${definition}`).run();
  }
}

ensurePlayerColumn('trainieren_cooldown_until', 'TEXT');
ensurePlayerColumn('busy_until', 'TEXT');
ensurePlayerColumn('busy_activity', 'TEXT');

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

  return refreshPlayerLevel(discordUserId);
}

function refreshPlayerLevel(discordUserId) {
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

function getCooldownField(actionKey) {
  return ACTION_COOLDOWN_FIELDS[actionKey] || null;
}

function setActionCooldown(discordUserId, actionKey, untilIso) {
  const field = getCooldownField(actionKey);
  if (!field) {
    throw new Error(`Unbekannte Action für Cooldown: ${actionKey}`);
  }

  db.prepare(`
    UPDATE players
    SET ${field} = ?, updated_at = ?
    WHERE discord_user_id = ?
  `).run(untilIso, new Date().toISOString(), discordUserId);

  return getPlayerByDiscordUserId(discordUserId);
}

function resetPlayerCooldowns(discordUserId) {
  db.prepare(`
    UPDATE players
    SET sammeln_cooldown_until = NULL,
        arbeiten_cooldown_until = NULL,
        trainieren_cooldown_until = NULL,
        updated_at = ?
    WHERE discord_user_id = ?
  `).run(new Date().toISOString(), discordUserId);

  return getPlayerByDiscordUserId(discordUserId);
}

function resetAllCooldowns() {
  db.prepare(`
    UPDATE players
    SET sammeln_cooldown_until = NULL,
        arbeiten_cooldown_until = NULL,
        trainieren_cooldown_until = NULL,
        updated_at = ?
  `).run(new Date().toISOString());
}

function setBusyState(discordUserId, activityKey, untilIso) {
  db.prepare(`
    UPDATE players
    SET busy_activity = ?,
        busy_until = ?,
        updated_at = ?
    WHERE discord_user_id = ?
  `).run(activityKey, untilIso, new Date().toISOString(), discordUserId);

  return getPlayerByDiscordUserId(discordUserId);
}

function clearBusyState(discordUserId) {
  db.prepare(`
    UPDATE players
    SET busy_activity = NULL,
        busy_until = NULL,
        updated_at = ?
    WHERE discord_user_id = ?
  `).run(new Date().toISOString(), discordUserId);

  return getPlayerByDiscordUserId(discordUserId);
}

function normalizeNullableDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function updatePlayerAdmin(id, payload = {}) {
  const currentPlayer = getPlayerById(id);
  if (!currentPlayer) return null;

  const nextPlayer = {
    ...currentPlayer,
    ...payload
  };

  nextPlayer.xp = Number.isFinite(Number(nextPlayer.xp))
    ? Math.max(0, Number(nextPlayer.xp))
    : currentPlayer.xp;

  nextPlayer.level = calculateLevelFromXp(nextPlayer.xp);
  nextPlayer.wood = Number.isFinite(Number(nextPlayer.wood)) ? Math.max(0, Number(nextPlayer.wood)) : currentPlayer.wood;
  nextPlayer.food = Number.isFinite(Number(nextPlayer.food)) ? Math.max(0, Number(nextPlayer.food)) : currentPlayer.food;
  nextPlayer.stone = Number.isFinite(Number(nextPlayer.stone)) ? Math.max(0, Number(nextPlayer.stone)) : currentPlayer.stone;
  nextPlayer.contribution = Number.isFinite(Number(nextPlayer.contribution)) ? Math.max(0, Number(nextPlayer.contribution)) : currentPlayer.contribution;

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE players
    SET discord_username = ?,
        pokemon_key = ?,
        guild_key = ?,
        level = ?,
        xp = ?,
        wood = ?,
        food = ?,
        stone = ?,
        contribution = ?,
        sammeln_cooldown_until = ?,
        arbeiten_cooldown_until = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    String(nextPlayer.discord_username || currentPlayer.discord_username),
    String(nextPlayer.pokemon_key || currentPlayer.pokemon_key),
    String(nextPlayer.guild_key || currentPlayer.guild_key),
    nextPlayer.level,
    nextPlayer.xp,
    nextPlayer.wood,
    nextPlayer.food,
    nextPlayer.stone,
    nextPlayer.contribution,
    normalizeNullableDate(nextPlayer.sammeln_cooldown_until),
    normalizeNullableDate(nextPlayer.arbeiten_cooldown_until),
    now,
    id
  );

  return getPlayerById(id);
}

function deletePlayerById(id) {
  return db.prepare(`DELETE FROM players WHERE id = ?`).run(id);
}

function deleteAllPlayers() {
  return db.prepare(`DELETE FROM players`).run();
}

function logPlayerActivity(discordUserId, actionKey, changes = {}) {
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO player_activity_log (
      discord_user_id,
      action_key,
      contribution_delta,
      xp_delta,
      wood_delta,
      food_delta,
      stone_delta,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    discordUserId,
    actionKey || null,
    Number(changes.contribution) || 0,
    Number(changes.xp) || 0,
    Number(changes.wood) || 0,
    Number(changes.food) || 0,
    Number(changes.stone) || 0,
    now
  );
}

function getTopContributorLast24Hours() {
  const since = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();

  return db.prepare(`
    SELECT
      p.discord_user_id,
      p.discord_username,
      p.guild_key,
      p.pokemon_key,
      COALESCE(SUM(l.contribution_delta), 0) as contribution_24h,
      COALESCE(SUM(l.xp_delta), 0) as xp_24h
    FROM player_activity_log l
    JOIN players p
      ON p.discord_user_id = l.discord_user_id
    WHERE l.created_at >= ?
    GROUP BY p.discord_user_id, p.discord_username, p.guild_key, p.pokemon_key
    HAVING contribution_24h > 0 OR xp_24h > 0
    ORDER BY contribution_24h DESC, xp_24h DESC, p.discord_username ASC
    LIMIT 1
  `).get(since);
}

module.exports = {
  ACTION_COOLDOWN_FIELDS,
  getPlayerByDiscordUserId,
  getPlayerById,
  createPlayer,
  allPlayers,
  updatePlayerProgress,
  refreshPlayerLevel,
  getCampTotals,
  setActionCooldown,
  resetPlayerCooldowns,
  resetAllCooldowns,
  updatePlayerAdmin,
  deletePlayerById,
  deleteAllPlayers,
  setBusyState,
  clearBusyState,
  logPlayerActivity,
  getTopContributorLast24Hours
};