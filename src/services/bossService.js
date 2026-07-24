const db = require('../db/database');
const guilds = require('../config/guilds');
const bosses = require('../config/bosses');
const { getGuildChatChannelId, fetchTextChannel } = require('./channelService');
const { calculateScaledStats, getCampProgress } = require('./progressionService');
const {
  getPlayerByDiscordUserId,
  setPlayerBusy,
  clearPlayerBusy
} = require('./playerService');
const { applyProgressWithLevelUpAnnouncement } = require('./levelUpService');
const { syncCampStatusMessage } = require('./campStatusService');

const TIME_ZONE = 'Europe/Berlin';
const BOSS_FOOD_TARGET = 10;
const BOSS_SPAWN_HOUR = 20;
const BOSS_RESOLVE_HOUR = 21;
const BOSS_STATUS_FUNDING = 'funding';
const BOSS_STATUS_READY = 'ready';
const BOSS_STATUS_ACTIVE = 'active';
const BOSS_STATUS_WON = 'won';
const BOSS_STATUS_LOST = 'lost';
const BOSS_STATUS_MISSED = 'missed';

const BOSS_UNLOCK_LEVEL = 5;
const BOSS_MAX_SCALING_LEVEL = 10;

const BOSS_TIER_WEIGHTS = {
  5: { standard: 70, elite: 25, legendary: 5 },
  6: { standard: 60, elite: 30, legendary: 10 },
  7: { standard: 50, elite: 35, legendary: 15 },
  8: { standard: 40, elite: 40, legendary: 20 },
  9: { standard: 30, elite: 45, legendary: 25 },
  10: { standard: 25, elite: 45, legendary: 30 }
};

const BOSS_TERMINAL_STATUSES = new Set([
  BOSS_STATUS_WON,
  BOSS_STATUS_LOST,
  BOSS_STATUS_MISSED
]);

const berlinPartFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

const berlinOffsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  timeZoneName: 'shortOffset',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function pad(value) {
  return String(value).padStart(2, '0');
}

function clamp(minValue, maxValue, value) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function randomInt(min, max) {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function getBerlinParts(date = new Date()) {
  const parts = berlinPartFormatter.formatToParts(date);
  const map = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function getBerlinDateKey(date = new Date()) {
  const parts = getBerlinParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function getOffsetStringForDateKey(dateKey) {
  const probe = new Date(`${dateKey}T12:00:00Z`);
  const tzName = berlinOffsetFormatter
    .formatToParts(probe)
    .find(part => part.type === 'timeZoneName')?.value || 'GMT+1';

  const match = tzName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) {
    return '+01:00';
  }

  const sign = match[1];
  const hours = pad(match[2]);
  const minutes = pad(match[3] || '00');
  return `${sign}${hours}:${minutes}`;
}

function buildBerlinIso(dateKey, hour, minute = 0, second = 0) {
  return `${dateKey}T${pad(hour)}:${pad(minute)}:${pad(second)}${getOffsetStringForDateKey(dateKey)}`;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function stableHash(input) {
  return String(input)
    .split('')
    .reduce((sum, char, index) => {
      return (sum + (char.charCodeAt(0) * (index + 1))) % 2147483647;
    }, 0);
}

function getGuildBossScalingLevel(guildKey) {
  const campLevel = Number(getGuildCampProgress(guildKey)?.level || BOSS_UNLOCK_LEVEL);
  return clamp(BOSS_UNLOCK_LEVEL, BOSS_MAX_SCALING_LEVEL, campLevel);
}

function getTierWeightsForCampLevel(campLevel) {
  const safeLevel = clamp(BOSS_UNLOCK_LEVEL, BOSS_MAX_SCALING_LEVEL, campLevel);
  return BOSS_TIER_WEIGHTS[safeLevel] || BOSS_TIER_WEIGHTS[BOSS_MAX_SCALING_LEVEL];
}

function pickTierByWeights(seed, weights) {
  const roll = stableHash(seed) % 100;
  let cursor = 0;

  for (const [tier, weight] of Object.entries(weights)) {
    cursor += Number(weight || 0);
    if (roll < cursor) {
      return tier;
    }
  }

  return 'standard';
}

function calculateScaledBossPower(bossConfig, campLevel) {
  const basePower = Number(bossConfig?.basePower ?? bossConfig?.bossPower ?? 100);
  const perLevel = Number(bossConfig?.powerPerCampLevel || 0);
  const extraLevels = Math.max(0, campLevel - BOSS_UNLOCK_LEVEL);
  return basePower + (extraLevels * perLevel);
}

function scaleRewardRange(key, range, campLevel, outcome) {
  if (!Array.isArray(range) || range.length < 2) {
    return null;
  }

  const min = Number(range[0]) || 0;
  const max = Number(range[1]) || 0;
  const extraLevels = Math.max(0, campLevel - BOSS_UNLOCK_LEVEL);

  let bonus = 0;

  if (key === 'xp') {
    bonus = outcome === 'win' ? extraLevels * 2 : extraLevels;
  } else if (outcome === 'win') {
    bonus = Math.floor(extraLevels / 2);
  }

  return [min + bonus, max + bonus];
}

function buildScaledRewardConfig(rewardConfig = {}, campLevel, outcome) {
  const scaled = {};

  for (const [key, value] of Object.entries(rewardConfig || {})) {
    const scaledRange = scaleRewardRange(key, value, campLevel, outcome);
    if (scaledRange) {
      scaled[key] = scaledRange;
    }
  }

  return scaled;
}

function pickBossForDate(dateKey) {
  const score = String(dateKey)
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);

  return bosses[score % bosses.length] || bosses[0];
}

function getBossConfigByKey(bossKey) {
  return bosses.find(entry => entry.key === bossKey) || null;
}

function getBossStatusLabel(status) {
  switch (status) {
    case BOSS_STATUS_FUNDING:
      return 'Vorbereitung läuft';
    case BOSS_STATUS_READY:
      return 'Angelockt – Spawn um 20:00 Uhr';
    case BOSS_STATUS_ACTIVE:
      return 'Boss ist aktiv';
    case BOSS_STATUS_WON:
      return 'Boss besiegt';
    case BOSS_STATUS_LOST:
      return 'Bosskampf verloren';
    case BOSS_STATUS_MISSED:
      return 'Heute nicht angelockt';
    default:
      return 'Unbekannt';
  }
}

function getBossDateContext(now = new Date()) {
  const dateKey = getBerlinDateKey(now);
  return {
    dateKey,
    spawnAt: buildBerlinIso(dateKey, BOSS_SPAWN_HOUR, 0, 0),
    resolveAt: buildBerlinIso(dateKey, BOSS_RESOLVE_HOUR, 0, 0)
  };
}

function getGuildCampProgress(guildKey) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(contribution), 0) AS contribution,
      COALESCE(SUM(exploration_points), 0) AS exploration_points
    FROM players
    WHERE guild_key = ?
  `).get(guildKey);

  return getCampProgress({
    contribution: Number(row?.contribution || 0),
    explorationPoints: Number(row?.exploration_points || 0)
  });
}

function isBossUnlockedForGuild(guildKey) {
  if (!guildKey) return false;
  return getGuildCampProgress(guildKey).level >= 5;
}

function pickBossForGuildDate(guildKey, dateKey) {
  const campLevel = getGuildBossScalingLevel(guildKey);
  const weights = getTierWeightsForCampLevel(campLevel);

  const wantedTier = pickTierByWeights(`${guildKey}:${dateKey}:tier`, weights);

  const tierPool = bosses.filter(boss => boss.tier === wantedTier);
  const fallbackPool = bosses.filter(boss => boss.tier === 'standard');
  const pool = tierPool.length ? tierPool : (fallbackPool.length ? fallbackPool : bosses);

  const index = stableHash(`${guildKey}:${dateKey}:boss:${wantedTier}`) % pool.length;
  return pool[index] || bosses[0];
}

function getBossEventByDate(guildKey, dateKey) {
  const row = db.prepare(`
    SELECT *
    FROM boss_events
    WHERE guild_key = ?
      AND event_date = ?
  `).get(guildKey, dateKey);

  return row ? decorateBossEvent(row) : null;
}

function ensureTodayBossEvent(guildKey) {
  if (!guildKey || !isBossUnlockedForGuild(guildKey)) {
    return null;
  }

  const { dateKey, spawnAt, resolveAt } = getBossDateContext();
  const existing = getBossEventByDate(guildKey, dateKey);

  if (existing) {
    return advancePendingBossState(existing.id);
  }

  const boss = pickBossForGuildDate(guildKey, dateKey);
  const campLevel = getGuildBossScalingLevel(guildKey);
  const scaledBossPower = calculateScaledBossPower(boss, campLevel);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO boss_events (
      guild_key,
      event_date,
      boss_key,
      boss_name,
      boss_power,
      food_target,
      food_invested,
      status,
      spawn_at,
      resolve_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(
    guildKey,
    dateKey,
    boss.key,
    boss.name,
    scaledBossPower,
    BOSS_FOOD_TARGET,
    BOSS_STATUS_FUNDING,
    spawnAt,
    resolveAt,
    now,
    now
  );

  const created = getBossEventByDate(guildKey, dateKey);
  return created ? advancePendingBossState(created.id) : null;
}

function getTodayBossEvent(guildKey) {
  return ensureTodayBossEvent(guildKey);
}


function getEventParticipants(eventId) {
  return db.prepare(`
    SELECT
      bep.*,
      p.discord_username,
      p.guild_key
    FROM boss_event_players bep
    JOIN players p
      ON p.id = bep.player_id
    WHERE bep.event_id = ?
    ORDER BY CASE WHEN bep.joined_at IS NULL THEN 1 ELSE 0 END, bep.joined_at ASC, bep.id ASC
  `).all(eventId);
}

function getEventParticipantByPlayer(eventId, playerId) {
  return db.prepare(`
    SELECT *
    FROM boss_event_players
    WHERE event_id = ?
      AND player_id = ?
  `).get(eventId, playerId);
}

function getEventSummary(eventId) {
  const row = db.prepare(`
    SELECT
      COUNT(CASE WHEN joined_at IS NOT NULL THEN 1 END) AS participant_count,
      COALESCE(SUM(CASE WHEN joined_at IS NOT NULL THEN participant_power ELSE 0 END), 0) AS team_power,
      COALESCE(SUM(donated_food), 0) AS donated_food_total
    FROM boss_event_players
    WHERE event_id = ?
  `).get(eventId);

  return {
    participantCount: Number(row?.participant_count || 0),
    teamPower: Number(row?.team_power || 0),
    donatedFoodTotal: Number(row?.donated_food_total || 0)
  };
}

function decorateBossEvent(row) {
  const event = {
    ...row,
    bossPower: Number(row.boss_power || 0),
    foodTarget: Number(row.food_target || 0),
    foodInvested: Number(row.food_invested || 0),
    participantCount: Number(row.participant_count || 0),
    teamPower: Number(row.team_power || 0),
    successChance: row.success_chance == null ? null : Number(row.success_chance),
    successRoll: row.success_roll == null ? null : Number(row.success_roll),
    rewardSummary: parseJson(row.reward_json, null)
  };

  const boss = getBossConfigByKey(event.boss_key) || {
    key: event.boss_key,
    name: event.boss_name,
    emoji: '👾',
    bossPower: event.bossPower,
    rewards: { win: {}, lose: {} }
  };

  const summary = getEventSummary(event.id);

  event.boss = boss;
  event.bossName = boss.name || event.boss_name;
  event.foodRemaining = Math.max(0, event.foodTarget - event.foodInvested);
  event.statusLabel = getBossStatusLabel(event.status);
  event.participantCount = summary.participantCount;
  event.teamPower = summary.teamPower;
  event.donatedFoodTotal = summary.donatedFoodTotal;

  return event;
}

function updateBossEvent(eventId, changes = {}) {
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(changes)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(eventId);

  db.prepare(`
    UPDATE boss_events
    SET ${fields.join(', ')}
    WHERE id = ?
  `).run(...values);

  return decorateBossEvent(db.prepare(`SELECT * FROM boss_events WHERE id = ?`).get(eventId));
}

function advancePendingBossState(eventId) {
  const row = db.prepare(`SELECT * FROM boss_events WHERE id = ?`).get(eventId);
  if (!row) return null;

  const event = decorateBossEvent(row);
  if (BOSS_TERMINAL_STATUSES.has(event.status)) {
    return event;
  }

  const nowMs = Date.now();
  const spawnMs = new Date(event.spawn_at).getTime();

  if (Number.isNaN(spawnMs) || nowMs < spawnMs) {
    if (event.status === BOSS_STATUS_FUNDING && event.foodInvested >= event.foodTarget) {
      return updateBossEvent(event.id, { status: BOSS_STATUS_READY });
    }

    return event;
  }

  if (event.foodInvested < event.foodTarget) {
    return updateBossEvent(event.id, {
      status: BOSS_STATUS_MISSED,
      resolved_at: event.resolved_at || new Date().toISOString()
    });
  }

  if (event.status === BOSS_STATUS_FUNDING || event.status === BOSS_STATUS_READY) {
    return updateBossEvent(event.id, {
      status: BOSS_STATUS_ACTIVE,
      spawned_at: event.spawned_at || new Date().toISOString()
    });
  }

  return event;
}

function getPlayerCombatPower(player) {
  const stats = calculateScaledStats(player.pokemon_key, player.level);

  return (
    (player.level || 1) +
    Math.floor((stats.kraft || 0) * 1.4) +
    Math.floor((stats.tempo || 0) * 0.6) +
    ((player.weapon_tier || 0) * 4) +
    ((player.armor_tier || 0) * 3)
  );
}

function getBusyInfo(player) {
  const untilMs = player?.busy_until ? new Date(player.busy_until).getTime() : 0;
  if (!untilMs || Number.isNaN(untilMs) || untilMs <= Date.now()) {
    return { isBusy: false, activityKey: null, remainingMs: 0 };
  }

  return {
    isBusy: true,
    activityKey: player.busy_activity || null,
    remainingMs: Math.max(0, untilMs - Date.now())
  };
}

function getBossDisplayState(player) {
  if (!player?.guild_key) {
    return null;
  }

  const event = ensureTodayBossEvent(player.guild_key);
  if (!event) {
    return null;
  }

  const participation = getEventParticipantByPlayer(event.id, player.id);
  const busy = getBusyInfo(player);
  const nowMs = Date.now();
  const spawnMs = new Date(event.spawn_at).getTime();
  const resolveMs = new Date(event.resolve_at).getTime();
  const isFundingOpen =
    [BOSS_STATUS_FUNDING, BOSS_STATUS_READY].includes(event.status) &&
    nowMs < spawnMs;
  const isActive =
    event.status === BOSS_STATUS_ACTIVE &&
    nowMs < resolveMs;

  let donateBlockedReason = null;
  if (!player) {
    donateBlockedReason = 'Kein Spielerprofil gefunden.';
  } else if (!isFundingOpen) {
    donateBlockedReason = 'Heute kann keine Nahrung mehr investiert werden.';
  } else if (event.foodRemaining <= 0) {
    donateBlockedReason = 'Der Boss wurde bereits vollständig angelockt.';
  } else if ((player.food || 0) <= 0) {
    donateBlockedReason = 'Du hast aktuell keine Nahrung zum Investieren.';
  }

  let joinBlockedReason = null;
  if (!player) {
    joinBlockedReason = 'Kein Spielerprofil gefunden.';
  } else if (!isActive) {
    joinBlockedReason = event.status === BOSS_STATUS_READY
      ? 'Der Boss ist bereits angelockt, aber noch nicht erschienen.'
      : 'Aktuell ist kein Bosskampf offen.';
  } else if (participation?.joined_at) {
    joinBlockedReason = 'Du bist bereits Teil des Bosskampfs.';
  } else if (busy.isBusy) {
    joinBlockedReason = 'Du bist aktuell beschäftigt und kannst nicht am Bosskampf teilnehmen.';
  }

  return {
    event,
    boss: event.boss,
    participation,
    isFundingOpen,
    isActive,
    canDonate: !donateBlockedReason,
    canJoin: !joinBlockedReason,
    donateBlockedReason,
    joinBlockedReason,
    timeUntilSpawnMs: Math.max(0, spawnMs - nowMs),
    timeUntilResolveMs: Math.max(0, resolveMs - nowMs),
    busy
  };
}

function insertActivityLog(discordUserId, actionKey, changes = {}) {
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

function donateFoodToBoss({ discordUserId, amount }) {
  const player = getPlayerByDiscordUserId(discordUserId);
  if (!player) {
    throw new Error('Spieler nicht gefunden.');
  }

  const event = getBossDisplayState(player);
  if (!event.canDonate) {
    throw new Error(event.donateBlockedReason || 'Du kannst aktuell keine Nahrung investieren.');
  }

  const requestedAmount = Math.max(1, Number(amount) || 0);
  const playerFood = Math.max(0, Number(player.food) || 0);
  const appliedAmount = Math.min(requestedAmount, playerFood, event.event.foodRemaining);

  if (appliedAmount <= 0) {
    throw new Error('Es konnte keine Nahrung investiert werden.');
  }

  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    const latestEvent = getBossDisplayState(getPlayerByDiscordUserId(discordUserId));
    if (!latestEvent.canDonate) {
      throw new Error(latestEvent.donateBlockedReason || 'Du kannst aktuell keine Nahrung investieren.');
    }

    const latestPlayer = getPlayerByDiscordUserId(discordUserId);
    const latestAppliedAmount = Math.min(
      appliedAmount,
      Math.max(0, Number(latestPlayer.food) || 0),
      latestEvent.event.foodRemaining
    );

    if (latestAppliedAmount <= 0) {
      throw new Error('Es konnte keine Nahrung investiert werden.');
    }

    db.prepare(`
      UPDATE players
      SET food = MAX(0, food - ?), updated_at = ?
      WHERE id = ?
    `).run(latestAppliedAmount, now, latestPlayer.id);

    db.prepare(`
      UPDATE boss_events
      SET food_invested = MIN(food_target, food_invested + ?), updated_at = ?
      WHERE id = ?
    `).run(latestAppliedAmount, now, latestEvent.event.id);

    db.prepare(`
      INSERT INTO boss_event_players (
        event_id,
        player_id,
        discord_user_id,
        donated_food,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, player_id) DO UPDATE SET
        donated_food = boss_event_players.donated_food + excluded.donated_food,
        updated_at = excluded.updated_at
    `).run(
      latestEvent.event.id,
      latestPlayer.id,
      latestPlayer.discord_user_id,
      latestAppliedAmount,
      now,
      now
    );

    insertActivityLog(latestPlayer.discord_user_id, 'boss_donate', { food: -latestAppliedAmount });

    const updatedRow = db.prepare(`SELECT * FROM boss_events WHERE id = ?`).get(latestEvent.event.id);
    const shouldBeReady = Number(updatedRow.food_invested || 0) >= Number(updatedRow.food_target || BOSS_FOOD_TARGET);

    if (shouldBeReady && updatedRow.status === BOSS_STATUS_FUNDING) {
      db.prepare(`
        UPDATE boss_events
        SET status = ?, updated_at = ?
        WHERE id = ?
      `).run(BOSS_STATUS_READY, now, updatedRow.id);
    }
  });

  transaction();

  return {
    player: getPlayerByDiscordUserId(discordUserId),
    display: getBossDisplayState(getPlayerByDiscordUserId(discordUserId)),
    appliedAmount
  };
}

function joinBossEvent({ discordUserId }) {
  const player = getPlayerByDiscordUserId(discordUserId);
  if (!player) {
    throw new Error('Spieler nicht gefunden.');
  }

  const display = getBossDisplayState(player);
  if (!display.canJoin) {
    throw new Error(display.joinBlockedReason || 'Du kannst aktuell nicht teilnehmen.');
  }

  const combatPower = getPlayerCombatPower(player);
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    const latestPlayer = getPlayerByDiscordUserId(discordUserId);
    const latestDisplay = getBossDisplayState(latestPlayer);

    if (!latestDisplay.canJoin) {
      throw new Error(latestDisplay.joinBlockedReason || 'Du kannst aktuell nicht teilnehmen.');
    }

    db.prepare(`
      INSERT INTO boss_event_players (
        event_id,
        player_id,
        discord_user_id,
        joined_at,
        participant_power,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, player_id) DO UPDATE SET
        joined_at = COALESCE(boss_event_players.joined_at, excluded.joined_at),
        participant_power = CASE
          WHEN boss_event_players.joined_at IS NULL THEN excluded.participant_power
          ELSE boss_event_players.participant_power
        END,
        updated_at = excluded.updated_at
    `).run(
      latestDisplay.event.id,
      latestPlayer.id,
      latestPlayer.discord_user_id,
      now,
      combatPower,
      now,
      now
    );

    setPlayerBusy(latestPlayer.discord_user_id, 'boss', latestDisplay.event.resolve_at);
  });

  transaction();

  return {
    player: getPlayerByDiscordUserId(discordUserId),
    display: getBossDisplayState(getPlayerByDiscordUserId(discordUserId)),
    participantPower: combatPower
  };
}

function buildRewardPayload(rewardConfig = {}, campLevel = BOSS_UNLOCK_LEVEL, outcome = 'win') {
  const payload = {};
  const scaledConfig = buildScaledRewardConfig(rewardConfig, campLevel, outcome);

  for (const [key, value] of Object.entries(scaledConfig || {})) {
    if (!Array.isArray(value) || value.length < 2) {
      continue;
    }

    payload[key] = randomInt(Number(value[0]) || 0, Number(value[1]) || 0);
  }

  return payload;
}

function calculateBossOutcome(event) {
  const participantCount = Number(event.participantCount || 0);
  const teamPower = Number(event.teamPower || 0);
  const supportBonus = Math.max(0, participantCount - 1) * 4;
  const successChance = participantCount <= 0
    ? 0
    : clamp(0.15, 0.92, 0.18 + (((teamPower + supportBonus) / Math.max(1, event.bossPower)) * 0.45));
  const roll = Math.random();
  const success = participantCount > 0 && roll <= successChance;

  return {
    success,
    successChance,
    successRoll: Math.round(roll * 100),
    teamPower,
    participantCount,
    supportBonus
  };
}

function formatRewardSummary(rewards = {}) {
  const order = ['xp', 'food', 'stone', 'ore', 'fiber', 'scrap'];
  const labels = {
    xp: 'XP',
    food: 'Nahrung',
    stone: 'Stein',
    ore: 'Erz',
    fiber: 'Fasern',
    scrap: 'Schrott'
  };

  return order
    .filter(key => Number(rewards[key] || 0) > 0)
    .map(key => `+${rewards[key]} ${labels[key]}`)
    .join(', ');
}


async function getGuildRolePing(channel, guildKey) {
  if (!channel?.guild || !guildKey) {
    return { mention: '', roleId: null };
  }

  const config = guilds.find(entry => entry.key === guildKey) || null;
  const storedRole = db.prepare(`
    SELECT guild_role_id
    FROM players
    WHERE guild_key = ?
      AND guild_role_id IS NOT NULL
      AND TRIM(guild_role_id) != ''
    LIMIT 1
  `).get(guildKey);

  let role = null;
  if (storedRole?.guild_role_id) {
    role = await channel.guild.roles.fetch(storedRole.guild_role_id).catch(() => null);
  }

  if (!role) {
    const roles = await channel.guild.roles.fetch().catch(() => null);
    const roleName = String(config?.roleName || config?.name || guildKey).toLowerCase();
    role = roles?.find(entry => String(entry.name || '').toLowerCase() === roleName) || null;
  }

  if (!role) {
    return {
      mention: config ? `@${config.roleName || config.name}` : `@${guildKey}`,
      roleId: null
    };
  }

  return {
    mention: `<@&${role.id}>`,
    roleId: role.id
  };
}

async function sendBossMessageToGuild(client, guildKey, payload) {
  if (!client || !guildKey) return;

  const channelId = getGuildChatChannelId(guildKey);
  if (!channelId) return;

  const channel = await fetchTextChannel(client, channelId).catch(() => null);
  if (!channel) return;

  await channel.send(payload).catch(() => null);
}


async function announceSpawnIfNeeded(client, event) {
  if (!client || !event || event.status !== BOSS_STATUS_ACTIVE || event.announced_spawn_at) {
    return event;
  }

  const channelId = getGuildChatChannelId(event.guild_key);
  const channel = channelId
    ? await fetchTextChannel(client, channelId).catch(() => null)
    : null;
  const rolePing = await getGuildRolePing(channel, event.guild_key);
  const guildConfig = guilds.find(entry => entry.key === event.guild_key);

  if (!channel) {
    return event;
  }

  if (!rolePing.roleId) {
    console.warn(`[boss] Gildenrolle für ${event.guild_key} nicht gefunden; Boss-Alarm wird ohne Rollen-Ping gesendet.`);
  }

  try {
    await channel.send({
      content:
        `${rolePing.mention ? `${rolePing.mention} ` : ''}${event.boss.emoji || '👾'} **Boss-Alarm!** ${event.bossName} ist bei **${guildConfig?.name || event.guild_key}** erschienen!\n` +
        `${event.boss.intro || ''}\n` +
        `Der Kampf läuft bis **21:00 Uhr**. Öffnet das Aktionsmenü und wählt **Bossjagd**.`,
      allowedMentions: rolePing.roleId
        ? { roles: [rolePing.roleId], users: [], parse: [] }
        : { parse: [] }
    });
  } catch (error) {
    console.error(`[boss] Boss-Alarm für ${event.guild_key} konnte nicht gesendet werden:`, error);
    return event;
  }


  return updateBossEvent(event.id, { announced_spawn_at: new Date().toISOString() });
}

async function resolveBossEvent(client, eventId) {
  const event = decorateBossEvent(db.prepare(`SELECT * FROM boss_events WHERE id = ?`).get(eventId));
  if (!event || event.status !== BOSS_STATUS_ACTIVE) {
    return null;
  }

  const participants = getEventParticipants(event.id).filter(entry => entry.joined_at);
  const outcome = calculateBossOutcome(event);
  const resultStatus = outcome.success ? BOSS_STATUS_WON : BOSS_STATUS_LOST;
  const rewardResults = [];

  const campLevel = getGuildBossScalingLevel(event.guild_key);

  for (const participant of participants) {
    const rewardConfig = outcome.success
      ? event.boss.rewards?.win || {}
      : event.boss.rewards?.lose || {};

    const rewards = buildRewardPayload(
      rewardConfig,
      campLevel,
      outcome.success ? 'win' : 'lose'
    );

    const updateResult = await applyProgressWithLevelUpAnnouncement({
      client,
      discordUserId: participant.discord_user_id,
      changes: rewards
    });

    clearPlayerBusy(participant.discord_user_id);
    insertActivityLog(
      participant.discord_user_id,
      outcome.success ? 'boss_win' : 'boss_lose',
      {
        xp: Number(rewards.xp || 0),
        food: Number(rewards.food || 0),
        stone: Number(rewards.stone || 0)
      }
    );

    db.prepare(`
      UPDATE boss_event_players
      SET reward_json = ?, result_status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(rewards),
      resultStatus,
      new Date().toISOString(),
      participant.id
    );

    rewardResults.push({
      discordUserId: participant.discord_user_id,
      username: participant.discord_username,
      rewards,
      leveledUp: Boolean(updateResult?.leveledUp)
    });
  }

  const resolvedEvent = updateBossEvent(event.id, {
    status: resultStatus,
    resolved_at: new Date().toISOString(),
    success_roll: outcome.successRoll,
    success_chance: Number(outcome.successChance.toFixed(4)),
    team_power: outcome.teamPower,
    participant_count: outcome.participantCount,
    reward_json: JSON.stringify({
      success: outcome.success,
      rewards: rewardResults
    }),
    announced_result_at: new Date().toISOString()
  });

  const rewardLines = rewardResults.length
    ? rewardResults
      .slice(0, 8)
      .map(entry => `• **${entry.username}**: ${formatRewardSummary(entry.rewards) || 'kein zusätzlicher Loot'}`)
      .join('\n')
    : 'Niemand hat teilgenommen.';

  await sendBossMessageToGuild(client, resolvedEvent.guild_key, {
    content:
      `${outcome.success ? '🏆' : '💀'} **Boss-Ergebnis:** ${resolvedEvent.bossName}\n` +
      `Teilnehmer: **${outcome.participantCount}** | Teamstärke: **${outcome.teamPower}** | Siegchance: **${Math.round(outcome.successChance * 100)}%**\n` +
      `${outcome.success ? 'Das Camp hat gewonnen!' : 'Der Boss war heute zu stark.'}\n\n` +
      `**Belohnungen**\n${rewardLines}`
  });

  await syncCampStatusMessage(client, resolvedEvent.guild_key).catch(() => null);
  return resolvedEvent;
}

async function processBossSchedulerTick(client) {
  const results = [];

  for (const guild of guilds) {
    if (!isBossUnlockedForGuild(guild.key)) {
      continue;
    }

    const event = ensureTodayBossEvent(guild.key);
    if (!event) {
      continue;
    }

    const current = advancePendingBossState(event.id);
    if (!current) {
      continue;
    }

    if (current.status === BOSS_STATUS_ACTIVE) {
      const announced = await announceSpawnIfNeeded(client, current);
      const resolveMs = new Date(announced.resolve_at).getTime();

      if (!Number.isNaN(resolveMs) && Date.now() >= resolveMs) {
        const resolved = await resolveBossEvent(client, announced.id);
        if (resolved) {
          results.push(resolved);
        }
        continue;
      }

      results.push(announced);
      continue;
    }

    if (
      (current.status === BOSS_STATUS_FUNDING || current.status === BOSS_STATUS_READY) &&
      current.foodInvested >= current.foodTarget
    ) {
      const readyEvent = updateBossEvent(current.id, { status: BOSS_STATUS_READY });
      results.push(readyEvent);
      continue;
    }

    results.push(current);
  }

  return results;
}

module.exports = {
  TIME_ZONE,
  BOSS_FOOD_TARGET,
  BOSS_SPAWN_HOUR,
  BOSS_RESOLVE_HOUR,
  BOSS_STATUS_FUNDING,
  BOSS_STATUS_READY,
  BOSS_STATUS_ACTIVE,
  BOSS_STATUS_WON,
  BOSS_STATUS_LOST,
  BOSS_STATUS_MISSED,
  getBossConfigByKey,
  getBossDateContext,
  getTodayBossEvent,
  ensureTodayBossEvent,
  getEventParticipants,
  getBossDisplayState,
  donateFoodToBoss,
  joinBossEvent,
  processBossSchedulerTick,
  formatRewardSummary,
  getBossStatusLabel
};
