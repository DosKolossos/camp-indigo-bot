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
  const topContributors = getCampTopContributors(3);
  const width = 1280;
  const height = 720;
  const canvas = createCanvas(width, height);
  const topContributor24h = getTopContributorLast24Hours();
  const ctx = canvas.getContext('2d');

  let fontFamily = 'sans-serif';
  let fontLoadedFrom = null;

  const fontCandidates = [
    path.join(process.cwd(), 'src', 'assets', 'camp', 'Inter-Regular.TTF'),
    path.join(process.cwd(), 'src', 'assets', 'camp', 'FORTE.TTF'),
    path.join(process.cwd(), 'assets', 'camp', 'Inter-Regular.TTF'),
    path.join(process.cwd(), 'assets', 'camp', 'FORTE.TTF'),
    path.join(__dirname, '..', 'assets', 'camp', 'Inter-Regular.TTF'),
    path.join(__dirname, '..', 'assets', 'camp', 'FORTE.TTF'),
    path.join(__dirname, '..', '..', 'assets', 'camp', 'Inter-Regular.TTF'),
    path.join(__dirname, '..', '..', 'assets', 'camp', 'FORTE.TTF'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
  ];

  for (const candidate of fontCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        GlobalFonts.registerFromPath(candidate, 'CampStatusSans');
        fontFamily = 'CampStatusSans';
        fontLoadedFrom = candidate;
        break;
      } catch (_error) {
        // ignore duplicate registrations
      }
    }
  }

  console.log(`[camp-status] font family: ${fontFamily}`);
  console.log(`[camp-status] font source: ${fontLoadedFrom || 'none'}`);

  const font = (size, weight = 'normal') => `${weight} ${size}px ${fontFamily}`;

  const colors = {
    white: '#f8fafc',
    soft: '#cbd5e1',
    muted: '#94a3b8',
    gold: '#fde68a',
    green: '#22c55e',
    blue: '#93c5fd',
    border: 'rgba(255,255,255,0.08)',
    panel: 'rgba(15, 23, 42, 0.78)',
    card: 'rgba(255,255,255,0.08)',
    cardStrong: 'rgba(255,255,255,0.12)'
  };

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

  const progressPercent = progress.isMaxLevel
    ? 1
    : Math.max(0, Math.min(1, progress.currentInLevel / Math.max(1, progress.neededForNextLevel)));

  const nextTarget = progress.nextLevelTarget ?? totals.contribution;
  const percentText = progress.isMaxLevel ? '100%' : `${Math.round(progressPercent * 100)}%`;

  // Header links
  ctx.fillStyle = colors.white;
  ctx.font = font(30, 'bold');
  ctx.fillText('Camp Indigo', 56, 76);

  ctx.fillStyle = colors.soft;
  ctx.font = font(18, 'bold');
  ctx.fillText(`Camp-Stufe ${progress.level}`, 56, 110);

  drawProgressBar(ctx, {
    x: 56,
    y: 146,
    width: 430,
    height: 22,
    fillPercent: progressPercent,
    label: progress.isMaxLevel
      ? 'Max-Stufe erreicht'
      : `${progress.currentInLevel}/${progress.neededForNextLevel} Beitrag bis Stufe ${progress.nextLevel}`,
    fontFamily
  });

  ctx.fillStyle = colors.white;
  ctx.font = font(24, 'bold');
  ctx.fillText(`${totals.contribution} / ${nextTarget}`, 56, 220);

  ctx.fillStyle = colors.soft;
  ctx.font = font(16, 'normal');
  ctx.fillText(
    progress.isMaxLevel
      ? 'Maximale Camp-Stufe erreicht'
      : `Noch ${progress.remainingToNextLevel} Beitrag bis Stufe ${progress.nextLevel} • ${percentText}`,
    56,
    250
  );

  // Linke Karten
  drawCard(ctx, 56, 292, 430, 128, 18, colors.card);
  drawCard(ctx, 56, 446, 430, 160, 18, colors.card);

  ctx.fillStyle = colors.gold;
  ctx.font = font(18, 'bold');
  ctx.fillText('Camp-Daten', 76, 300);

  drawLabelValue(ctx, 'Abenteurer', String(totals.players), 76, 335, 456, font, colors);
  drawLabelValue(ctx, 'Gesamtbeitrag', String(totals.contribution), 76, 367, 456, font, colors);
  drawLabelValue(ctx, 'Gesamt-XP', String(totals.xp), 76, 399, 456, font, colors);

  ctx.fillStyle = colors.gold;
  ctx.font = font(18, 'bold');
  ctx.fillText('Freigeschaltet', 76, 480);

  ctx.font = font(17, 'normal');
  ctx.fillStyle = colors.white;
  getUnlockedFeatures(progress.level).forEach((feature, index) => {
    ctx.fillText(`• ${feature}`, 76, 515 + (index * 30));
  });

  // Rechte Spalte
  drawCard(ctx, 760, 44, 460, 350, 20, colors.card);
  drawCard(ctx, 760, 430, 460, 180, 20, colors.cardStrong);

  ctx.fillStyle = colors.white;
  ctx.font = font(24, 'bold');
  ctx.fillText('Top-Beiträger', 790, 82);

  topContributors.forEach((player, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
    const y = 132 + (index * 86);

    ctx.fillStyle = colors.gold;
    ctx.font = font(22, 'bold');
    ctx.fillText(medal, 792, y);

    ctx.fillStyle = colors.white;
    ctx.font = font(24, 'bold');
    ctx.fillText(trimText(ctx, player.discord_username, 300), 842, y);

    ctx.fillStyle = colors.blue;
    ctx.font = font(16, 'normal');
    ctx.fillText(`Platz ${index + 1}`, 842, y + 24);

    ctx.fillStyle = colors.gold;
    ctx.font = font(20, 'bold');
    ctx.fillText(`Gesamtbeitrag: ${player.contribution}`, 842, y + 52);
  });

  ctx.fillStyle = colors.gold;
  ctx.font = font(22, 'bold');
  ctx.fillText('Aktivster Spieler (24h)', 790, 468);

  if (topContributor24h) {
    ctx.fillStyle = colors.white;
    ctx.font = font(24, 'bold');
    ctx.fillText(trimText(ctx, topContributor24h.discord_username, 360), 790, 512);

    drawMiniStat(ctx, '+Beitrag', `+${topContributor24h.contribution_24h}`, 790, 545, 170, font, colors);
    drawMiniStat(ctx, '+XP', `+${topContributor24h.xp_24h || 0}`, 980, 545, 170, font, colors);
  } else {
    ctx.fillStyle = colors.soft;
    ctx.font = font(18, 'normal');
    ctx.fillText('Noch keine Aktivität in den letzten 24h.', 790, 512);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = font(16, 'normal');
  ctx.fillText('Grafik wird automatisch bei Lagerfortschritt aktualisiert.', 56, 664);

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

function drawProgressBar(ctx, { x, y, width, height, fillPercent, label, fontFamily = 'sans-serif' }) {
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  roundRect(ctx, x, y, width, height, 12);
  ctx.fill();

  ctx.fillStyle = '#22c55e';
  roundRect(ctx, x, y, Math.max(18, width * fillPercent), height, 12);
  ctx.fill();

  ctx.font = `16px ${fontFamily}`;
  ctx.fillStyle = '#dbeafe';
  ctx.fillText(label, x, y + height + 24);
}

function drawCard(ctx, x, y, width, height, radius, fillStyle) {
  ctx.fillStyle = fillStyle;
  roundRect(ctx, x, y, width, height, radius);
  ctx.fill();
}

function drawLabelValue(ctx, label, value, x, y, valueX, font, colors) {
  ctx.fillStyle = colors.soft;
  ctx.font = font(15, 'normal');
  ctx.fillText(label, x, y);

  ctx.fillStyle = colors.white;
  ctx.font = font(22, 'bold');
  const measured = ctx.measureText(value).width;
  ctx.fillText(value, valueX - measured, y);
}

function drawMiniStat(ctx, label, value, x, y, width, font, colors) {
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(ctx, x, y, width, 52, 14);
  ctx.fill();

  ctx.fillStyle = colors.soft;
  ctx.font = font(13, 'normal');
  ctx.fillText(label, x + 14, y + 18);

  ctx.fillStyle = colors.white;
  ctx.font = font(22, 'bold');
  ctx.fillText(value, x + 14, y + 40);
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
  getCampTopContributors
};