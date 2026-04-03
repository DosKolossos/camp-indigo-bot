const db = require('../db/database');
const { calculateLevelFromXp } = require('./progressionService');

const ACTION_COOLDOWN_FIELDS = {
  sammeln: 'sammeln_cooldown_until',
  arbeiten: 'arbeiten_cooldown_until',
  trainieren: 'trainieren_cooldown_until',
  expedition: 'expedition_cooldown_until'
};

function ensurePlayerColumn(name, definition) {
  const columns = db.prepare(`PRAGMA table_info(players)`).all();
  const exists = columns.some(column => column.name === name);

  if (!exists) {
    db.prepare(`ALTER TABLE players ADD COLUMN ${name} ${definition}`).run();
  }
}

ensurePlayerColumn('trainieren_cooldown_until', 'TEXT');
ensurePlayerColumn('expedition_cooldown_until', 'TEXT');
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

  if (!fields.length) {
    return getPlayerByDiscordUserId(discordUserId);
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
  const nextLevel = calculateLevelFromXp(player.xp);

  if (player.level !== nextLevel) {
    db.prepare(`
      UPDATE players
      SET level = ?, updated_at = ?
      WHERE discord_user_id = ?
    `).run(nextLevel, new Date().toISOString(), discordUserId);
  }

  return getPlayerByDiscordUserId(discordUserId);
}

function getCampTotals() {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS players,
      SUM(xp) AS xp,
      SUM(wood) AS wood,
      SUM(food) AS food,
      SUM(stone) AS stone,
      SUM(contribution) AS contribution,
      SUM(exploration_points) AS exploration_points,
      SUM(ore) AS ore,
      SUM(fiber) AS fiber,
      SUM(scrap) AS scrap
    FROM players
  `).get();

  return {
    players: Number(row?.players || 0),
    xp: Number(row?.xp || 0),
    wood: Number(row?.wood || 0),
    food: Number(row?.food || 0),
    stone: Number(row?.stone || 0),
    contribution: Number(row?.contribution || 0),
    exploration_points: Number(row?.exploration_points || 0),
    ore: Number(row?.ore || 0),
    fiber: Number(row?.fiber || 0),
    scrap: Number(row?.scrap || 0)
  };
}

function getActionCooldownField(actionKey) {
  return ACTION_COOLDOWN_FIELDS[actionKey] || null;
}

function setActionCooldown(discordUserId, actionKey, untilIsoString = null) {
  const fieldName = getActionCooldownField(actionKey);
  if (!fieldName) {
    throw new Error(`Unbekannter Cooldown-Key: ${actionKey}`);
  }

  db.prepare(`
    UPDATE players
    SET ${fieldName} = ?, updated_at = ?
    WHERE discord_user_id = ?
  `).run(untilIsoString, new Date().toISOString(), discordUserId);

  return getPlayerByDiscordUserId(discordUserId);
}

function setPlayerBusy(discordUserId, activityKey = null, untilIsoString = null) {
  db.prepare(`
    UPDATE players
    SET busy_until = ?, busy_activity = ?, updated_at = ?
    WHERE discord_user_id = ?
  `).run(untilIsoString, activityKey, new Date().toISOString(), discordUserId);

  return getPlayerByDiscordUserId(discordUserId);
}

function clearPlayerBusy(discordUserId) {
  return setPlayerBusy(discordUserId, null, null);
}

function logPlayerActivity(discordUserId, actionKey, changes = {}) {
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
    Number(changes.contribution || 0),
    Number(changes.exploration_points || 0),
    Number(changes.xp || 0),
    Number(changes.wood || 0),
    Number(changes.food || 0),
    Number(changes.stone || 0),
    new Date().toISOString()
  );
}

function resetPlayerCooldowns(discordUserId) {
  db.prepare(`
    UPDATE players
    SET sammeln_cooldown_until = NULL,
        arbeiten_cooldown_until = NULL,
        trainieren_cooldown_until = NULL,
        expedition_cooldown_until = NULL,
        updated_at = ?
    WHERE discord_user_id = ?
  `).run(new Date().toISOString(), discordUserId);

  return getPlayerByDiscordUserId(discordUserId);
}

function resetPlayerBusy(discordUserId) {
  return setPlayerBusy(discordUserId, null, null);
}

function resetPlayerActionState(discordUserId) {
  resetPlayerCooldowns(discordUserId);
  resetPlayerBusy(discordUserId);
  return getPlayerByDiscordUserId(discordUserId);
}

function resetAllCooldowns() {
  db.prepare(`
    UPDATE players
    SET sammeln_cooldown_until = NULL,
        arbeiten_cooldown_until = NULL,
        trainieren_cooldown_until = NULL,
        expedition_cooldown_until = NULL,
        updated_at = ?
  `).run(new Date().toISOString());
}

function resetAllBusy() {
  db.prepare(`
    UPDATE players
    SET busy_until = NULL,
        busy_activity = NULL,
        updated_at = ?
  `).run(new Date().toISOString());
}

function resetAllActionState() {
  resetAllCooldowns();
  resetAllBusy();
}

function getLatestActivities(limit = 20) {
  return db.prepare(`
    SELECT *
    FROM player_activity_log
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

function normalizeNullableDate(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function setPlayerStateById(playerId, nextPlayer = {}) {
  const player = getPlayerById(playerId);
  if (!player) {
    throw new Error('Spieler nicht gefunden.');
  }

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE players
    SET
      discord_username = ?,
      pokemon_key = ?,
      guild_key = ?,
      guild_role_id = ?,
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
      expedition_cooldown_until = ?,
      busy_until = ?,
      busy_activity = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    String(nextPlayer.discord_username ?? player.discord_username),
    String(nextPlayer.pokemon_key ?? player.pokemon_key),
    String(nextPlayer.guild_key ?? player.guild_key),
    nextPlayer.guild_role_id ?? player.guild_role_id ?? null,
    Math.max(1, Number(nextPlayer.level ?? player.level) || 1),
    Math.max(0, Number(nextPlayer.xp ?? player.xp) || 0),
    Math.max(0, Number(nextPlayer.wood ?? player.wood) || 0),
    Math.max(0, Number(nextPlayer.food ?? player.food) || 0),
    Math.max(0, Number(nextPlayer.stone ?? player.stone) || 0),
    Math.max(0, Number(nextPlayer.contribution ?? player.contribution) || 0),
    Math.max(0, Number(nextPlayer.exploration_points ?? player.exploration_points) || 0),
    Math.max(0, Number(nextPlayer.food_credit ?? player.food_credit) || 0),
    Math.max(0, Number(nextPlayer.ore ?? player.ore) || 0),
    Math.max(0, Number(nextPlayer.fiber ?? player.fiber) || 0),
    Math.max(0, Number(nextPlayer.scrap ?? player.scrap) || 0),
    Math.max(0, Number(nextPlayer.weapon_tier ?? player.weapon_tier) || 0),
    Math.max(0, Number(nextPlayer.armor_tier ?? player.armor_tier) || 0),
    Math.max(0, Number(nextPlayer.scanner_tier ?? player.scanner_tier) || 0),
    normalizeNullableDate(nextPlayer.sammeln_cooldown_until),
    normalizeNullableDate(nextPlayer.arbeiten_cooldown_until),
    normalizeNullableDate(nextPlayer.trainieren_cooldown_until),
    normalizeNullableDate(nextPlayer.expedition_cooldown_until),
    normalizeNullableDate(nextPlayer.busy_until),
    nextPlayer.busy_activity || null,
    now,
    playerId
  );

  return getPlayerById(playerId);
}

module.exports = {
  ACTION_COOLDOWN_FIELDS,
  getPlayerByDiscordUserId,
  getPlayerById,
  createPlayer,
  allPlayers,
  updatePlayerProgress,
  getCampTotals,
  getActionCooldownField,
  setActionCooldown,
  setPlayerBusy,
  clearPlayerBusy,
  logPlayerActivity,
  resetPlayerCooldowns,
  resetPlayerBusy,
  resetPlayerActionState,
  resetAllCooldowns,
  resetAllBusy,
  resetAllActionState,
  getLatestActivities,
  setPlayerStateById
};