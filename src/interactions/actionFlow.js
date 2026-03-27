const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');

const starters = require('../config/starters');
const guilds = require('../config/guilds');
const {
  getPlayerByDiscordUserId,
  getCampTotals,
  setActionCooldown,
  setBusyState,
  logPlayerActivity
} = require('../services/playerService');
const { applyProgressWithLevelUpAnnouncement } = require('../services/levelUpService');
const { syncCampStatusMessage } = require('../services/campStatusService');
const { getVillageFood, depositVillageFood } = require('../services/villageStorageService');
const {
  getXpProgress,
  getCampProgress,
  calculateScaledStats
} = require('../services/progressionService');

const SAMMELN_COOLDOWN_MS = parseDurationMs(process.env.SAMMELN_COOLDOWN_MINUTES, 10 * 60 * 1000, 60 * 1000);
const ARBEITEN_COOLDOWN_MS = parseDurationMs(process.env.ARBEITEN_COOLDOWN_MINUTES, 8 * 60 * 1000, 60 * 1000);
const TRAINIEREN_COOLDOWN_MS = parseDurationMs(process.env.TRAINIEREN_COOLDOWN_MINUTES, 12 * 60 * 1000, 60 * 1000);
const ERKUNDEN_BUSY_MS = parseDurationMs(process.env.ERKUNDEN_BUSY_MINUTES, 60 * 60 * 1000, 60 * 1000);

const TRAINIEREN_UNLOCK_CAMP_LEVEL = 2;
const ERKUNDEN_UNLOCK_CAMP_LEVEL = 3;

function parseDurationMs(envValue, fallback, multiplier = 1) {
  const numericValue = Number(envValue);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback;
  }
  return numericValue * multiplier;
}

function getInteractionErrorCode(error) {
  return error?.code ?? error?.rawError?.code ?? error?.data?.code ?? null;
}

function isExpiredInteractionError(error) {
  const code = getInteractionErrorCode(error);
  return code === 10062 || code === 40060;
}

async function safeDeferReply(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch (error) {
    if (isExpiredInteractionError(error)) {
      return false;
    }
    throw error;
  }
}

async function safeDeferUpdate(interaction) {
  try {
    await interaction.deferUpdate();
    return true;
  } catch (error) {
    if (isExpiredInteractionError(error)) {
      return false;
    }
    throw error;
  }
}

function getStarter(key) {
  return starters.find(item => item.key === key) || null;
}

function getGuild(key) {
  return guilds.find(item => item.key === key) || null;
}

function getXpProgressText(player) {
  const progress = getXpProgress(player.xp);

  if (progress.isMaxLevel) {
    return 'Max-Level erreicht';
  }

  return `${progress.currentXpInLevel}/${progress.neededForNextLevel} XP bis Level ${progress.nextLevel}`;
}

function buildStatsText(stats) {
  return (
    `**Kraft:** ${stats.kraft}\n` +
    `**Tempo:** ${stats.tempo}\n` +
    `**Ausdauer:** ${stats.ausdauer}\n` +
    `**Instinkt:** ${stats.instinkt}\n` +
    `**Geschick:** ${stats.geschick}`
  );
}

function buildBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('camp:actions:back')
      .setLabel('Zurück zum Aktionsmenü')
      .setStyle(ButtonStyle.Secondary)
  );
}

function getCooldownRemainingMs(player, fieldName) {
  const value = player?.[fieldName];
  if (!value) return 0;

  const targetTime = new Date(value).getTime();
  if (Number.isNaN(targetTime)) return 0;

  return Math.max(0, targetTime - Date.now());
}

function getBusyRemainingMs(player) {
  const value = player?.busy_until;
  if (!value) return 0;

  const targetTime = new Date(value).getTime();
  if (Number.isNaN(targetTime)) return 0;

  return Math.max(0, targetTime - Date.now());
}

function formatRemaining(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function getBusyActivityLabel(activityKey) {
  switch (activityKey) {
    case 'erkunden':
      return 'Erkundung';
    case 'expedition':
      return 'Expedition';
    default:
      return 'einer Aktion';
  }
}

function getBusyStatus(player) {
  const remainingMs = getBusyRemainingMs(player);
  const activityKey = player?.busy_activity || null;

  if (remainingMs <= 0) {
    return {
      isBusy: false,
      remainingMs: 0,
      activityKey: null,
      label: '🟢 Du bist im Camp verfügbar.'
    };
  }

  const activityLabel = getBusyActivityLabel(activityKey);

  return {
    isBusy: true,
    remainingMs,
    activityKey,
    label: `🧭 Du bist aktuell auf **${activityLabel}**.\nRückkehr in **${formatRemaining(remainingMs)}**.`
  };
}

function getActionStatus(player) {
  const sammelnRemaining = getCooldownRemainingMs(player, 'sammeln_cooldown_until');
  const arbeitenRemaining = getCooldownRemainingMs(player, 'arbeiten_cooldown_until');
  const trainierenRemaining = getCooldownRemainingMs(player, 'trainieren_cooldown_until');

  return {
    sammelnRemaining,
    arbeitenRemaining,
    trainierenRemaining,
    sammelnLabel: sammelnRemaining > 0 ? `⏳ Sammeln in ${formatRemaining(sammelnRemaining)}` : '✅ Sammeln ist bereit',
    arbeitenLabel: arbeitenRemaining > 0 ? `⏳ Arbeiten in ${formatRemaining(arbeitenRemaining)}` : '✅ Arbeiten ist bereit',
    trainierenLabel: trainierenRemaining > 0 ? `⏳ Trainieren in ${formatRemaining(trainierenRemaining)}` : '✅ Trainieren ist bereit'
  };
}

function getCampState(guildKey = null) {
  const totals = getCampTotals(guildKey);
  const progress = getCampProgress({
    contribution: totals.contribution,
    explorationPoints: totals.exploration_points
  });

  return { totals, progress, villageFood: getVillageFood(guildKey) };
}

function buildLockedPayload(title, description) {
  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0xe74c3c)
    ],
    components: [buildBackRow()]
  };
}

function buildBusyPayload(player) {
  const busy = getBusyStatus(player);

  return buildLockedPayload(
    '🧭 Du bist gerade unterwegs',
    `${busy.label}\n\nWährend du unterwegs bist, kannst du im Camp keine Dorfaktion starten.`
  );
}

function buildActionResultPayload({ title, description, color = 0x2ecc71 }) {
  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
    ],
    components: [buildBackRow()]
  };
}

function buildCooldownPayload(actionLabel, remainingMs) {
  return buildActionResultPayload({
    title: '⏳ Aktion noch nicht bereit',
    description: `**${actionLabel}** ist noch auf Cooldown.\n\nBitte warte noch **${formatRemaining(remainingMs)}**.`,
    color: 0xe67e22
  });
}

function buildActionMenu(player) {
  const starter = getStarter(player.pokemon_key);
  const guild = getGuild(player.guild_key);
  const cooldowns = getActionStatus(player);
  const busy = getBusyStatus(player);
  const camp = getCampState(player.guild_key).progress;

  const trainingUnlocked = camp.level >= TRAINIEREN_UNLOCK_CAMP_LEVEL;
  const exploringUnlocked = camp.level >= ERKUNDEN_UNLOCK_CAMP_LEVEL;
  const trainingDescription = busy.isBusy
    ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
    : !trainingUnlocked
      ? `Freischaltung ab Camp-Stufe ${TRAINIEREN_UNLOCK_CAMP_LEVEL}`
      : cooldowns.trainierenRemaining > 0
        ? `Wieder bereit in ${formatRemaining(cooldowns.trainierenRemaining)}`
        : 'Steigere deine Werte über XP';

  const exploringDescription = busy.isBusy
    ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
    : !exploringUnlocked
      ? `Freischaltung ab Camp-Stufe ${ERKUNDEN_UNLOCK_CAMP_LEVEL}`
      : `1 Stunde unterwegs · ${camp.progressionLabel} + kleine Funde`;

  const foodBankDescription = busy.isBusy
    ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
    : player.food > 0
      ? `Lege deine Nahrung in die Dorfkammer ein (${player.food} dabei)`
      : 'Du hast aktuell keine Nahrung zum Einlagern';

  const embed = new EmbedBuilder()
    .setTitle('🎮 Deine Aktionen')
    .setDescription(
      `**Pokémon:** ${starter?.name ?? player.pokemon_key} ${starter?.emoji ?? ''}\n` +
      `**Gilde:** ${guild?.name ?? player.guild_key} ${guild?.emoji ?? ''}\n` +
      `**Level:** ${player.level}\n` +
      `**Fortschritt:** ${getXpProgressText(player)}\n` +
      `**Camp-Stufe:** ${camp.level}\n\n` +
      `**Status**\n` +
      `${busy.label}\n` +
      `${cooldowns.sammelnLabel}\n` +
      `${cooldowns.arbeitenLabel}
` +
      `${trainingUnlocked ? cooldowns.trainierenLabel : `🔒 Trainieren ab Camp-Stufe ${TRAINIEREN_UNLOCK_CAMP_LEVEL}`}
` +
      `${exploringUnlocked ? '🧭 Erkunden ist bereit' : `🔒 Erkunden ab Camp-Stufe ${ERKUNDEN_UNLOCK_CAMP_LEVEL}`}

` +
      'Wähle deine nächste Aktion.'
    )
    .setFooter({
      text: 'Falls dieses Menü später nicht mehr reagiert, öffne es erneut über die feste Aktionsnachricht.'
    })
    .setColor(guild?.color ?? 0x5865f2);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('camp:actions:menu')
    .setPlaceholder('Aktion auswählen')
    .addOptions([
      {
        label: 'Profil ansehen',
        description: 'Zeigt dein Pokémon, deine Gilde und deine Werte',
        value: 'profil',
        emoji: '📜'
      },
      {
        label: 'Sammeln',
        description: busy.isBusy
          ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
          : cooldowns.sammelnRemaining > 0
            ? `Wieder bereit in ${formatRemaining(cooldowns.sammelnRemaining)}`
            : 'Sammle Holz, Nahrung, Stein und XP',
        value: 'sammeln',
        emoji: '🌿'
      },
      {
        label: 'Arbeiten',
        description: busy.isBusy
          ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
          : cooldowns.arbeitenRemaining > 0
            ? `Wieder bereit in ${formatRemaining(cooldowns.arbeitenRemaining)}`
            : 'Hilf dem Lager beim Ausbau',
        value: 'arbeiten',
        emoji: '🔨'
      },
      {
        label: 'Trainieren',
        description: trainingDescription,
        value: 'trainieren',
        emoji: '💪'
      },
      {
        label: 'Erkunden',
        description: exploringDescription,
        value: 'erkunden',
        emoji: '🧭'
      },
      {
        label: 'Nahrung einlagern',
        description: foodBankDescription,
        value: 'food_bank',
        emoji: '🍖'
      },
      {
        label: 'Lagerstatus',
        description: 'Zeigt den Fortschritt des gesamten Camps',
        value: 'lager',
        emoji: '🏕️'
      }
    ]);

  return {
    content: '',
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

function buildProfilePayload(player) {
  const starter = getStarter(player.pokemon_key);
  const guild = getGuild(player.guild_key);
  const cooldowns = getActionStatus(player);
  const busy = getBusyStatus(player);
  const stats = calculateScaledStats(player.pokemon_key, player.level);
  const xpProgress = getXpProgress(player.xp);

  const progressText = xpProgress.isMaxLevel
    ? 'Max-Level erreicht'
    : `${xpProgress.currentXpInLevel}/${xpProgress.neededForNextLevel} XP bis Level ${xpProgress.nextLevel}`;

  const embed = new EmbedBuilder()
    .setTitle(`📜 Profil von ${player.discord_username}`)
    .setDescription(
      `**Pokémon:** ${starter?.name ?? player.pokemon_key} ${starter?.emoji ?? ''}\n` +
      `**Gilde:** ${guild?.name ?? player.guild_key} ${guild?.emoji ?? ''}\n\n` +
      `**Level:** ${player.level}\n` +
      `**XP gesamt:** ${player.xp}\n` +
      `**Fortschritt:** ${progressText}\n\n` +
      `**Aktuelle Werte**\n` +
      `${buildStatsText(stats)}\n\n` +
      `**🪵 Holz:** ${player.wood}\n` +
      `**🍖 Nahrung:** ${player.food}\n` +
      `**🪨 Stein:** ${player.stone}
` +
      `**🏗️ Lagerbeitrag:** ${player.contribution}
` +
      `**🧭 Erkundungspunkte:** ${player.exploration_points || 0}
` +
      `**🏦 Nahrungsguthaben:** ${player.food_credit || 0}

` +
      `**Status**\n` +
      `${busy.label}\n` +
      `${cooldowns.sammelnLabel}\n` +
      `${cooldowns.arbeitenLabel}\n` +
      `${cooldowns.trainierenLabel}`
    )
    .setColor(guild?.color ?? 0x2ecc71);

  return {
    content: '',
    embeds: [embed],
    components: [buildBackRow()]
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function runSammeln(player, interaction) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const remainingMs = getCooldownRemainingMs(player, 'sammeln_cooldown_until');
  if (remainingMs > 0) {
    return buildCooldownPayload('Sammeln', remainingMs);
  }

  const wood = randomInt(1, 3);
  const food = randomInt(1, 2);
  const stone = randomInt(0, 2);
  const xp = randomInt(4, 6);

  const result = await applyProgressWithLevelUpAnnouncement({
    client: interaction.client,
    discordUserId: player.discord_user_id,
    changes: { wood, food, stone, xp }
  });

  logPlayerActivity(player.discord_user_id, 'sammeln', {
    wood,
    food,
    stone,
    xp
  });
  const cooldownUntil = new Date(Date.now() + SAMMELN_COOLDOWN_MS).toISOString();
  setActionCooldown(player.discord_user_id, 'sammeln', cooldownUntil);

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  return buildActionResultPayload({
    title: '🌿 Sammeln abgeschlossen',
    description:
      `Du warst für das Lager unterwegs.

` +
      `+${wood} Holz
` +
      `+${food} Nahrung
` +
      `+${stone} Stein
` +
      `+${xp} XP

` +
      `Nächste Sammelaktion in **${formatRemaining(SAMMELN_COOLDOWN_MS)}**.${result.levelUpText}`,
    color: 0x27ae60
  });
}

async function runArbeiten(player, interaction) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const remainingMs = getCooldownRemainingMs(player, 'arbeiten_cooldown_until');
  if (remainingMs > 0) {
    return buildCooldownPayload('Arbeiten', remainingMs);
  }

  const contribution = randomInt(2, 5);
  const wood = randomInt(0, 1);
  const stone = randomInt(0, 1);
  const xp = randomInt(3, 5);

  const result = await applyProgressWithLevelUpAnnouncement({
    client: interaction.client,
    discordUserId: player.discord_user_id,
    changes: {
      contribution,
      wood,
      stone,
      xp
    }
  });

  logPlayerActivity(player.discord_user_id, 'arbeiten', {
    contribution,
    wood,
    stone,
    xp
  });

  const cooldownUntil = new Date(Date.now() + ARBEITEN_COOLDOWN_MS).toISOString();
  setActionCooldown(player.discord_user_id, 'arbeiten', cooldownUntil);

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  return buildActionResultPayload({
    title: '🔨 Arbeit im Lager erledigt',
    description:
      `Du hast beim Ausbau des Camps geholfen.

` +
      `+${contribution} Lagerbeitrag
` +
      `+${wood} Holz
` +
      `+${stone} Stein
` +
      `+${xp} XP

` +
      `Nächste Arbeitsaktion in **${formatRemaining(ARBEITEN_COOLDOWN_MS)}**.${result.levelUpText}`,
    color: 0xe67e22
  });
}

async function runErkunden(player, interaction) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const camp = getCampState(player.guild_key).progress;
  if (camp.level < ERKUNDEN_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Erkundung noch nicht freigeschaltet',
      `Erkunden wird erst ab **Camp-Stufe ${ERKUNDEN_UNLOCK_CAMP_LEVEL}** freigeschaltet.

Aktuell ist euer Camp auf **Stufe ${camp.level}**.`
    );
  }

  const explorationPoints = randomInt(3, 6);
  const xp = randomInt(6, 10);
  const wood = randomInt(0, 1);
  const food = randomInt(0, 1);
  const stone = randomInt(0, 1);

  const result = await applyProgressWithLevelUpAnnouncement({
    client: interaction.client,
    discordUserId: player.discord_user_id,
    changes: {
      exploration_points: explorationPoints,
      xp,
      wood,
      food,
      stone
    }
  });

  logPlayerActivity(player.discord_user_id, 'erkunden', {
    exploration_points: explorationPoints,
    xp,
    wood,
    food,
    stone
  });

  const busyUntil = new Date(Date.now() + ERKUNDEN_BUSY_MS).toISOString();
  setBusyState(player.discord_user_id, 'erkunden', busyUntil);

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  return buildActionResultPayload({
    title: '🧭 Erkundung gestartet',
    description:
      `Du hast die Umgebung erkundet und erste Spuren kartiert.

` +
      `+${explorationPoints} Erkundungspunkte
` +
      `+${xp} XP
` +
      `+${wood} Holz
` +
      `+${food} Nahrung
` +
      `+${stone} Stein

` +
      `Du bist jetzt für **${formatRemaining(ERKUNDEN_BUSY_MS)}** unterwegs und kannst in dieser Zeit keine andere Dorfaktion starten.${result.levelUpText}`,
    color: 0x3498db
  });
}

async function runFoodBankDeposit(player, interaction) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  if ((Number(player.food) || 0) <= 0) {
    return buildLockedPayload(
      '🍖 Keine Nahrung zum Einlagern',
      'Du hast aktuell keine Nahrung bei dir. Sammle erst Nahrung und lege sie dann in der Dorfkammer ein.'
    );
  }

  const deposit = depositVillageFood(player.discord_user_id);

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  return buildActionResultPayload({
    title: '🏦 Nahrung eingelagert',
    description:
      `Du hast **${deposit.deposited} Nahrung** in die Dorfkammer eingelagert.

` +
      `**Dorfkammer:** ${deposit.villageFood}
` +
      `**Dein Nahrungsguthaben:** ${deposit.foodCredit}

` +
      `Für spätere Expeditionen kannst du nur so viel Nahrung mitnehmen, wie du selbst eingelagert hast.`,
    color: 0xf39c12
  });
}

async function runTrainieren(player, interaction) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const camp = getCampState(player.guild_key).progress;
  if (camp.level < TRAINIEREN_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Training noch nicht freigeschaltet',
      `Das Trainingsgelände wird erst ab **Camp-Stufe ${TRAINIEREN_UNLOCK_CAMP_LEVEL}** ausgebaut.

Aktuell ist euer Camp auf **Stufe ${camp.level}**.`
    );
  }

  const remainingMs = getCooldownRemainingMs(player, 'trainieren_cooldown_until');
  if (remainingMs > 0) {
    return buildCooldownPayload('Trainieren', remainingMs);
  }

  const stats = calculateScaledStats(player.pokemon_key, player.level);
  const statBonus = Math.floor((stats.kraft + stats.tempo + stats.instinkt) / 10);
  const xp = randomInt(7, 10) + statBonus;

  const result = await applyProgressWithLevelUpAnnouncement({
    client: interaction.client,
    discordUserId: player.discord_user_id,
    changes: { xp }
  });

  logPlayerActivity(player.discord_user_id, 'trainieren', {
    xp
  });

  const cooldownUntil = new Date(Date.now() + TRAINIEREN_COOLDOWN_MS).toISOString();
  setActionCooldown(player.discord_user_id, 'trainieren', cooldownUntil);

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  return buildActionResultPayload({
    title: '💪 Training abgeschlossen',
    description:
      `Du hast konzentriert trainiert und dein Pokémon weiterentwickelt.

` +
      `+${xp} XP

` +
      `Deine Werte wachsen mit jedem Level weiter.
` +
      `Nächstes Training in **${formatRemaining(TRAINIEREN_COOLDOWN_MS)}**.${result.levelUpText}`,
    color: 0x9b59b6
  });
}

function buildLagerPayload(player) {
  const { totals, progress: camp, villageFood } = getCampState(player.guild_key);

  const campProgressText = camp.isMaxLevel
    ? 'Max-Stufe erreicht'
    : `${camp.currentInLevel}/${camp.neededForNextLevel} ${camp.progressionLabel} bis Stufe ${camp.nextLevel}`;

  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('🏕️ Lagerstatus')
        .setDescription(
          `**Camp-Stufe:** ${camp.level}
` +
          `**Phase:** ${camp.phaseLabel}
` +
          `**Camp-Fortschritt:** ${campProgressText}

` +
          `**Abenteurer:** ${totals.players}
` +
          `**Gesamt-XP:** ${totals.xp}

` +
          `**🪵 Holz:** ${totals.wood}
` +
          `**🍖 Nahrung (bei Spielern):** ${totals.food}
` +
          `**🏦 Dorfkammer:** ${villageFood}
` +
          `**🪨 Stein:** ${totals.stone}
` +
          `**🏗️ Baufortschritt:** ${totals.contribution}
` +
          `**🧭 Erkundungspunkte:** ${totals.exploration_points}

` +
          `**Freischaltungen**
` +
          `Stufe 1: Sammeln, Arbeiten
` +
          `Stufe 2: Trainieren
` +
          `Stufe 3: Erkunden
` +
          `Stufe 4: Expedition`
        )
        .setColor(0xf1c40f)
    ],
    components: [buildBackRow()]
  };
}

module.exports = {
  canHandleInteraction(interaction) {
    return Boolean(
      interaction.customId &&
      (
        interaction.customId === 'camp:actions:open' ||
        interaction.customId === 'camp:actions:back' ||
        interaction.customId === 'camp:actions:menu'
      )
    );
  },

  async handleInteraction(interaction) {
    if (interaction.isButton() && interaction.customId === 'camp:actions:open') {
      const ok = await safeDeferReply(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.editReply({
          content: 'Du hast noch kein Abenteuer begonnen. Nutze zuerst die Startnachricht.',
          embeds: [],
          components: []
        }).catch(() => null);
        return true;
      }

      await interaction.editReply(buildActionMenu(player)).catch(() => null);
      return true;
    }

    if (interaction.isButton() && interaction.customId === 'camp:actions:back') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.editReply({
          content: 'Du hast noch kein Abenteuer begonnen. Öffne das Menü bitte erneut über die feste Aktionsnachricht.',
          embeds: [],
          components: []
        }).catch(() => null);
        return true;
      }

      await interaction.editReply(buildActionMenu(player)).catch(() => null);
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'camp:actions:menu') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.editReply({
          content: 'Du hast noch kein Abenteuer begonnen. Öffne das Menü bitte erneut über die feste Aktionsnachricht.',
          embeds: [],
          components: []
        }).catch(() => null);
        return true;
      }

      const value = interaction.values[0];

      if (value === 'profil') {
        await interaction.editReply(buildProfilePayload(player)).catch(() => null);
        return true;
      }

      if (value === 'sammeln') {
        await interaction.editReply(await runSammeln(player, interaction)).catch(() => null);
        return true;
      }

      if (value === 'arbeiten') {
        await interaction.editReply(await runArbeiten(player, interaction)).catch(() => null);
        return true;
      }

      if (value === 'trainieren') {
        await interaction.editReply(await runTrainieren(player, interaction)).catch(() => null);
        return true;
      }

      if (value === 'erkunden') {
        await interaction.editReply(await runErkunden(player, interaction)).catch(() => null);
        return true;
      }

      if (value === 'food_bank') {
        await interaction.editReply(await runFoodBankDeposit(player, interaction)).catch(() => null);
        return true;
      }

      if (value === 'lager') {
        await interaction.editReply(buildLagerPayload(player)).catch(() => null);
        return true;
      }

      await interaction.editReply({
        content: 'Unbekannte Aktion. Öffne das Menü bitte erneut.',
        embeds: [],
        components: []
      }).catch(() => null);

      return true;
    }

    return false;
  }
};