const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');

const starters = require('../config/starters');
const {
  getPlayerByDiscordUserId,
  updatePlayerProgress,
  getCampTotals,
  setActionCooldown,
  setBusyState,
  clearBusyState
} = require('../services/playerService');
const {
  getXpProgress,
  getCampProgress,
  calculateScaledStats
} = require('../services/progressionService');
const { getGuildByKey } = require('../services/guildService');
const { syncCampStatusMessage } = require('../services/campStatusService');

const SAMMELN_COOLDOWN_MS = parseDurationMs(process.env.SAMMELN_COOLDOWN_MINUTES, 10 * 60 * 1000, 60 * 1000);
const ARBEITEN_COOLDOWN_MS = parseDurationMs(process.env.ARBEITEN_COOLDOWN_MINUTES, 8 * 60 * 1000, 60 * 1000);
const TRAINIEREN_COOLDOWN_MS = parseDurationMs(process.env.TRAINIEREN_COOLDOWN_MINUTES, 12 * 60 * 1000, 60 * 1000);
const ERKUNDEN_DURATION_MS = parseDurationMs(process.env.ERKUNDEN_DURATION_MINUTES, 15 * 60 * 1000, 60 * 1000);

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
  return getGuildByKey(key);
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

function getCampState() {
  const totals = getCampTotals();
  const progress = getCampProgress(totals.contribution);

  return { totals, progress };
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

function buildExploreReadyPayload(result, playerBefore, playerAfter) {
  const levelUpText = playerAfter && playerAfter.level > playerBefore.level
    ? `\n\n🎉 **Levelaufstieg!** Du bist jetzt Level **${playerAfter.level}**.`
    : '';

  return buildActionResultPayload({
    title: '🧭 Erkundung abgeschlossen',
    description:
      `Du kehrst von deiner Erkundung zurück.\n\n` +
      `+${result.xp} XP\n` +
      `+${result.food} Nahrung\n` +
      `+${result.stone} Stein\n` +
      `+${result.contribution} Lagerbeitrag\n\n` +
      `Dein Team hat neue Pfade und sichere Wege rund um das Camp entdeckt.${levelUpText}`,
    color: 0x1abc9c
  });
}

function buildActionMenu(player) {
  const starter = getStarter(player.pokemon_key);
  const guild = getGuild(player.guild_key);
  const cooldowns = getActionStatus(player);
  const busy = getBusyStatus(player);
  const camp = getCampState().progress;

  const trainingUnlocked = camp.level >= TRAINIEREN_UNLOCK_CAMP_LEVEL;
  const exploringUnlocked = camp.level >= ERKUNDEN_UNLOCK_CAMP_LEVEL;

  const trainingDescription = busy.isBusy
    ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
    : !trainingUnlocked
      ? `Freischaltung ab Camp-Stufe ${TRAINIEREN_UNLOCK_CAMP_LEVEL}`
      : cooldowns.trainierenRemaining > 0
        ? `Wieder bereit in ${formatRemaining(cooldowns.trainierenRemaining)}`
        : 'Steigere deine Werte über XP';

  const exploreDescription = busy.isBusy
    ? `Bereits unterwegs: ${getBusyActivityLabel(busy.activityKey)}`
    : !exploringUnlocked
      ? `Freischaltung ab Camp-Stufe ${ERKUNDEN_UNLOCK_CAMP_LEVEL}`
      : `Verlasse das Camp für ${formatRemaining(ERKUNDEN_DURATION_MS)}`;

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
      `${cooldowns.arbeitenLabel}\n` +
      `${trainingUnlocked ? cooldowns.trainierenLabel : `🔒 Trainieren ab Camp-Stufe ${TRAINIEREN_UNLOCK_CAMP_LEVEL}`}\n` +
      `${exploringUnlocked ? '🧭 Erkunden freigeschaltet' : `🔒 Erkunden ab Camp-Stufe ${ERKUNDEN_UNLOCK_CAMP_LEVEL}`}\n\n` +
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
        description: exploreDescription,
        value: 'erkunden',
        emoji: '🧭'
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
      `**🪨 Stein:** ${player.stone}\n` +
      `**🏗️ Lagerbeitrag:** ${player.contribution}\n\n` +
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

function maybeResolveCompletedActivity(player) {
  if (!player?.busy_activity || !player?.busy_until) {
    return { player, completionPayload: null };
  }

  const busyRemaining = getBusyRemainingMs(player);
  if (busyRemaining > 0) {
    return { player, completionPayload: null };
  }

  clearBusyState(player.discord_user_id);

  if (player.busy_activity === 'erkunden') {
    const result = {
      xp: randomInt(8, 12),
      food: randomInt(1, 3),
      stone: randomInt(0, 2),
      contribution: randomInt(1, 2)
    };

    const updatedPlayer = updatePlayerProgress(player.discord_user_id, result);

    return {
      player: updatedPlayer,
      completionPayload: buildExploreReadyPayload(result, player, updatedPlayer)
    };
  }

  const refreshedPlayer = getPlayerByDiscordUserId(player.discord_user_id);
  return {
    player: refreshedPlayer,
    completionPayload: buildActionResultPayload({
      title: '✅ Rückkehr ins Camp',
      description: 'Du bist wieder im Camp angekommen.',
      color: 0x3498db
    })
  };
}

function runSammeln(player) {
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

  const updatedPlayer = updatePlayerProgress(player.discord_user_id, { wood, food, stone, xp });
  const cooldownUntil = new Date(Date.now() + SAMMELN_COOLDOWN_MS).toISOString();
  setActionCooldown(player.discord_user_id, 'sammeln', cooldownUntil);

  const levelUpText = updatedPlayer && updatedPlayer.level > player.level
    ? `\n\n🎉 **Levelaufstieg!** Du bist jetzt Level **${updatedPlayer.level}**.`
    : '';

  return buildActionResultPayload({
    title: '🌿 Sammeln abgeschlossen',
    description:
      `Du warst für das Lager unterwegs.\n\n` +
      `+${wood} Holz\n` +
      `+${food} Nahrung\n` +
      `+${stone} Stein\n` +
      `+${xp} XP\n\n` +
      `Nächste Sammelaktion in **${formatRemaining(SAMMELN_COOLDOWN_MS)}**.${levelUpText}`,
    color: 0x27ae60
  });
}

function runArbeiten(player) {
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

  const updatedPlayer = updatePlayerProgress(player.discord_user_id, {
    contribution,
    wood,
    stone,
    xp
  });

  const cooldownUntil = new Date(Date.now() + ARBEITEN_COOLDOWN_MS).toISOString();
  setActionCooldown(player.discord_user_id, 'arbeiten', cooldownUntil);

  const levelUpText = updatedPlayer && updatedPlayer.level > player.level
    ? `\n\n🎉 **Levelaufstieg!** Du bist jetzt Level **${updatedPlayer.level}**.`
    : '';

  return buildActionResultPayload({
    title: '🔨 Arbeit im Lager erledigt',
    description:
      `Du hast beim Ausbau des Camps geholfen.\n\n` +
      `+${contribution} Lagerbeitrag\n` +
      `+${wood} Holz\n` +
      `+${stone} Stein\n` +
      `+${xp} XP\n\n` +
      `Nächste Arbeitsaktion in **${formatRemaining(ARBEITEN_COOLDOWN_MS)}**.${levelUpText}`,
    color: 0xe67e22
  });
}

function runTrainieren(player) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const camp = getCampState().progress;
  if (camp.level < TRAINIEREN_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Training noch nicht freigeschaltet',
      `Das Trainingsgelände wird erst ab **Camp-Stufe ${TRAINIEREN_UNLOCK_CAMP_LEVEL}** ausgebaut.\n\nAktuell ist euer Camp auf **Stufe ${camp.level}**.`
    );
  }

  const remainingMs = getCooldownRemainingMs(player, 'trainieren_cooldown_until');
  if (remainingMs > 0) {
    return buildCooldownPayload('Trainieren', remainingMs);
  }

  const stats = calculateScaledStats(player.pokemon_key, player.level);
  const statBonus = Math.floor((stats.kraft + stats.tempo + stats.instinkt) / 10);
  const xp = randomInt(7, 10) + statBonus;

  const updatedPlayer = updatePlayerProgress(player.discord_user_id, { xp });
  const cooldownUntil = new Date(Date.now() + TRAINIEREN_COOLDOWN_MS).toISOString();
  setActionCooldown(player.discord_user_id, 'trainieren', cooldownUntil);

  const levelUpText = updatedPlayer && updatedPlayer.level > player.level
    ? `\n\n🎉 **Levelaufstieg!** Du bist jetzt Level **${updatedPlayer.level}**.`
    : '';

  return buildActionResultPayload({
    title: '💪 Training abgeschlossen',
    description:
      `Du hast konzentriert trainiert und dein Pokémon weiterentwickelt.\n\n` +
      `+${xp} XP\n\n` +
      `Deine Werte wachsen mit jedem Level weiter.\n` +
      `Nächstes Training in **${formatRemaining(TRAINIEREN_COOLDOWN_MS)}**.${levelUpText}`,
    color: 0x9b59b6
  });
}

function runErkunden(player) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const camp = getCampState().progress;
  if (camp.level < ERKUNDEN_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Erkunden noch nicht freigeschaltet',
      `Erkundungen werden erst ab **Camp-Stufe ${ERKUNDEN_UNLOCK_CAMP_LEVEL}** vorbereitet.\n\nAktuell ist euer Camp auf **Stufe ${camp.level}**.`
    );
  }

  const until = new Date(Date.now() + ERKUNDEN_DURATION_MS).toISOString();
  setBusyState(player.discord_user_id, 'erkunden', until);

  return buildActionResultPayload({
    title: '🧭 Erkundung gestartet',
    description:
      `Du verlässt das Camp und erkundest die Umgebung.\n\n` +
      `Rückkehr in **${formatRemaining(ERKUNDEN_DURATION_MS)}**.\n` +
      `Währenddessen sind Sammeln, Arbeiten und Trainieren gesperrt.` +
      `\n\nSobald du zurück bist, erhältst du deinen Erkundungsbericht automatisch im Menü.`,
    color: 0x1abc9c
  });
}

function buildLagerPayload() {
  const { totals, progress: camp } = getCampState();

  const campProgressText = camp.isMaxLevel
    ? 'Max-Stufe erreicht'
    : `${camp.currentInLevel}/${camp.neededForNextLevel} Beitrag bis Stufe ${camp.nextLevel}`;

  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('🏕️ Lagerstatus')
        .setDescription(
          `**Camp-Stufe:** ${camp.level}\n` +
          `**Camp-Fortschritt:** ${campProgressText}\n\n` +
          `**Abenteurer:** ${totals.players}\n` +
          `**Gesamt-XP:** ${totals.xp}\n\n` +
          `**🪵 Holz:** ${totals.wood}\n` +
          `**🍖 Nahrung:** ${totals.food}\n` +
          `**🪨 Stein:** ${totals.stone}\n` +
          `**🏗️ Gesamtbeitrag:** ${totals.contribution}\n\n` +
          `**Freischaltungen**\n` +
          `Stufe 1: Sammeln, Arbeiten\n` +
          `Stufe 2: Trainieren\n` +
          `Stufe 3: Erkunden`
        )
        .setColor(0xf1c40f)
    ],
    components: [buildBackRow()]
  };
}

function loadPlayerForAction(discordUserId) {
  const player = getPlayerByDiscordUserId(discordUserId);
  if (!player) {
    return { player: null, completionPayload: null };
  }

  return maybeResolveCompletedActivity(player);
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

      const { player, completionPayload } = loadPlayerForAction(interaction.user.id);

      if (!player) {
        await interaction.editReply({
          content: 'Du hast noch kein Abenteuer begonnen. Nutze zuerst die Startnachricht.',
          embeds: [],
          components: []
        }).catch(() => null);
        return true;
      }

      if (completionPayload) {
        await interaction.editReply(completionPayload).catch(() => null);
        await syncCampStatusMessage(interaction.client);
      } else {
        await interaction.editReply(buildActionMenu(player)).catch(() => null);
      }
      return true;
    }

    if (interaction.isButton() && interaction.customId === 'camp:actions:back') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const { player, completionPayload } = loadPlayerForAction(interaction.user.id);

      if (!player) {
        await interaction.editReply({
          content: 'Du hast noch kein Abenteuer begonnen. Öffne das Menü bitte erneut über die feste Aktionsnachricht.',
          embeds: [],
          components: []
        }).catch(() => null);
        return true;
      }

      if (completionPayload) {
        await interaction.editReply(completionPayload).catch(() => null);
        await syncCampStatusMessage(interaction.client);
      } else {
        await interaction.editReply(buildActionMenu(player)).catch(() => null);
      }
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'camp:actions:menu') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const { player, completionPayload } = loadPlayerForAction(interaction.user.id);

      if (!player) {
        await interaction.editReply({
          content: 'Du hast noch kein Abenteuer begonnen. Öffne das Menü bitte erneut über die feste Aktionsnachricht.',
          embeds: [],
          components: []
        }).catch(() => null);
        return true;
      }

      if (completionPayload) {
        await interaction.editReply(completionPayload).catch(() => null);
        await syncCampStatusMessage(interaction.client);
        return true;
      }

      const value = interaction.values[0];

      if (value === 'profil') {
        await interaction.editReply(buildProfilePayload(player)).catch(() => null);
        return true;
      }

      if (value === 'sammeln') {
        await interaction.editReply(runSammeln(player)).catch(() => null);
        await syncCampStatusMessage(interaction.client);
        return true;
      }

      if (value === 'arbeiten') {
        await interaction.editReply(runArbeiten(player)).catch(() => null);
        await syncCampStatusMessage(interaction.client);
        return true;
      }

      if (value === 'trainieren') {
        await interaction.editReply(runTrainieren(player)).catch(() => null);
        await syncCampStatusMessage(interaction.client);
        return true;
      }

      if (value === 'erkunden') {
        await interaction.editReply(runErkunden(player)).catch(() => null);
        return true;
      }

      if (value === 'lager') {
        await interaction.editReply(buildLagerPayload()).catch(() => null);
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
