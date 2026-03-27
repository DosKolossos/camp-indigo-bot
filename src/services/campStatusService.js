const path = require('path');
const fs = require('fs');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { getState, setState } = require('./stateService');
const { allPlayers, getCampTotals, getTopContributorLast24Hours } = require('./playerService');
const starters = require('../config/starters');
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
const POKEMON_ASSET_DIR = path.join(__dirname, '..', 'assets', 'pokemon');

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

function getStarterConfig(pokemonKey) {
  return starters.find(starter => starter.key === pokemonKey) || null;
}

function getPokemonAssetPath(pokemonKey) {
  if (!pokemonKey) return null;

  const candidates = [
    path.join(POKEMON_ASSET_DIR, `${pokemonKey}.png`),
    path.join(POKEMON_ASSET_DIR, `${String(pokemonKey).toLowerCase()}.png`)
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
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

function drawImageContain(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;

  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

async function renderCampImageBuffer(guildKey = null) {
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

  const guild = guildKey ? getGuildConfig(guildKey) : null;
  const guildName = guild?.name || guild?.guildName || guild?.title || 'Camp Gilde';

  let fontFamily = 'sans-serif';

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
        break;
      } catch (_error) {
        // ignore duplicate registrations
      }
    }
  }

  const font = (size, weight = 'normal') => `${weight} ${size}px ${fontFamily}`;

  const colors = {
    white: '#f8fafc',
    soft: '#cbd5e1',
    muted: '#94a3b8',
    black: '#000000',
    gold: '#fde68a',
    green: '#22c55e',
    blue: '#93c5fd',
    border: 'rgba(255,255,255,0.08)',
    panel: 'rgba(15, 23, 42, 0.78)',
    card: 'rgba(255,255,255,0.08)',
    cardBlack: 'rgba(0,0,0,0.38)',
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

  const percentText = progress.isMaxLevel ? '100%' : `${Math.round(progressPercent * 100)}%`;

  // Header
  ctx.fillStyle = colors.white;
  ctx.font = font(50, 'bold');

  const displayedGuildName = trimText(ctx, guildName, 420);
  ctx.fillText(`Gilde ${displayedGuildName}`, 56, 50);

  const guildNameWidth = ctx.measureText(displayedGuildName).width;

  ctx.fillStyle = colors.white;
  ctx.font = font(30, 'bold');
  ctx.fillText(`St. ${progress.level}`, 170 + guildNameWidth + 28, 50);

  drawProgressBar(ctx, {
    x: 56,
    y: 66,
    width: 800,
    height: 22,
    fillPercent: progressPercent,
    label: progress.isMaxLevel
      ? 'Max-Stufe erreicht'
      : `${progress.currentInLevel}/${progress.neededForNextLevel} Beiträge bis Stufe ${progress.nextLevel} • ${percentText}`,
    fontFamily
  });

  // Linke Karten
  drawCard(ctx, 45, 392, 300, 128, 18, colors.cardBlack);
  drawCard(ctx, 45, 546, 300, 160, 18, colors.cardBlack);

  ctx.fillStyle = colors.gold;
  ctx.font = font(20, 'bold');
  ctx.fillText('Camp-Daten', 76, 415);

  drawLabelValue(ctx, 'Abenteurer', String(totals.players), 76, 445, 320, font, colors);
  drawLabelValue(ctx, 'Gesamtbeitrag', String(totals.contribution), 76, 477, 320, font, colors);
  drawLabelValue(ctx, 'Gesamt-XP', String(totals.xp), 76, 509, 320, font, colors);

  ctx.fillStyle = colors.gold;
  ctx.font = font(20, 'bold');
  ctx.fillText('Freigeschaltet', 76, 580);

  ctx.font = font(20, 'normal');
  ctx.fillStyle = colors.white;
  getUnlockedFeatures(progress.level).forEach((feature, index) => {
    ctx.fillText(`${feature}`, 76, 615 + (index * 30));
  });

  // Rechte Spalte
  drawCard(ctx, 900, 64, 330, 300, 20, colors.cardBlack);
  drawCard(ctx, 770, 430, 360, 180, 20, colors.cardBlack);

  ctx.fillStyle = colors.gold;
  ctx.font = font(24, 'bold');
  ctx.fillText('Top-Beiträger', 920, 122);

  topContributors.forEach((player, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
    const y = 172 + (index * 86);

    ctx.fillStyle = colors.gold;
    ctx.font = font(22, 'bold');
    ctx.fillText(medal, 920, y);

    ctx.fillStyle = colors.white;
    ctx.font = font(24, 'normal');
    ctx.fillText(`#${index + 1}` + ` ` + trimText(ctx, player.discord_username, 300) , 945, y);

    ctx.fillStyle = colors.gold;
    ctx.font = font(15, 'bold');
    ctx.fillText(`Gesamtbeitrag: ${player.contribution}`, 980, y + 20);
  });

  ctx.fillStyle = colors.gold;
  ctx.font = font(22, 'bold');
  ctx.fillText('Aktivster Spieler (24h)', 790, 468);

  if (topContributor24h) {
    const starter = getStarterConfig(topContributor24h.pokemon_key);

    ctx.fillStyle = colors.white;
    ctx.font = font(24, 'bold');
    ctx.fillText(trimText(ctx, topContributor24h.discord_username, 240), 790, 512);

    ctx.fillStyle = colors.white;
    ctx.font = font(15, 'normal');
    ctx.fillText(
      `Partner: ${starter?.name || topContributor24h.pokemon_key || 'Unbekannt'}`,
      790,
      540
    );

    drawMiniStat(ctx, '+Beitrag', `+${topContributor24h.contribution_24h}`, 780, 560, 170, font, colors.white);
    drawMiniStat(ctx, '+XP', `+${topContributor24h.xp_24h || 0}`, 970, 560, 170, font, colors.white);

    const pokemonCardX = 1050;
    const pokemonCardY = 410;
    const pokemonCardW = 200;
    const pokemonCardH = 200;

    drawCard(ctx, pokemonCardX, pokemonCardY, pokemonCardW, pokemonCardH, 18, 'rgba(255,255,255,0.0)');

    const pokemonAssetPath = getPokemonAssetPath(topContributor24h.pokemon_key);

    if (pokemonAssetPath) {
      try {
        const pokemonImage = await loadImage(pokemonAssetPath);
        drawImageContain(ctx, pokemonImage, pokemonCardX, pokemonCardY, pokemonCardW, pokemonCardH);
      } catch (_error) {
        ctx.fillStyle = colors.black;
        ctx.font = font(14, 'normal');
        ctx.fillText('Bild konnte nicht geladen werden', pokemonCardX + 14, pokemonCardY + 68);
      }
    } else {
      ctx.fillStyle = colors.black;
      ctx.font = font(14, 'normal');
      ctx.fillText('Kein Pokémon-Bild gefunden', pokemonCardX + 14, pokemonCardY + 68);
    }
  } else {
    ctx.fillStyle = colors.black;
    ctx.font = font(18, 'normal');
    ctx.fillText('Noch keine Aktivität in den letzten 24h.', 790, 512);
  }

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
  ctx.fillStyle = 'rgba(15, 23, 42, 0.48)';
  roundRect(ctx, 40, 5, 850, 100, 24);
  ctx.fill();

}

function drawProgressBar(ctx, { x, y, width, height, fillPercent, label, fontFamily = 'sans-serif' }) {
  ctx.fillStyle = 'rgba(255,255,255,0.36)';
  roundRect(ctx, x, y, width, height, 12);
  ctx.fill();

  ctx.fillStyle = '#22c55e';
  roundRect(ctx, x, y, Math.max(18, width * fillPercent), height, 12);
  ctx.fill();

  ctx.font = `16px ${fontFamily}`;
  ctx.fillStyle = '#000000';
  ctx.fillText(label, x + 3, y + height - 6);
}

function drawCard(ctx, x, y, width, height, radius, fillStyle) {
  ctx.fillStyle = fillStyle;
  roundRect(ctx, x, y, width, height, radius);
  ctx.fill();
}

function drawLabelValue(ctx, label, value, x, y, valueX, font, colors) {
  ctx.fillStyle = colors.white;
  ctx.font = font(20, 'normal');
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

  ctx.fillStyle = colors;
  ctx.font = font(13, 'normal');
  ctx.fillText(label, x + 14, y + 18);

  ctx.fillStyle = colors;
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

async function buildCampStatusPayload(guildKey = null) {
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

  const buffer = await renderCampImageBuffer(guildKey);
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

  return await ensureCampStatusMessage(client, guildKey).catch(error => {
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