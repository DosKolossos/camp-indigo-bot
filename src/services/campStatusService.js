const { EmbedBuilder } = require('discord.js');
const { getState, setState } = require('./stateService');
const { allPlayers, getCampTotals, getTopContributorLast24Hours } = require('./playerService');
const { getCampProgress } = require('./progressionService');
const guilds = require('../config/guilds');

const CAMP_STATUS_TITLE = '🏕️ Camp-Fortschritt';
const CAMP_STATUS_CHANNEL_KEY = 'camp_status_channel_id';
const CAMP_STATUS_MESSAGE_KEY = 'camp_status_message_id';

function getCampTopContributors(limit = 5, guildKey = null) {
  return allPlayers(guildKey)
    .slice()
    .sort((a, b) => {
      const contributionDiff = (Number(b.contribution) || 0) - (Number(a.contribution) || 0);
      if (contributionDiff !== 0) return contributionDiff;
      const explorationDiff = (Number(b.exploration_points) || 0) - (Number(a.exploration_points) || 0);
      if (explorationDiff !== 0) return explorationDiff;
      const xpDiff = (Number(b.xp) || 0) - (Number(a.xp) || 0);
      if (xpDiff !== 0) return xpDiff;
      return String(a.discord_username || '').localeCompare(String(b.discord_username || ''), 'de');
    })
    .slice(0, limit);
}

function getUnlockedFeatures(level) {
  const features = ['Sammeln', 'Arbeiten'];
  if (level >= 2) features.push('Trainieren');
  if (level >= 3) features.push('Erkunden');
  if (level >= 4) features.push('Schmiede', 'Expedition', 'Markt');
  if (level >= 5) features.push('Bossjagd');
  if (level >= 6) features.push('Arena (PvP)');
  return features;
}

function buildTopContributorText(players) {
  if (!players.length) {
    return 'Noch keine Beiträge.';
  }

  return players
    .map((player, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      return `${medal} **${player.discord_username}** – ${Number(player.contribution) || 0} Beitrag | ${Number(player.exploration_points) || 0} Erkundung`;
    })
    .join('\n');
}

function buildProgressBar(progress, size = 12) {
  const ratio = progress.isMaxLevel
    ? 1
    : Math.max(0, Math.min(1, progress.currentInLevel / Math.max(1, progress.neededForNextLevel)));
  const filled = Math.round(ratio * size);
  return `${'▰'.repeat(filled)}${'▱'.repeat(Math.max(0, size - filled))} ${Math.round(ratio * 100)}%`;
}

function buildProgressText(progress) {
  if (progress.isMaxLevel) {
    return `**Max-Stufe erreicht**\n${buildProgressBar(progress)}`;
  }

  return (
    `**${progress.currentInLevel}/${progress.neededForNextLevel} ${progress.progressionLabel}** bis Stufe ${progress.nextLevel}\n` +
    buildProgressBar(progress)
  );
}

function getGuildConfig(guildKey) {
  return guilds.find(guild => guild.key === guildKey) || null;
}

async function buildCampStatusPayload(guildKey = null) {
  const totals = getCampTotals(guildKey);
  const progress = getCampProgress({
    contribution: totals.contribution,
    exploration_points: totals.exploration_points
  });
  const topContributors = getCampTopContributors(5, guildKey);
  const topContributor24h = getTopContributorLast24Hours(guildKey);
  const guild = getGuildConfig(guildKey);

  const activeText = topContributor24h
    ? `**${topContributor24h.discord_username}** mit +${topContributor24h.contribution_24h} Beitrag und +${topContributor24h.xp_24h} XP`
    : 'Noch keine gewertete Aktivität in den letzten 24 Stunden.';

  const embed = new EmbedBuilder()
    .setTitle(CAMP_STATUS_TITLE)
    .setDescription(
      `${guild ? `${guild.emoji || ''} **${guild.name}**\n` : ''}` +
      `**Camp-Stufe ${progress.level}** · ${progress.phaseLabel}\n` +
      `${buildProgressText(progress)}`
    )
    .addFields(
      {
        name: '📊 Camp-Daten',
        value:
          `Abenteurer: **${totals.players}**\n` +
          `Gesamt-XP: **${totals.xp}**\n` +
          `Gesamtbeitrag: **${totals.contribution}**\n` +
          `Erkundungspunkte: **${totals.exploration_points || 0}**`,
        inline: true
      },
      {
        name: '📦 Gemeinsame Bestände',
        value:
          `🪵 Holz: **${totals.wood}**\n` +
          `🍖 Nahrung: **${totals.food}**\n` +
          `🪨 Stein: **${totals.stone}**\n` +
          `⛏️ Erz: **${totals.ore || 0}**\n` +
          `🧵 Fasern: **${totals.fiber || 0}**\n` +
          `🪛 Schrott: **${totals.scrap || 0}**`,
        inline: true
      },
      {
        name: '🔓 Freigeschaltet',
        value: getUnlockedFeatures(progress.level).join(' · ') || 'Noch keine Funktionen.',
        inline: false
      },
      {
        name: '🏆 Top-Beiträger',
        value: buildTopContributorText(topContributors),
        inline: false
      },
      {
        name: '⚡ Aktivster Spieler (24h)',
        value: activeText,
        inline: false
      }
    )
    .setColor(guild?.color ?? 0x2ecc71)
    .setFooter({ text: 'Diese feste Nachricht wird automatisch aktualisiert – ohne Hintergrundbilder.' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: []
  };
}

function getCampStatusChannelStateKey(guildKey) {
  return `camp_status_channel_id:${guildKey}`;
}

function getCampStatusMessageStateKey(guildKey) {
  return `camp_status_message_id:${guildKey}`;
}

function isGuildKey(value) {
  return guilds.some(guild => guild.key === value);
}

function resolveProgressChannelId(guildKey) {
  const guild = getGuildConfig(guildKey);
  return guild?.progressChannelId || null;
}

async function findExistingCampStatusMessage(client, guildKey = null) {
  const channelStateKey = guildKey
    ? getCampStatusChannelStateKey(guildKey)
    : CAMP_STATUS_CHANNEL_KEY;

  const messageStateKey = guildKey
    ? getCampStatusMessageStateKey(guildKey)
    : CAMP_STATUS_MESSAGE_KEY;

  const savedChannelId = getState(channelStateKey);
  const savedMessageId = getState(messageStateKey);

  if (!savedChannelId || !savedMessageId) return null;

  const channel = await client.channels.fetch(savedChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;

  const message = await channel.messages.fetch(savedMessageId).catch(() => null);
  if (!message) return null;

  return { channel, message };
}

async function findCampStatusMessageByScan(channel) {
  if (!channel || !channel.isTextBased() || !channel.messages?.fetch) return null;

  const recentMessages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recentMessages) return null;

  for (const message of recentMessages.values()) {
    const firstEmbed = message.embeds?.[0];
    if (
      message.author?.id === channel.client.user?.id &&
      firstEmbed?.title === CAMP_STATUS_TITLE
    ) {
      return { channel, message };
    }
  }

  return null;
}

async function ensureCampStatusMessage(client, guildKeyOrChannelId, explicitTargetChannelId = null) {
  const guildMode = isGuildKey(guildKeyOrChannelId);
  const guildKey = guildMode ? guildKeyOrChannelId : null;

  const targetChannelId = guildMode
    ? (explicitTargetChannelId || resolveProgressChannelId(guildKey))
    : (explicitTargetChannelId || guildKeyOrChannelId);

  if (!targetChannelId) {
    throw new Error(
      guildKey
        ? `Kein Fortschrittskanal für Gilde "${guildKey}" konfiguriert.`
        : 'Camp-Status-Kanal konnte nicht aufgelöst werden.'
    );
  }

  const targetChannel = await client.channels.fetch(targetChannelId).catch(() => null);
  if (!targetChannel || !targetChannel.isTextBased()) {
    throw new Error('Camp-Status-Kanal konnte nicht gefunden werden.');
  }

  const existing = guildMode
    ? (await findExistingCampStatusMessage(client, guildKey)) || await findCampStatusMessageByScan(targetChannel)
    : (await findExistingCampStatusMessage(client)) || await findCampStatusMessageByScan(targetChannel);

  const payload = await buildCampStatusPayload(guildKey);

  let finalMessage;
  if (existing) {
    const sameChannel = existing.channel.id === targetChannel.id;
    if (sameChannel) {
      finalMessage = await existing.message.edit({
        ...payload,
        attachments: []
      });
    } else {
      await existing.message.delete().catch(() => null);
      finalMessage = await targetChannel.send(payload);
    }
  } else {
    finalMessage = await targetChannel.send(payload);
  }

  if (guildMode) {
    setState(getCampStatusChannelStateKey(guildKey), targetChannel.id);
    setState(getCampStatusMessageStateKey(guildKey), finalMessage.id);
  } else {
    setState(CAMP_STATUS_CHANNEL_KEY, targetChannel.id);
    setState(CAMP_STATUS_MESSAGE_KEY, finalMessage.id);
  }

  return { channel: targetChannel, message: finalMessage };
}

async function syncCampStatusMessage(client, guildKey) {
  if (!guildKey) return null;

  return ensureCampStatusMessage(client, guildKey).catch(error => {
    console.error(`Camp-Status für Gilde "${guildKey}" konnte nicht synchronisiert werden:`, error);
    return null;
  });
}

module.exports = {
  CAMP_STATUS_TITLE,
  buildCampStatusPayload,
  ensureCampStatusMessage,
  syncCampStatusMessage,
  getCampTopContributors,
  getUnlockedFeatures
};
