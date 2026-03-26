const path = require('path');
const fs = require('fs');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { getState, setState } = require('./stateService');
const { allPlayers, getCampTotals, getTopContributorLast24Hours } = require('./playerService');
const { getCampProgress } = require('./progressionService');
const guilds = require('../config/guilds');

let CanvasLib = null;
try {
  CanvasLib = require('@napi-rs/canvas');
} catch (_error) {
  CanvasLib = null;
}

const CAMP_STATUS_TITLE = '🏕️ Camp-Fortschritt';
const CAMP_STATUS_CHANNEL_KEY = 'camp_status_channel_id';
const CAMP_STATUS_MESSAGE_KEY = 'camp_status_message_id';
const LEVEL_ASSET_DIR = path.join(__dirname, '..', 'assets', 'camp');

function getCampTopContributors(limit = 5) {
  return allPlayers()
    .slice()
    .sort((a, b) => {
      const contributionDiff = (Number(b.contribution) || 0) - (Number(a.contribution) || 0);
      if (contributionDiff !== 0) return contributionDiff;
      const xpDiff = (Number(b.xp) || 0) - (Number(a.xp) || 0);
      if (xpDiff !== 0) return xpDiff;
      return String(a.discord_username || '').localeCompare(String(b.discord_username || ''), 'de');
    })
    .slice(0, limit);
}

function getCampAssetPath(level) {
  const candidates = [
    `level-${level}.png`,
    `camp-level-${level}.png`,
    `stage-${level}.png`
  ];

  for (const filename of candidates) {
    const filePath = path.join(LEVEL_ASSET_DIR, filename);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

function getCampStatusChannelStateKey(guildKey) {
  return `camp_status_channel_id:${guildKey}`;
}

function getCampStatusMessageStateKey(guildKey) {
  return `camp_status_message_id:${guildKey}`;
}

function getUnlockedFeatures(level) {
  const features = ['Sammeln', 'Arbeiten'];
  if (level >= 2) features.push('Trainieren');
  if (level >= 3) features.push('Erkunden');
  if (level >= 4) features.push('Expedition');
  return features;
}

function buildTopContributorText(players) {
  if (!players.length) {
    return 'Noch keine Beiträge.';
  }

  return players
    .map((player, index) => `${index + 1}. ${player.discord_username} – ${player.contribution}`)
    .join('\n');
}

async function renderCampImageBuffer() {
  if (!CanvasLib) return null;

  const { createCanvas, loadImage, GlobalFonts } = CanvasLib;
  const totals = getCampTotals();
  const progress = getCampProgress(totals.contribution);
  const topContributors = getCampTopContributors(5);
  const width = 1280;
  const height = 720;
  const canvas = createCanvas(width, height);
  const topContributor24h = getTopContributorLast24Hours();
  const ctx = canvas.getContext('2d');

  const fontCandidates = [
    path.join(__dirname, '..', 'assets', 'camp', 'DejaVuSans.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
  ];

  for (const candidate of fontCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        GlobalFonts.registerFromPath(candidate, 'CampStatusSans');
        break;
      } catch (_error) {
        // ignore duplicate or failed registration
      }
    }
  }

  const bgPath = getCampAssetPath(progress.level);
  if (bgPath) {
    try {
      const image = await loadImage(bgPath);
      ctx.drawImage(image, 0, 0, width, height);
    } catch (_error) {
      drawFallbackBackground(ctx, width, height, progress.level);

    }
  } else {
    drawFallbackBackground(ctx, width, height, progress.level);
  }
  drawOverlayPanel(ctx, width, height);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px CampStatusSans';
  ctx.fillText('Camp Indigo', 54, 78);

  ctx.font = '24px CampStatusSans';
  ctx.fillStyle = '#dbeafe';
  ctx.fillText(`Camp-Stufe ${progress.level}`, 56, 118);

  const progressPercent = progress.isMaxLevel
    ? 1
    : Math.max(0, Math.min(1, progress.currentInLevel / Math.max(1, progress.neededForNextLevel)));

  drawProgressBar(ctx, {
    x: 56,
    y: 148,
    width: 430,
    height: 24,
    fillPercent: progressPercent,
    label: progress.isMaxLevel
      ? 'Max-Stufe erreicht'
      : `${progress.currentInLevel}/${progress.neededForNextLevel} Beitrag bis Stufe ${progress.nextLevel}`
  });

  const nextTarget = progress.nextLevelTarget ?? totals.contribution;
  const percentText = progress.isMaxLevel ? '100%' : `${Math.round(progressPercent * 100)}%`;

  ctx.font = 'bold 38px CampStatusSans';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${totals.contribution} / ${nextTarget}`, 56, 232);

  ctx.font = '20px CampStatusSans';
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText(
    progress.isMaxLevel
      ? 'Maximale Camp-Stufe erreicht'
      : `Noch ${progress.remainingToNextLevel} Beitrag bis Stufe ${progress.nextLevel} • ${percentText}`,
    56,
    264
  );

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, 56, 300, 430, 132, 18);
  ctx.fill();

  ctx.font = 'bold 22px CampStatusSans';
  ctx.fillStyle = '#fde68a';
  ctx.fillText('Camp-Daten', 76, 338);

  ctx.font = '20px CampStatusSans';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(`Abenteurer: ${totals.players}`, 76, 374);
  ctx.fillText(`Gesamtbeitrag: ${totals.contribution}`, 76, 404);
  ctx.fillText(`Gesamt-XP: ${totals.xp}`, 76, 434);

  ctx.font = 'bold 24px CampStatusSans';
  ctx.fillStyle = '#fde68a';
  ctx.fillText('Freigeschaltet', 56, 492);

  ctx.font = '20px CampStatusSans';
  ctx.fillStyle = '#f8fafc';
  getUnlockedFeatures(progress.level).forEach((feature, index) => {
    ctx.fillText(`• ${feature}`, 56, 528 + (index * 30));
  });

  ctx.font = 'bold 28px CampStatusSans';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Top-Beiträger', 790, 78);

  ctx.font = '22px CampStatusSans';
  topContributors.forEach((player, index) => {
    const y = 128 + (index * 72);
    ctx.fillStyle = '#93c5fd';
    ctx.fillText(`#${index + 1}`, 792, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(trimText(ctx, player.discord_username, 300), 850, y);
    ctx.fillStyle = '#fde68a';
    ctx.fillText(`${player.contribution} Beitrag`, 850, y + 32);
  });

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, 780, 470, 430, 150, 18);
  ctx.fill();

  ctx.font = 'bold 24px CampStatusSans';
  ctx.fillStyle = '#fde68a';
  ctx.fillText('Aktivster Spieler (24h)', 800, 510);

  if (topContributor24h) {
    ctx.font = 'bold 28px CampStatusSans';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(trimText(ctx, topContributor24h.discord_username, 320), 800, 552);

    ctx.font = '20px CampStatusSans';
    ctx.fillStyle = '#93c5fd';
    ctx.fillText(`+${topContributor24h.contribution_24h} Beitrag`, 800, 588);

    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`+${topContributor24h.xp_24h || 0} XP`, 800, 616);
  } else {
    ctx.font = '20px CampStatusSans';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText('Noch keine Aktivität in den letzten 24h.', 800, 556);
  }

  ctx.font = '18px CampStatusSans';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('Grafik wird automatisch bei Lagerfortschritt aktualisiert.', 56, 676);

  return canvas.toBuffer('image/png');
}

function trimText(ctx, text, maxWidth) {
  const value = String(text || 'Unbekannt');
  if (ctx.measureText(value).width <= maxWidth) return value;

  let current = value;
  while (current.length > 1 && ctx.measureText(`${current}…`).width > maxWidth) {
    current = current.slice(0, -1);
  }

  return `${current}…`;
}

function drawFallbackBackground(ctx, width, height, level) {
  ctx.fillStyle = '#184d47';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#7a8450';
  ctx.fillRect(290, 140, 400, 320);

  ctx.fillStyle = '#4ade80';
  for (let x = 240; x <= 720; x += 58) {
    ctx.beginPath();
    ctx.arc(x, 110, 24, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let y = 120; y <= 560; y += 52) {
    ctx.beginPath();
    ctx.arc(228, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(748, y, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#60a5fa';
  ctx.fillRect(330, 470, 80, 250);

  if (level >= 1) {
    ctx.fillStyle = '#d97706';
    ctx.fillRect(460, 300, 90, 60);
    ctx.fillStyle = '#fef3c7';
    ctx.beginPath();
    ctx.moveTo(450, 300);
    ctx.lineTo(505, 252);
    ctx.lineTo(560, 300);
    ctx.closePath();
    ctx.fill();
  }

  if (level >= 2) {
    ctx.fillStyle = '#a16207';
    ctx.fillRect(570, 250, 110, 80);
    ctx.fillStyle = '#f5deb3';
    ctx.fillRect(585, 215, 80, 40);
  }

  if (level >= 3) {
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(375, 210, 120, 64);
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(398, 170, 74, 40);
  }
}

function drawOverlayPanel(ctx, width, height) {
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  roundRect(ctx, 28, 28, 1224, 664, 24);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, 740, 28, 512, 664, 24);
  ctx.fill();
}

function drawProgressBar(ctx, { x, y, width, height, fillPercent, label }) {
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  roundRect(ctx, x, y, width, height, 12);
  ctx.fill();

  ctx.fillStyle = '#22c55e';
  roundRect(ctx, x, y, Math.max(18, width * fillPercent), height, 12);
  ctx.fill();

  ctx.font = '18px CampStatusSans';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(label, x, y + height + 28);
}

function roundRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

async function buildCampStatusPayload() {
  const totals = getCampTotals();
  const progress = getCampProgress(totals.contribution);
  const topContributors = getCampTopContributors(5);
  const contributorsText = buildTopContributorText(topContributors);

  const embed = new EmbedBuilder()
    .setTitle(CAMP_STATUS_TITLE)
    .setDescription(
      `**Camp-Stufe:** ${progress.level}\n` +
      `**Gesamtbeitrag:** ${totals.contribution}\n` +
      `**Abenteurer:** ${totals.players}\n\n` +
      `**Top-Beiträger**\n${contributorsText}`
    )
    .setColor(0x2ecc71)
    .setFooter({ text: 'Eine feste Nachricht – wird automatisch aktualisiert.' });

  const buffer = await renderCampImageBuffer();
  if (!buffer) {
    return { embeds: [embed], components: [] };
  }

  const fileName = `camp-status-${progress.level}-${totals.contribution}-${Date.now()}.png`;
  const attachment = new AttachmentBuilder(buffer, { name: fileName });
  embed.setImage(`attachment://${fileName}`);

  return {
    embeds: [embed],
    files: [attachment],
    attachments: [],
    components: []
  };
}


function getGuildConfig(guildKey) {
  return guilds.find(guild => guild.key === guildKey) || null;
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

  const payload = await buildCampStatusPayload();

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
    getCampTopContributors
  };
