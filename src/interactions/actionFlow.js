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
  updatePlayerProgress,
  getCampTotals,
  setActionCooldown
} = require('../services/playerService');

const {
  getXpProgress,
  getCampProgress,
  calculateScaledStats
} = require('../services/progressionService');

const SAMMELN_COOLDOWN_MS = parseDurationMs(process.env.SAMMELN_COOLDOWN_MINUTES, 10 * 60 * 1000, 60 * 1000);
const ARBEITEN_COOLDOWN_MS = parseDurationMs(process.env.ARBEITEN_COOLDOWN_MINUTES, 8 * 60 * 1000, 60 * 1000);

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

function parseDurationMs(envValue, fallback, multiplier = 1) {
  const numericValue = Number(envValue);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback;
  }
  return numericValue * multiplier;
}

function getStarter(key) {
  return starters.find(item => item.key === key) || null;
}

function getGuild(key) {
  return guilds.find(item => item.key === key) || null;
}

function getPlayerHeadline(player) {
  const starter = getStarter(player.pokemon_key);
  const guild = getGuild(player.guild_key);

  return {
    starter,
    guild,
    text: `${starter?.name ?? player.pokemon_key} ${starter?.emoji ?? ''} • ${guild?.name ?? player.guild_key} ${guild?.emoji ?? ''}`.trim()
  };
}

function getXpProgress(player) {
  const currentLevelXp = Math.max(0, (player.level - 1) * XP_PER_LEVEL);
  const xpInLevel = Math.max(0, player.xp - currentLevelXp);

  return {
    xpInLevel,
    totalNeeded: XP_PER_LEVEL,
    nextLevel: player.level + 1,
    text: `${xpInLevel}/${XP_PER_LEVEL} XP bis Level ${player.level + 1}`
  };
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

function formatRemaining(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function getActionStatus(player) {
  const sammelnRemaining = getCooldownRemainingMs(player, 'sammeln_cooldown_until');
  const arbeitenRemaining = getCooldownRemainingMs(player, 'arbeiten_cooldown_until');

  return {
    sammelnRemaining,
    arbeitenRemaining,
    sammelnLabel: sammelnRemaining > 0 ? `⏳ Sammeln in ${formatRemaining(sammelnRemaining)}` : '✅ Sammeln ist bereit',
    arbeitenLabel: arbeitenRemaining > 0 ? `⏳ Arbeiten in ${formatRemaining(arbeitenRemaining)}` : '✅ Arbeiten ist bereit'
  };
}

function buildActionMenu(player) {
  const { starter, guild, text } = getPlayerHeadline(player);
  const progress = getXpProgress(player);
  const cooldowns = getActionStatus(player);

  const embed = new EmbedBuilder()
    .setTitle('🎮 Deine Aktionen')
    .setDescription(
      `**Pokémon:** ${starter?.name ?? player.pokemon_key} ${starter?.emoji ?? ''}\n` +
      `**Gilde:** ${guild?.name ?? player.guild_key} ${guild?.emoji ?? ''}\n` +
      `**Level:** ${player.level}\n` +
      `**Fortschritt:** ${getXpProgressText(player)}\n\n` +
      `**Status**\n` +
      `${cooldowns.sammelnLabel}\n` +
      `${cooldowns.arbeitenLabel}\n\n` +
      'Wähle deine nächste Aktion.'
    )
    .addFields(
      {
        name: 'Fortschritt',
        value: `Level **${player.level}**\n${progress.text}`,
        inline: false
      },
      {
        name: 'Bereit',
        value: `${cooldowns.sammelnLabel}\n${cooldowns.arbeitenLabel}`,
        inline: false
      }
    )
    .setFooter({ text: 'Wähle deine nächste Aktion.' + `*Falls dieses Menü später nicht mehr reagiert, öffne es erneut über die feste Nachricht im Channel.*` })
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
        description: cooldowns.sammelnRemaining > 0
          ? `Wieder bereit in ${formatRemaining(cooldowns.sammelnRemaining)}`
          : 'Sammle Holz, Nahrung, Stein und XP',
        value: 'sammeln',
        emoji: '🌿'
      },
      {
        label: 'Arbeiten',
        description: cooldowns.arbeitenRemaining > 0
          ? `Wieder bereit in ${formatRemaining(cooldowns.arbeitenRemaining)}`
          : 'Hilf dem Lager beim Ausbau',
        value: 'arbeiten',
        emoji: '🔨'
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
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral
  };
}

function buildProfilePayload(player) {
  const starter = getStarter(player.pokemon_key);
  const guild = getGuild(player.guild_key);
  const cooldowns = getActionStatus(player);
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
      `**Cooldowns**\n` +
      `${cooldowns.sammelnLabel}\n` +
      `${cooldowns.arbeitenLabel}`
    )
    .setColor(guild?.color ?? 0x2ecc71);

  return {
    content: '',
    embeds: [embed],
    components: [buildBackRow()],
    flags: MessageFlags.Ephemeral
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
    components: [buildBackRow()],
    flags: MessageFlags.Ephemeral
  };
}

function buildCooldownPayload(actionLabel, remainingMs) {
  return buildActionResultPayload({
    title: '⏳ Aktion noch nicht bereit',
    description: `**${actionLabel}** ist noch auf Cooldown.\n\nBitte warte noch **${formatRemaining(remainingMs)}**.`,
    color: 0xe74c3c
  });
}

function runSammeln(player) {
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

function buildLagerPayload() {
  const totals = getCampTotals();
  const camp = getCampProgress(totals.contribution);

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
          `**🏗️ Gesamtbeitrag:** ${totals.contribution}`
        )
        .setColor(0xf1c40f)
    ],
    components: [buildBackRow()],
    flags: MessageFlags.Ephemeral
  };
}

function buildMissingPlayerPayload() {
  return {
    content: 'Du hast noch kein Abenteuer begonnen. Nutze zuerst die Startnachricht.',
    components: [],
    flags: MessageFlags.Ephemeral
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
    const player = getPlayerByDiscordUserId(interaction.user.id);

    if (!player) {
      const payload = buildMissingPlayerPayload();
      if (interaction.isButton()) {
        return interaction.reply(payload);
      }
      return interaction.update(payload);
    }

    if (interaction.isButton()) {
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

      if (interaction.customId === 'camp:actions:back') {
        return interaction.update(buildActionMenu(getPlayerByDiscordUserId(interaction.user.id)));
      }
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
        await interaction.editReply(runSammeln(player)).catch(() => null);
        return true;
      }

      if (value === 'arbeiten') {
        await interaction.editReply(runArbeiten(player)).catch(() => null);
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
