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
ensurePlayerColumn('exploration_points', 'INTEGER NOT NULL DEFAULT 0');
ensurePlayerColumn('food_credit', 'INTEGER NOT NULL DEFAULT 0');
ensurePlayerColumn('ore', 'INTEGER NOT NULL DEFAULT 0');
ensurePlayerColumn('fiber', 'INTEGER NOT NULL DEFAULT 0');
ensurePlayerColumn('scrap', 'INTEGER NOT NULL DEFAULT 0');
ensurePlayerColumn('weapon_tier', 'INTEGER NOT NULL DEFAULT 0');
ensurePlayerColumn('armor_tier', 'INTEGER NOT NULL DEFAULT 0');
ensurePlayerColumn('scanner_tier', 'INTEGER NOT NULL DEFAULT 0');

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

function allPlayers(guildKey = null) {
  if (!guildKey) {
    return db.prepare(`SELECT * FROM players ORDER BY created_at ASC`).all();
  }

  return db.prepare(`
    SELECT *
    FROM players
    WHERE guild_key = ?
    ORDER BY created_at ASC
  `).all(guildKey);
}

function updatePlayerProgress(discordUserId, changes = {}) {
  const fields = [];
  const values = [];

  if (typeof changes.xp === 'number') {
    fields.push('xp = MAX(0, xp + ?)');
    values.push(changes.xp);
  }

  if (typeof changes.wood === 'number') {
    fields.push('wood = MAX(0, wood + ?)');
    values.push(changes.wood);
  }

  if (typeof changes.food === 'number') {
    fields.push('food = MAX(0, food + ?)');
    values.push(changes.food);
  }

  if (typeof changes.stone === 'number') {
    fields.push('stone = MAX(0, stone + ?)');
    values.push(changes.stone);
  }

  if (typeof changes.contribution === 'number') {
    fields.push('contribution = MAX(0, contribution + ?)');
    values.push(changes.contribution);
  }

  if (typeof changes.exploration_points === 'number') {
    fields.push('exploration_points = MAX(0, exploration_points + ?)');
    values.push(changes.exploration_points);
  }

  if (typeof changes.food_credit === 'number') {
    fields.push('food_credit = MAX(0, food_credit + ?)');
    values.push(changes.food_credit);
  }

  if (typeof changes.ore === 'number') {
    fields.push('ore = MAX(0, ore + ?)');
    values.push(changes.ore);
  }

  if (typeof changes.fiber === 'number') {
    fields.push('fiber = MAX(0, fiber + ?)');
    values.push(changes.fiber);
  }

  if (typeof changes.scrap === 'number') {
    fields.push('scrap = MAX(0, scrap + ?)');
    values.push(changes.scrap);
  }

  if (typeof changes.weapon_tier === 'number') {
    fields.push('weapon_tier = MAX(0, weapon_tier + ?)');
    values.push(changes.weapon_tier);
  }

  if (typeof changes.armor_tier === 'number') {
    fields.push('armor_tier = MAX(0, armor_tier + ?)');
    values.push(changes.armor_tier);
  }

  if (typeof changes.scanner_tier === 'number') {
    fields.push('scanner_tier = MAX(0, scanner_tier + ?)');
    values.push(changes.scanner_tier);
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

function getCampTotals(guildKey = null) {
  const sql = `
    SELECT
      COUNT(*) as players,
      COALESCE(SUM(wood), 0) as wood,
      COALESCE(SUM(food), 0) as food,
      COALESCE(SUM(stone), 0) as stone,
      COALESCE(SUM(contribution), 0) as contribution,
      COALESCE(SUM(exploration_points), 0) as exploration_points,
      COALESCE(SUM(food_credit), 0) as food_credit,
      COALESCE(SUM(ore), 0) as ore,
      COALESCE(SUM(fiber), 0) as fiber,
      COALESCE(SUM(scrap), 0) as scrap,
      COALESCE(SUM(xp), 0) as xp
    FROM players
    ${guildKey ? 'WHERE guild_key = ?' : ''}
  `;

  return guildKey ? db.prepare(sql).get(guildKey) : db.prepare(sql).get();
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

function setPlayerBusy(discordUserId, activityKey, busyUntil) {
  db.prepare(`
    UPDATE players
    SET busy_until = ?, busy_activity = ?
    WHERE discord_user_id = ?
  `).run(busyUntil, activityKey, discordUserId);
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
  nextPlayer.exploration_points = Number.isFinite(Number(nextPlayer.exploration_points))
    ? Math.max(0, Number(nextPlayer.exploration_points))
    : currentPlayer.exploration_points;
  nextPlayer.food_credit = Number.isFinite(Number(nextPlayer.food_credit))
    ? Math.max(0, Number(nextPlayer.food_credit))
    : currentPlayer.food_credit;
  nextPlayer.ore = Number.isFinite(Number(nextPlayer.ore)) ? Math.max(0, Number(nextPlayer.ore)) : currentPlayer.ore;
  nextPlayer.fiber = Number.isFinite(Number(nextPlayer.fiber)) ? Math.max(0, Number(nextPlayer.fiber)) : currentPlayer.fiber;
  nextPlayer.scrap = Number.isFinite(Number(nextPlayer.scrap)) ? Math.max(0, Number(nextPlayer.scrap)) : currentPlayer.scrap;
  nextPlayer.weapon_tier = Number.isFinite(Number(nextPlayer.weapon_tier)) ? Math.max(0, Number(nextPlayer.weapon_tier)) : currentPlayer.weapon_tier;
  nextPlayer.armor_tier = Number.isFinite(Number(nextPlayer.armor_tier)) ? Math.max(0, Number(nextPlayer.armor_tier)) : currentPlayer.armor_tier;
  nextPlayer.scanner_tier = Number.isFinite(Number(nextPlayer.scanner_tier)) ? Math.max(0, Number(nextPlayer.scanner_tier)) : currentPlayer.scanner_tier;

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
        exploration_points = ?,
        food_credit = ?,
        ore = ?,
        fiber = ?,
        scrap = ?,
        weapon_tier = ?,
        armor_tier = ?,
        scanner_tier = ?,
        sammeln_cooldown_until = ?,
        arbeiten_cooldown_until = ?,
        trainieren_cooldown_until = ?,
        busy_until = ?,
        busy_activity = ?,
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
    nextPlayer.exploration_points,
    nextPlayer.food_credit,
    nextPlayer.ore,
    nextPlayer.fiber,
    nextPlayer.scrap,
    nextPlayer.weapon_tier,
    nextPlayer.armor_tier,
    nextPlayer.scanner_tier,
    normalizeNullableDate(nextPlayer.sammeln_cooldown_until),
    normalizeNullableDate(nextPlayer.arbeiten_cooldown_until),
    normalizeNullableDate(nextPlayer.trainieren_cooldown_until),
    normalizeNullableDate(nextPlayer.busy_until),
    nextPlayer.busy_activity || null,
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
      exploration_points_delta,
      xp_delta,
      wood_delta,
      food_delta,
      stone_delta,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    discordUserId,
    actionKey || null,
    Number(changes.contribution) || 0,
    Number(changes.exploration_points) || 0,
    Number(changes.xp) || 0,
    Number(changes.wood) || 0,
    Number(changes.food) || 0,
    Number(changes.stone) || 0,
    now
  );
}

function getTopContributorLast24Hours(guildKey = null) {
  const since = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();

  const sql = `
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
      ${guildKey ? 'AND p.guild_key = ?' : ''}
    GROUP BY p.discord_user_id, p.discord_username, p.guild_key, p.pokemon_key
    HAVING contribution_24h > 0 OR xp_24h > 0
    ORDER BY contribution_24h DESC, xp_24h DESC, p.discord_username ASC
    LIMIT 1
  `;

  return guildKey
    ? db.prepare(sql).get(since, guildKey)
    : db.prepare(sql).get(since);
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
  getTopContributorLast24Hours,
  setPlayerBusy
};
