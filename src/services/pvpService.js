const db = require('../db/database');
const { calculateScaledStats } = require('./progressionService');
const {
  getPlayerByDiscordUserId,
  getPlayerById,
  updatePlayerProgress,
  logPlayerActivity
} = require('./playerService');

const PVP_UNLOCK_CAMP_LEVEL = 6;
const PVP_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const PVP_FIGHT_COOLDOWN_MS = 5 * 60 * 1000;
const PVP_MAX_FIGHTS_24H = 5;
const PVP_WIN_XP = 8;
const PVP_LOSS_XP = 3;

const PVP_STATUS_PENDING = 'pending';
const PVP_STATUS_RESOLVING = 'resolving';
const PVP_STATUS_RESOLVED = 'resolved';
const PVP_STATUS_DECLINED = 'declined';
const PVP_STATUS_CANCELLED = 'cancelled';
const PVP_STATUS_EXPIRED = 'expired';

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function isPlayerBusy(player) {
  const busyUntil = player?.busy_until ? new Date(player.busy_until).getTime() : 0;
  return Number.isFinite(busyUntil) && busyUntil > Date.now();
}

function getLevelBracket(level) {
  const safeLevel = Math.max(1, Number(level) || 1);
  const start = Math.floor((safeLevel - 1) / 10) * 10 + 1;
  return {
    start,
    end: start + 9,
    key: `${start}-${start + 9}`,
    label: `Level ${start}–${start + 9}`
  };
}

function getCombatProfile(player) {
  const stats = calculateScaledStats(player.pokemon_key, player.level);
  const weaponTier = Number(player.weapon_tier) || 0;
  const armorTier = Number(player.armor_tier) || 0;

  const maxHp = 36 + ((Number(stats.ausdauer) || 0) * 6) + (armorTier * 5);
  const attack = 5 + ((Number(stats.kraft) || 0) * 2) + (weaponTier * 3);
  const defense = 2 + (Number(stats.ausdauer) || 0) + (armorTier * 2);
  const speed = Number(stats.tempo) || 0;
  const precision = Number(stats.geschick) || 0;
  const instinct = Number(stats.instinkt) || 0;
  const power =
    (Number(player.level) || 1) +
    Math.floor((Number(stats.kraft) || 0) * 1.4) +
    Math.floor(speed * 0.6) +
    (weaponTier * 4) +
    (armorTier * 3);

  return {
    playerId: player.id,
    discordUserId: player.discord_user_id,
    username: player.discord_username,
    pokemonKey: player.pokemon_key,
    level: Number(player.level) || 1,
    stats,
    weaponTier,
    armorTier,
    maxHp,
    hp: maxHp,
    attack,
    defense,
    speed,
    precision,
    instinct,
    power
  };
}

function randomIntWithRng(min, max, rng) {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.floor(rng() * (safeMax - safeMin + 1)) + safeMin;
}

function performAttack(attacker, defender, rng) {
  const dodgeChance = Math.min(0.28, 0.02 + (defender.speed * 0.01) + (defender.instinct * 0.005));
  if (rng() < dodgeChance) {
    return { dodged: true, critical: false, damage: 0 };
  }

  const rollBonus = randomIntWithRng(0, Math.max(2, Math.floor(attacker.precision / 2)), rng);
  const mitigation = Math.floor(defender.defense * 0.45);
  let damage = Math.max(1, attacker.attack + rollBonus - mitigation);

  const criticalChance = Math.min(0.30, 0.05 + (attacker.precision * 0.012) + (attacker.instinct * 0.006));
  const critical = rng() < criticalChance;
  if (critical) {
    damage = Math.ceil(damage * 1.5);
  }

  defender.hp = Math.max(0, defender.hp - damage);
  return { dodged: false, critical, damage };
}

function buildAttackLog(round, attacker, defender, result) {
  if (result.dodged) {
    return `R${round}: **${defender.username}** weicht dem Angriff von **${attacker.username}** aus.`;
  }

  return (
    `R${round}: **${attacker.username}** trifft **${defender.username}** für **${result.damage} KP**` +
    `${result.critical ? ' – Volltreffer!' : ''} (${defender.hp}/${defender.maxHp}).`
  );
}

function simulatePvpBattle(challengerPlayer, opponentPlayer, rng = Math.random) {
  const challenger = getCombatProfile(challengerPlayer);
  const opponent = getCombatProfile(opponentPlayer);
  const log = [];
  const maxRounds = 10;

  for (let round = 1; round <= maxRounds; round += 1) {
    const challengerInitiative = challenger.speed + randomIntWithRng(1, 6, rng);
    const opponentInitiative = opponent.speed + randomIntWithRng(1, 6, rng);
    const order = challengerInitiative >= opponentInitiative
      ? [[challenger, opponent], [opponent, challenger]]
      : [[opponent, challenger], [challenger, opponent]];

    for (const [attacker, defender] of order) {
      if (attacker.hp <= 0 || defender.hp <= 0) continue;
      const result = performAttack(attacker, defender, rng);
      log.push(buildAttackLog(round, attacker, defender, result));
      if (defender.hp <= 0) break;
    }

    if (challenger.hp <= 0 || opponent.hp <= 0) break;
  }

  let winner;
  let loser;

  if (challenger.hp <= 0 && opponent.hp > 0) {
    winner = opponent;
    loser = challenger;
  } else if (opponent.hp <= 0 && challenger.hp > 0) {
    winner = challenger;
    loser = opponent;
  } else {
    const challengerRatio = challenger.hp / challenger.maxHp;
    const opponentRatio = opponent.hp / opponent.maxHp;

    if (challengerRatio !== opponentRatio) {
      winner = challengerRatio > opponentRatio ? challenger : opponent;
    } else if (challenger.power !== opponent.power) {
      winner = challenger.power > opponent.power ? challenger : opponent;
    } else {
      winner = rng() < 0.5 ? challenger : opponent;
    }

    loser = winner.playerId === challenger.playerId ? opponent : challenger;
    log.push(`Nach zehn Runden entscheidet die verbleibende Kampfkraft den Kampf.`);
  }

  return {
    challenger,
    opponent,
    winner,
    loser,
    rounds: Math.max(1, Math.ceil(log.filter(line => line.startsWith('R')).length / 2)),
    log
  };
}

function decorateChallenge(row) {
  if (!row) return null;

  return {
    ...row,
    id: Number(row.id),
    challenger_player_id: Number(row.challenger_player_id),
    opponent_player_id: Number(row.opponent_player_id),
    winner_player_id: row.winner_player_id == null ? null : Number(row.winner_player_id),
    challenger_power: Number(row.challenger_power || 0),
    opponent_power: Number(row.opponent_power || 0),
    battleLog: parseJson(row.battle_log_json, []),
    rewards: parseJson(row.reward_json, null)
  };
}

function getPvpChallengeById(challengeId) {
  return decorateChallenge(db.prepare(`
    SELECT *
    FROM pvp_challenges
    WHERE id = ?
  `).get(challengeId));
}

function expireOldPvpChallenges() {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE pvp_challenges
    SET status = ?, resolved_at = COALESCE(resolved_at, ?), updated_at = ?
    WHERE status = ?
      AND expires_at <= ?
  `).run(PVP_STATUS_EXPIRED, now, now, PVP_STATUS_PENDING, now);
}

function getRecentResolvedFight(playerId) {
  return db.prepare(`
    SELECT *
    FROM pvp_challenges
    WHERE status = ?
      AND (challenger_player_id = ? OR opponent_player_id = ?)
    ORDER BY resolved_at DESC
    LIMIT 1
  `).get(PVP_STATUS_RESOLVED, playerId, playerId);
}

function getFightCountLast24Hours(playerId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) AS amount
    FROM pvp_challenges
    WHERE status = ?
      AND resolved_at >= ?
      AND (challenger_player_id = ? OR opponent_player_id = ?)
  `).get(PVP_STATUS_RESOLVED, since, playerId, playerId);
  return Number(row?.amount || 0);
}

function assertPlayerCanFight(player) {
  if (!player) throw new Error('Spieler nicht gefunden.');
  if (isPlayerBusy(player)) {
    throw new Error(`${player.discord_username} ist gerade auf einer anderen Aktion unterwegs.`);
  }

  const recentFight = getRecentResolvedFight(player.id);
  if (recentFight?.resolved_at) {
    const remaining = (new Date(recentFight.resolved_at).getTime() + PVP_FIGHT_COOLDOWN_MS) - Date.now();
    if (remaining > 0) {
      const minutes = Math.ceil(remaining / 60000);
      throw new Error(`${player.discord_username} braucht noch etwa ${minutes} Minute(n) Kampfpause.`);
    }
  }

  if (getFightCountLast24Hours(player.id) >= PVP_MAX_FIGHTS_24H) {
    throw new Error(`${player.discord_username} hat das Limit von ${PVP_MAX_FIGHTS_24H} Arena-Kämpfen in 24 Stunden erreicht.`);
  }
}

function createPvpChallenge({ challengerDiscordUserId, opponentDiscordUserId, channelId = null }) {
  expireOldPvpChallenges();

  const challenger = getPlayerByDiscordUserId(challengerDiscordUserId);
  const opponent = getPlayerByDiscordUserId(opponentDiscordUserId);

  if (!challenger) throw new Error('Du hast noch keinen Camp-Indigo-Spielstand.');
  if (!opponent) throw new Error('Die ausgewählte Person hat noch keinen Camp-Indigo-Spielstand.');
  if (challenger.id === opponent.id) throw new Error('Du kannst dich nicht selbst herausfordern.');

  const challengerBracket = getLevelBracket(challenger.level);
  const opponentBracket = getLevelBracket(opponent.level);
  if (challengerBracket.key !== opponentBracket.key) {
    throw new Error(`PvP ist nur innerhalb derselben Levelklasse möglich. Du bist in ${challengerBracket.label}, dein Gegner in ${opponentBracket.label}.`);
  }

  assertPlayerCanFight(challenger);
  assertPlayerCanFight(opponent);

  const openChallenge = db.prepare(`
    SELECT id
    FROM pvp_challenges
    WHERE status IN (?, ?)
      AND (
        challenger_player_id IN (?, ?)
        OR opponent_player_id IN (?, ?)
      )
    LIMIT 1
  `).get(
    PVP_STATUS_PENDING,
    PVP_STATUS_RESOLVING,
    challenger.id,
    opponent.id,
    challenger.id,
    opponent.id
  );

  if (openChallenge) {
    throw new Error('Einer von euch hat bereits eine offene PvP-Herausforderung.');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + PVP_CHALLENGE_TTL_MS);
  const challengerProfile = getCombatProfile(challenger);
  const opponentProfile = getCombatProfile(opponent);

  const result = db.prepare(`
    INSERT INTO pvp_challenges (
      challenger_player_id,
      opponent_player_id,
      challenger_discord_user_id,
      opponent_discord_user_id,
      status,
      channel_id,
      challenger_power,
      opponent_power,
      expires_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    challenger.id,
    opponent.id,
    challenger.discord_user_id,
    opponent.discord_user_id,
    PVP_STATUS_PENDING,
    channelId,
    challengerProfile.power,
    opponentProfile.power,
    expiresAt.toISOString(),
    now.toISOString(),
    now.toISOString()
  );

  return {
    challenge: getPvpChallengeById(result.lastInsertRowid),
    challenger,
    opponent,
    bracket: challengerBracket,
    challengerProfile,
    opponentProfile
  };
}

function attachPvpChallengeMessage(challengeId, messageId, channelId = null) {
  db.prepare(`
    UPDATE pvp_challenges
    SET message_id = ?, channel_id = COALESCE(?, channel_id), updated_at = ?
    WHERE id = ?
  `).run(messageId || null, channelId || null, new Date().toISOString(), challengeId);

  return getPvpChallengeById(challengeId);
}

function cancelPvpChallenge(challengeId) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE pvp_challenges
    SET status = ?, resolved_at = ?, updated_at = ?
    WHERE id = ? AND status = ?
  `).run(PVP_STATUS_CANCELLED, now, now, challengeId, PVP_STATUS_PENDING);
  return getPvpChallengeById(challengeId);
}

function declinePvpChallenge({ challengeId, actorDiscordUserId }) {
  expireOldPvpChallenges();
  const challenge = getPvpChallengeById(challengeId);

  if (!challenge) throw new Error('Diese Herausforderung wurde nicht gefunden.');
  if (challenge.opponent_discord_user_id !== actorDiscordUserId) {
    throw new Error('Nur die herausgeforderte Person kann diesen Kampf ablehnen.');
  }
  if (challenge.status !== PVP_STATUS_PENDING) {
    throw new Error('Diese Herausforderung ist nicht mehr offen.');
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE pvp_challenges
    SET status = ?, resolved_at = ?, updated_at = ?
    WHERE id = ? AND status = ?
  `).run(PVP_STATUS_DECLINED, now, now, challengeId, PVP_STATUS_PENDING);

  return getPvpChallengeById(challengeId);
}

function resolvePvpChallenge({ challengeId, actorDiscordUserId }) {
  expireOldPvpChallenges();
  const challenge = getPvpChallengeById(challengeId);

  if (!challenge) throw new Error('Diese Herausforderung wurde nicht gefunden.');
  if (challenge.opponent_discord_user_id !== actorDiscordUserId) {
    throw new Error('Nur die herausgeforderte Person kann diesen Kampf annehmen.');
  }
  if (challenge.status !== PVP_STATUS_PENDING) {
    throw new Error('Diese Herausforderung ist nicht mehr offen.');
  }

  const lockTime = new Date().toISOString();
  const lock = db.prepare(`
    UPDATE pvp_challenges
    SET status = ?, updated_at = ?
    WHERE id = ? AND status = ?
  `).run(PVP_STATUS_RESOLVING, lockTime, challengeId, PVP_STATUS_PENDING);

  if (lock.changes !== 1) {
    throw new Error('Diese Herausforderung wird bereits verarbeitet.');
  }

  try {
    const challenger = getPlayerById(challenge.challenger_player_id);
    const opponent = getPlayerById(challenge.opponent_player_id);

    assertPlayerCanFight(challenger);
    assertPlayerCanFight(opponent);

    const challengerBracket = getLevelBracket(challenger.level);
    const opponentBracket = getLevelBracket(opponent.level);
    if (challengerBracket.key !== opponentBracket.key) {
      throw new Error('Eure Levelklasse hat sich seit der Herausforderung verändert. Erstellt bitte eine neue Herausforderung.');
    }

    const battle = simulatePvpBattle(challenger, opponent);
    const winnerXp = PVP_WIN_XP;
    const loserXp = PVP_LOSS_XP;

    const resolution = db.transaction(() => {
      const winnerUpdated = updatePlayerProgress(battle.winner.discordUserId, { xp: winnerXp });
      const loserUpdated = updatePlayerProgress(battle.loser.discordUserId, { xp: loserXp });
      const challengerUpdated = battle.winner.playerId === challenger.id ? winnerUpdated : loserUpdated;
      const opponentUpdated = battle.winner.playerId === opponent.id ? winnerUpdated : loserUpdated;

      logPlayerActivity(battle.winner.discordUserId, 'pvp_win', { xp: winnerXp });
      logPlayerActivity(battle.loser.discordUserId, 'pvp_loss', { xp: loserXp });

      const rewards = {
        winner: { playerId: battle.winner.playerId, xp: winnerXp },
        loser: { playerId: battle.loser.playerId, xp: loserXp }
      };
      const now = new Date().toISOString();

      const completed = db.prepare(`
        UPDATE pvp_challenges
        SET status = ?,
            challenger_power = ?,
            opponent_power = ?,
            winner_player_id = ?,
            battle_log_json = ?,
            reward_json = ?,
            resolved_at = ?,
            updated_at = ?
        WHERE id = ? AND status = ?
      `).run(
        PVP_STATUS_RESOLVED,
        battle.challenger.power,
        battle.opponent.power,
        battle.winner.playerId,
        JSON.stringify(battle.log),
        JSON.stringify(rewards),
        now,
        now,
        challengeId,
        PVP_STATUS_RESOLVING
      );

      if (completed.changes !== 1) {
        throw new Error('Der Arena-Kampf konnte nicht eindeutig abgeschlossen werden.');
      }

      return {
        challengerUpdated,
        opponentUpdated,
        winnerUpdated,
        loserUpdated,
        rewards
      };
    })();

    return {
      challenge: getPvpChallengeById(challengeId),
      challenger,
      opponent,
      ...resolution,
      battle
    };
  } catch (error) {
    db.prepare(`
      UPDATE pvp_challenges
      SET status = ?, updated_at = ?
      WHERE id = ? AND status = ?
    `).run(PVP_STATUS_PENDING, new Date().toISOString(), challengeId, PVP_STATUS_RESOLVING);
    throw error;
  }
}

function getPvpRecord(playerId) {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN status = ? AND winner_player_id = ? THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN status = ? AND winner_player_id IS NOT NULL AND winner_player_id != ?
        AND (challenger_player_id = ? OR opponent_player_id = ?) THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN status = ? AND (challenger_player_id = ? OR opponent_player_id = ?) THEN 1 ELSE 0 END) AS fights
    FROM pvp_challenges
  `).get(
    PVP_STATUS_RESOLVED,
    playerId,
    PVP_STATUS_RESOLVED,
    playerId,
    playerId,
    playerId,
    PVP_STATUS_RESOLVED,
    playerId,
    playerId
  );

  return {
    wins: Number(row?.wins || 0),
    losses: Number(row?.losses || 0),
    fights: Number(row?.fights || 0),
    remaining24h: Math.max(0, PVP_MAX_FIGHTS_24H - getFightCountLast24Hours(playerId))
  };
}

module.exports = {
  PVP_UNLOCK_CAMP_LEVEL,
  PVP_CHALLENGE_TTL_MS,
  PVP_FIGHT_COOLDOWN_MS,
  PVP_MAX_FIGHTS_24H,
  PVP_WIN_XP,
  PVP_LOSS_XP,
  PVP_STATUS_PENDING,
  PVP_STATUS_RESOLVING,
  PVP_STATUS_RESOLVED,
  PVP_STATUS_DECLINED,
  PVP_STATUS_CANCELLED,
  PVP_STATUS_EXPIRED,
  getLevelBracket,
  getCombatProfile,
  simulatePvpBattle,
  getPvpChallengeById,
  createPvpChallenge,
  attachPvpChallengeMessage,
  cancelPvpChallenge,
  declinePvpChallenge,
  resolvePvpChallenge,
  getPvpRecord,
  expireOldPvpChallenges
};
