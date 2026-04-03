const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const starters = require('../config/starters');
const guilds = require('../config/guilds');
const {
  getPlayerByDiscordUserId,
  getCampTotals,
  setActionCooldown,
  logPlayerActivity,
  setPlayerBusy
} = require('../services/playerService');
const { applyProgressWithLevelUpAnnouncement } = require('../services/levelUpService');
const { syncCampStatusMessage } = require('../services/campStatusService');
const {
  BOSS_FOOD_TARGET,
  getBossDisplayState,
  donateFoodToBoss,
  joinBossEvent,
  formatRewardSummary
} = require('../services/bossService');
const {
  getXpProgress,
  getCampProgress,
  calculateScaledStats
} = require('../services/progressionService');
const {
  EQUIPMENT_MAX_TIER,
  EQUIPMENT_LABELS,
  EQUIPMENT_TIER_NAMES,
  CRAFTING_RECIPES
} = require('../config/crafting');
const { getItemDefinition } = require('../config/items');
const {
  getPlayerInventory,
  craftMarketItem,
  useInventoryItem,
  getCraftableMarketItems,
  getUsableInventoryItems
} = require('../services/inventoryService');
const {
  getMarketOverview,
  getListingById,
  createListing,
  cancelListing,
  purchaseListing
} = require('../services/marketService');

const SAMMELN_COOLDOWN_MS = parseDurationMs(process.env.SAMMELN_COOLDOWN_MINUTES, 10 * 60 * 1000, 60 * 1000);
const ARBEITEN_COOLDOWN_MS = parseDurationMs(process.env.ARBEITEN_COOLDOWN_MINUTES, 8 * 60 * 1000, 60 * 1000);
const TRAINIEREN_COOLDOWN_MS = parseDurationMs(process.env.TRAINIEREN_COOLDOWN_MINUTES, 12 * 60 * 1000, 60 * 1000);
const EXPEDITION_COOLDOWN_MS = parseDurationMs(process.env.EXPEDITION_COOLDOWN_MINUTES, 30 * 60 * 1000, 60 * 1000);

const TRAINIEREN_UNLOCK_CAMP_LEVEL = 2;
const ERKUNDEN_UNLOCK_CAMP_LEVEL = 3;
const SCHMIEDE_UNLOCK_CAMP_LEVEL = 4;
const EXPEDITION_UNLOCK_CAMP_LEVEL = 4;
const MARKET_UNLOCK_CAMP_LEVEL = 4;
const BOSS_UNLOCK_CAMP_LEVEL = 5;

const ERKUNDEN_BUSY_MS = 60 * 60 * 1000;
const EXPEDITION_BUSY_MS = parseDurationMs(
  process.env.EXPEDITION_BUSY_MINUTES,
  60 * 60 * 1000,
  60 * 1000
);

const MAX_MARKET_LISTINGS = 10;

const RESOURCE_LABELS = {
  wood: 'Holz',
  food: 'Nahrung',
  stone: 'Stein',
  ore: 'Erz',
  fiber: 'Fasern',
  scrap: 'Schrott'
};

const RESOURCE_EMOJIS = {
  wood: '🪵',
  food: '🍖',
  stone: '🪨',
  ore: '⛏️',
  fiber: '🧵',
  scrap: '🪛'
};

const BUSY_BLOCKED_ACTIONS = new Set([
  'sammeln',
  'arbeiten',
  'trainieren',
  'erkunden',
  'schmiede',
  'expedition',
  'markt'
]);

const RESOURCE_ALIASES = {
  holz: 'wood',
  wood: 'wood',
  nahrung: 'food',
  food: 'food',
  stein: 'stone',
  stone: 'stone',
  erz: 'ore',
  ore: 'ore',
  faser: 'fiber',
  fasern: 'fiber',
  fiber: 'fiber',
  schrott: 'scrap',
  scrap: 'scrap'
};

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

async function safeShowModal(interaction, modal) {
  try {
    await interaction.showModal(modal);
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

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('camp:actions:back')
      .setLabel('Zurück zum Aktionsmenü')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildMarketBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('camp:market:back')
      .setLabel('Zurück zum Markt')
      .setStyle(ButtonStyle.Secondary)
  );
}

function truncateText(value, maxLength = 100) {
  const safeValue = String(value || '');
  if (safeValue.length <= maxLength) {
    return safeValue;
  }

  return `${safeValue.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatResourceAmount(key, amount, withEmoji = false) {
  const prefix = withEmoji ? `${RESOURCE_EMOJIS[key] || '📦'} ` : '';
  return `${prefix}${amount} ${RESOURCE_LABELS[key] || key}`;
}

function formatResourceMap(values = {}, withEmoji = false) {
  return Object.entries(values)
    .filter(([, amount]) => Number(amount) > 0)
    .map(([key, amount]) => formatResourceAmount(key, amount, withEmoji))
    .join(', ');
}

function parsePriceInput(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    throw new Error('Bitte gib einen Preis an, z. B. wood=12, stone=6, ore=2.');
  }

  const normalized = {};
  const parts = raw.split(',').map(part => part.trim()).filter(Boolean);

  for (const part of parts) {
    const [rawKey, rawValue] = part.split('=').map(piece => piece?.trim());
    const key = RESOURCE_ALIASES[String(rawKey || '').toLowerCase()];
    const value = Number(rawValue);

    if (!key || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      throw new Error('Preisformat ungültig. Nutze z. B. wood=12, stone=6, ore=2.');
    }

    if (value > 0) {
      normalized[key] = (normalized[key] || 0) + value;
    }
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error('Ein Angebot braucht mindestens einen positiven Preisbestandteil.');
  }

  return normalized;
}

function formatInventorySummary(inventory = []) {
  if (!inventory.length) {
    return 'Keine handelbaren Kits im Inventar.';
  }

  return inventory
    .map(entry => `${entry.item?.emoji || '📦'} ${entry.item?.label || entry.item_key} ×${entry.quantity}`)
    .join('\n');
}

function getSellableInventory(player) {
  return getPlayerInventory(player.id).filter(entry => entry.item);
}

function buildCraftKitOptions() {
  return getCraftableMarketItems().map(item => ({
    label: item.shortLabel || item.label,
    description: truncateText(`Rezept: ${formatResourceMap(item.recipe)}`, 100),
    value: item.key,
    emoji: item.emoji
  }));
}

function buildUsableKitOptions(player) {
  return getUsableInventoryItems(player.id).map(entry => ({
    label: entry.item?.shortLabel || entry.item?.label || entry.item_key,
    description: truncateText(
      `Verfügbar: ${entry.quantity} | Nutzt ${EQUIPMENT_LABELS[entry.item?.targetField] || entry.item?.targetField} auf Stufe ${entry.item?.targetTier}`,
      100
    ),
    value: entry.item_key,
    emoji: entry.item?.emoji || '📦'
  }));
}

function buildSellableInventoryOptions(inventoryEntries) {
  return inventoryEntries.map(entry => ({
    label: entry.item?.shortLabel || entry.item?.label || entry.item_key,
    description: truncateText(`Im Inventar: ${entry.quantity}`, 100),
    value: entry.item_key,
    emoji: entry.item?.emoji || '📦'
  }));
}

function buildMarketListingOptions(listings) {
  return listings.map(listing => ({
    label: truncateText(`${listing.item?.shortLabel || listing.item?.label || listing.item_key} ×${listing.quantity}`, 100),
    description: truncateText(`${listing.seller_name}: ${formatResourceMap(listing.price)}`, 100),
    value: String(listing.id),
    emoji: listing.item?.emoji || '📦'
  }));
}

function buildOwnListingOptions(listings) {
  return listings.map(listing => ({
    label: truncateText(`${listing.item?.shortLabel || listing.item?.label || listing.item_key} ×${listing.quantity}`, 100),
    description: truncateText(`Preis: ${formatResourceMap(listing.price)}`, 100),
    value: String(listing.id),
    emoji: listing.item?.emoji || '📦'
  }));
}

function buildCreateListingModal(itemKey, itemLabel) {
  return new ModalBuilder()
    .setCustomId(`camp:market:create:${itemKey}`)
    .setTitle(`Angebot erstellen: ${truncateText(itemLabel, 30)}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('quantity')
          .setLabel('Menge')
          .setPlaceholder('z. B. 1')
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('price')
          .setLabel('Preis')
          .setPlaceholder('z. B. wood=12, stone=6, ore=2')
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      )
    );
}

function clampMin(value, minValue) {
  return Math.max(minValue, value);
}

function getPlayerStats(player) {
  return calculateScaledStats(player.pokemon_key, player.level);
}

function getTempoAdjustedCooldownMs(baseCooldownMs, tempo = 0) {
  const reductionSteps = Math.floor((Number(tempo) || 0) / 3);
  const reductionMs = reductionSteps * 30 * 1000;
  return clampMin(baseCooldownMs - reductionMs, 2 * 60 * 1000);
}

function getDisplayedMaxHp(stats) {
  return 35 + ((Number(stats?.ausdauer) || 0) * 6);
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
    case 'boss':
      return 'Bosskampf';
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
  const stats = getPlayerStats(player);

  const sammelnCooldownMs = getTempoAdjustedCooldownMs(SAMMELN_COOLDOWN_MS, stats.tempo);
  const arbeitenCooldownMs = getTempoAdjustedCooldownMs(ARBEITEN_COOLDOWN_MS, stats.tempo);
  const trainierenCooldownMs = getTempoAdjustedCooldownMs(TRAINIEREN_COOLDOWN_MS, stats.tempo);
  const expeditionCooldownMs = getTempoAdjustedCooldownMs(EXPEDITION_COOLDOWN_MS, stats.tempo);

  const sammelnRemaining = getCooldownRemainingMs(player, 'sammeln_cooldown_until');
  const arbeitenRemaining = getCooldownRemainingMs(player, 'arbeiten_cooldown_until');
  const trainierenRemaining = getCooldownRemainingMs(player, 'trainieren_cooldown_until');
  const expeditionRemaining = getCooldownRemainingMs(player, 'expedition_cooldown_until');

  return {
    stats,
    sammelnCooldownMs,
    arbeitenCooldownMs,
    trainierenCooldownMs,
    expeditionCooldownMs,
    sammelnRemaining,
    arbeitenRemaining,
    trainierenRemaining,
    expeditionRemaining,
    sammelnLabel: sammelnRemaining > 0
      ? `⏳ Sammeln in ${formatRemaining(sammelnRemaining)}`
      : `✅ Sammeln ist bereit (${formatRemaining(sammelnCooldownMs)} Cooldown)`,
    arbeitenLabel: arbeitenRemaining > 0
      ? `⏳ Arbeiten in ${formatRemaining(arbeitenRemaining)}`
      : `✅ Arbeiten ist bereit (${formatRemaining(arbeitenCooldownMs)} Cooldown)`,
    trainierenLabel: trainierenRemaining > 0
      ? `⏳ Trainieren in ${formatRemaining(trainierenRemaining)}`
      : `✅ Trainieren ist bereit (${formatRemaining(trainierenCooldownMs)} Cooldown)`,
    expeditionLabel: expeditionRemaining > 0
      ? `⏳ Expedition in ${formatRemaining(expeditionRemaining)}`
      : `✅ Expedition ist bereit (${formatRemaining(expeditionCooldownMs)} Cooldown)`
  };
}

function getCampState() {
  const totals = getCampTotals();
  const progress = getCampProgress({
    contribution: totals.contribution,
    exploration_points: totals.exploration_points
  });

  return { totals, progress };
}

function getNextUnlockHint(campLevel) {
  if (campLevel < TRAINIEREN_UNLOCK_CAMP_LEVEL) {
    return `🔒 Nächste Freischaltung: **Trainieren** ab Camp-Stufe ${TRAINIEREN_UNLOCK_CAMP_LEVEL}`;
  }

  if (campLevel < ERKUNDEN_UNLOCK_CAMP_LEVEL) {
    return `🔒 Nächste Freischaltung: **Erkunden** ab Camp-Stufe ${ERKUNDEN_UNLOCK_CAMP_LEVEL}`;
  }

  if (campLevel < SCHMIEDE_UNLOCK_CAMP_LEVEL) {
    return `🔒 Nächste Freischaltung: **Schmiede & Expedition** ab Camp-Stufe ${SCHMIEDE_UNLOCK_CAMP_LEVEL}`;
  }

  if (campLevel < MARKET_UNLOCK_CAMP_LEVEL) {
    return `🔒 Nächste Freischaltung: **Markt** ab Camp-Stufe ${MARKET_UNLOCK_CAMP_LEVEL}`;
  }

  if (campLevel < BOSS_UNLOCK_CAMP_LEVEL) {
    return `🔒 Nächste Freischaltung: **Bossjagd** ab Camp-Stufe ${BOSS_UNLOCK_CAMP_LEVEL}`;
  }

  return '✨ Alle aktuell eingebauten Camp-Aktionen sind freigeschaltet.';
}

function buildActionOptions({
  busy,
  cooldowns,
  trainingUnlocked,
  erkundenUnlocked,
  forgeUnlocked,
  expeditionUnlocked,
  marketUnlocked,
  bossUnlocked,
  bossState
}) {
  const options = [
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
    }
  ];

  if (trainingUnlocked) {
    options.push({
      label: 'Trainieren',
      description: busy.isBusy
        ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
        : cooldowns.trainierenRemaining > 0
          ? `Wieder bereit in ${formatRemaining(cooldowns.trainierenRemaining)}`
          : 'Steigere deine Werte über XP',
      value: 'trainieren',
      emoji: '💪'
    });
  }

  if (erkundenUnlocked) {
    options.push({
      label: 'Erkunden',
      description: busy.isBusy
        ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
        : 'Verdiene Erkundungspunkte und finde Materialien',
      value: 'erkunden',
      emoji: '🧭'
    });
  }

  if (forgeUnlocked) {
    options.push({
      label: 'Schmiede',
      description: busy.isBusy
        ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
        : 'Baue Waffen, Rüstungen und Suchgeräte',
      value: 'schmiede',
      emoji: '⚒️'
    });
  }

  if (expeditionUnlocked) {
    options.push({
      label: 'Expedition',
      description: busy.isBusy
        ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
        : cooldowns.expeditionRemaining > 0
          ? `Wieder bereit in ${formatRemaining(cooldowns.expeditionRemaining)}`
          : 'Bestehe gefährliche Ausflüge für bessere Beute',
      value: 'expedition',
      emoji: '🗺️'
    });
  }

  if (marketUnlocked) {
    options.push({
      label: 'Markt',
      description: busy.isBusy
        ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
        : 'Handle Kits gegen Rohstoffe mit anderen Spielern',
      value: 'markt',
      emoji: '🛒'
    });
  }

  if (bossUnlocked) {
    options.push({
      label: 'Bossjagd',
      description: bossState?.isActive
        ? `Boss aktiv bis ${formatShortTime(bossState.event.resolve_at)} Uhr`
        : bossState?.event?.status === 'ready'
          ? `Boss erscheint um ${formatShortTime(bossState.event.spawn_at)} Uhr`
          : bossState?.event?.status === 'won'
            ? 'Der Boss wurde heute bereits besiegt'
            : bossState?.event?.status === 'lost'
              ? 'Der Bosskampf wurde heute verloren'
              : bossState?.event?.status === 'missed'
                ? 'Heute wurde kein Boss angelockt'
                : `Investiere Nahrung (${bossState?.event?.foodInvested || 0}/${bossState?.event?.foodTarget || BOSS_FOOD_TARGET})`,
      value: 'boss',
      emoji: '👾'
    });
  }
  options.push({
    label: 'Lagerstatus',
    description: 'Zeigt den Fortschritt des gesamten Camps',
    value: 'lager',
    emoji: '🏕️'
  });

  return options;
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
    `${busy.label}\n\nWährend du unterwegs bist, kannst du keine Aktion im Camp starten und auch nicht Schmiede oder Markt benutzen.`
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

function buildMarketResultPayload({ title, description, color = 0x3498db }) {
  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
    ],
    components: [buildMarketBackRow()]
  };
}

function buildCooldownPayload(actionLabel, remainingMs) {
  return buildActionResultPayload({
    title: '⏳ Aktion noch nicht bereit',
    description: `**${actionLabel}** ist noch auf Cooldown.\n\nBitte warte noch **${formatRemaining(remainingMs)}**.`,
    color: 0xe67e22
  });
}

function formatShortTime(dateLike) {
  if (!dateLike) return '–';

  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return '–';

  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin'
  }).format(date);
}

function buildBossBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('camp:boss:refresh')
      .setLabel('Bossansicht aktualisieren')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('camp:actions:back')
      .setLabel('Zurück zum Aktionsmenü')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildBossPayload(player) {
  const camp = getCampState().progress;

  if (camp.level < BOSS_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Bossjagd noch nicht freigeschaltet',
      `Die Bossjagd wird erst ab **Camp-Stufe ${BOSS_UNLOCK_CAMP_LEVEL}** verfügbar.\n\nAktuell ist euer Camp auf **Stufe ${camp.level}**.`
    );
  }

  const bossState = getBossDisplayState(player);
  if (!bossState) {
    // Fallback / "Bossjagd noch nicht verfügbar"
    return buildLockedPayload(
      '🔒 Bossjagd noch nicht verfügbar',
      'Die Bossjagd ist noch nicht verfügbar. Bitte warte auf die Freischaltung.'
    );
  }
  const rewardSummary = Array.isArray(event.rewardSummary?.rewards)
    ? event.rewardSummary.rewards.slice(0, 6).map(entry => {
      const summary = formatRewardSummary(entry.rewards || {});
      return `• **${entry.username}**: ${summary || 'kein zusätzlicher Loot'}`;
    }).join('\n')
    : null;

  let description =
    `${boss.emoji || '👾'} **Tagesboss:** ${boss.name}\n` +
    `**Status:** ${event.statusLabel}\n` +
    `**Boss-Stärke:** ${event.bossPower}\n` +
    `**Nahrung investiert:** ${event.foodInvested}/${event.foodTarget}\n` +
    `**Teilnehmer:** ${event.participantCount}\n` +
    `**Teamstärke:** ${event.teamPower}\n\n`;

  if (bossState.isFundingOpen) {
    description +=
      `Investiere Nahrung, um den Boss für **20:00 Uhr** anzulocken.\n` +
      `Noch benötigt: **${event.foodRemaining} Nahrung**.\n` +
      `Deine Nahrung: **${player.food || 0}**`;

    if (participation?.donated_food) {
      description += `\nDein Beitrag heute: **${participation.donated_food} Nahrung**`;
    }
  } else if (event.status === 'ready') {
    description +=
      `${boss.intro || 'Der Boss wurde bereits angelockt.'}\n` +
      `Spawn: **${formatShortTime(event.spawn_at)} Uhr**`;
  } else if (bossState.isActive) {
    description +=
      `${boss.intro || 'Der Bosskampf läuft.'}\n` +
      `Ende des Kampfes: **${formatShortTime(event.resolve_at)} Uhr**`;

    if (participation?.joined_at) {
      description += `\n\n✅ Du nimmst bereits am Bosskampf teil.`;
    } else if (busy.isBusy) {
      description += `\n\n🚫 Du bist aktuell auf **${getBusyActivityLabel(busy.activityKey)}** und kannst daher nicht teilnehmen.`;
    }
  } else if (event.status === 'won' || event.status === 'lost') {
    description +=
      `**Siegchance:** ${event.successChance == null ? '–' : `${Math.round(event.successChance * 100)}%`}\n` +
      `**Wurf:** ${event.successRoll == null ? '–' : `${event.successRoll}/100`}\n\n` +
      `${event.status === 'won' ? '🏆 Das Camp hat den Boss besiegt.' : '💀 Der Boss war zu stark.'}`;

    if (rewardSummary) {
      description += `\n\n**Belohnungen**\n${rewardSummary}`;
    }
  } else if (event.status === 'missed') {
    description += 'Bis 20:00 Uhr wurde nicht genug Nahrung investiert. Morgen gibt es eine neue Chance.';
  }

  const components = [];

  if (bossState.isFundingOpen) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('camp:boss:donate:1')
          .setLabel('+1 Nahrung')
          .setStyle(ButtonStyle.Success)
          .setDisabled(!bossState.canDonate),
        new ButtonBuilder()
          .setCustomId('camp:boss:donate:5')
          .setLabel('+5 Nahrung')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(!bossState.canDonate)
      )
    );
  }

  if (event.status === 'ready' || bossState.isActive) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('camp:boss:join')
          .setLabel(participation?.joined_at ? 'Bereits beigetreten' : 'Dem Bosskampf beitreten')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!bossState.canJoin)
      )
    );
  }

  components.push(buildBossBackRow());

  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('👾 Bossjagd')
        .setDescription(description)
        .setColor(event.status === 'won' ? 0x27ae60 : event.status === 'lost' ? 0xe74c3c : 0x8e44ad)
    ],
    components
  };
}

async function runBossDonate(player, interaction, requestedAmount) {
  const camp = getCampState().progress;
  if (camp.level < BOSS_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Bossjagd noch nicht freigeschaltet',
      `Die Bossjagd wird erst ab **Camp-Stufe ${BOSS_UNLOCK_CAMP_LEVEL}** verfügbar.`
    );
  }

  try {
    const result = donateFoodToBoss({
      discordUserId: player.discord_user_id,
      amount: requestedAmount
    });

    await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

    return {
      content: '',
      embeds: [
        new EmbedBuilder()
          .setTitle('🍖 Nahrung investiert')
          .setDescription(
            `Du hast **${result.appliedAmount} Nahrung** in die Bossjagd investiert.\n\n` +
            `Fortschritt: **${result.display.event.foodInvested}/${result.display.event.foodTarget}**\n` +
            `Noch benötigt: **${result.display.event.foodRemaining} Nahrung**`
          )
          .setColor(0x27ae60)
      ],
      components: buildBossPayload(result.player).components
    };
  } catch (error) {
    return buildActionResultPayload({
      title: '❌ Investition fehlgeschlagen',
      description: String(error.message || error),
      color: 0xe74c3c
    });
  }
}

async function runBossJoin(player) {
  const camp = getCampState().progress;
  if (camp.level < BOSS_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Bossjagd noch nicht freigeschaltet',
      `Die Bossjagd wird erst ab **Camp-Stufe ${BOSS_UNLOCK_CAMP_LEVEL}** verfügbar.`
    );
  }

  try {
    const result = joinBossEvent({
      discordUserId: player.discord_user_id
    });

    return {
      content: '',
      embeds: [
        new EmbedBuilder()
          .setTitle('⚔️ Bosskampf beigetreten')
          .setDescription(
            `Du stellst dich **${result.display.boss.name}** entgegen.\n\n` +
            `Deine Kampfkraft für diesen Kampf: **${result.participantPower}**\n` +
            `Bis zur Auflösung um **${formatShortTime(result.display.event.resolve_at)} Uhr** bist du für andere Expeditionen blockiert.`
          )
          .setColor(0xc0392b)
      ],
      components: buildBossPayload(result.player).components
    };
  } catch (error) {
    return buildActionResultPayload({
      title: '❌ Teilnahme fehlgeschlagen',
      description: String(error.message || error),
      color: 0xe74c3c
    });
  }
}

function getEquipmentTierName(fieldName, tier) {
  return EQUIPMENT_TIER_NAMES[fieldName]?.[tier] || `Tier ${tier}`;
}

function getPlayerCombatPower(player) {
  const stats = getPlayerStats(player);

  return (
    (player.level || 1) +
    Math.floor((stats.kraft || 0) * 1.4) +
    Math.floor((stats.tempo || 0) * 0.6) +
    ((player.weapon_tier || 0) * 4) +
    ((player.armor_tier || 0) * 3)
  );
}

function getPlayerLootBonus(player) {
  const stats = getPlayerStats(player);
  return ((player.scanner_tier || 0) * 12) + Math.floor((stats.instinkt || 0) / 2);
}

function formatRecipeCost(costs = {}) {
  return formatResourceMap(costs, true);
}

function canAffordCosts(player, costs = {}) {
  return Object.entries(costs).every(([key, amount]) => (Number(player[key]) || 0) >= (Number(amount) || 0));
}

function getForgeInventoryText(player) {
  const inventory = getPlayerInventory(player.id);
  if (!inventory.length) {
    return 'Keine Kits im Inventar.';
  }

  return inventory
    .map(entry => `${entry.item?.emoji || '📦'} ${entry.item?.label || entry.item_key} ×${entry.quantity}`)
    .join('\n');
}

function buildForgeComponents(player) {
  const weaponTier = Number(player.weapon_tier) || 0;
  const armorTier = Number(player.armor_tier) || 0;
  const scannerTier = Number(player.scanner_tier) || 0;
  const craftOptions = buildCraftKitOptions();
  const usableOptions = buildUsableKitOptions(player);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('camp:forge:weapon')
        .setLabel(weaponTier >= EQUIPMENT_MAX_TIER ? 'Waffe max' : 'Waffe schmieden')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(weaponTier >= EQUIPMENT_MAX_TIER),
      new ButtonBuilder()
        .setCustomId('camp:forge:armor')
        .setLabel(armorTier >= EQUIPMENT_MAX_TIER ? 'Rüstung max' : 'Rüstung schmieden')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(armorTier >= EQUIPMENT_MAX_TIER),
      new ButtonBuilder()
        .setCustomId('camp:forge:scanner')
        .setLabel(scannerTier >= EQUIPMENT_MAX_TIER ? 'Suchgerät max' : 'Suchgerät bauen')
        .setStyle(ButtonStyle.Success)
        .setDisabled(scannerTier >= EQUIPMENT_MAX_TIER)
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('camp:forge:craftkit')
        .setPlaceholder('Handelbares Kit herstellen')
        .setDisabled(craftOptions.length === 0)
        .addOptions(
          craftOptions.length
            ? craftOptions
            : [{
              label: 'Keine Kits verfügbar',
              description: 'Aktuell sind keine Markt-Kits definiert.',
              value: 'none'
            }]
        )
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('camp:forge:usekit')
        .setPlaceholder(usableOptions.length ? 'Kit aus Inventar anwenden' : 'Keine nutzbaren Kits im Inventar')
        .setDisabled(usableOptions.length === 0)
        .addOptions(
          usableOptions.length
            ? usableOptions
            : [{
              label: 'Keine nutzbaren Kits',
              description: 'Sammle oder kaufe passende Kits auf dem Markt.',
              value: 'none'
            }]
        )
    ),
    buildBackRow()
  ];
}

function buildForgePayload(player) {
  const weaponTier = Number(player.weapon_tier) || 0;
  const armorTier = Number(player.armor_tier) || 0;
  const scannerTier = Number(player.scanner_tier) || 0;

  const nextWeaponTier = Math.min(weaponTier + 1, EQUIPMENT_MAX_TIER);
  const nextArmorTier = Math.min(armorTier + 1, EQUIPMENT_MAX_TIER);
  const nextScannerTier = Math.min(scannerTier + 1, EQUIPMENT_MAX_TIER);

  const embed = new EmbedBuilder()
    .setTitle('⚒️ Werkbank & Schmiede')
    .setDescription(
      `**Aktuelle Ausrüstung**\n` +
      `Waffe: ${getEquipmentTierName('weapon_tier', weaponTier)}\n` +
      `Rüstung: ${getEquipmentTierName('armor_tier', armorTier)}\n` +
      `Suchgerät: ${getEquipmentTierName('scanner_tier', scannerTier)}\n\n` +
      `**Materialien**\n` +
      `🪵 Holz: ${player.wood || 0}\n` +
      `🍖 Nahrung: ${player.food || 0}\n` +
      `🪨 Stein: ${player.stone || 0}\n` +
      `⛏️ Erz: ${player.ore || 0}\n` +
      `🧵 Fasern: ${player.fiber || 0}\n` +
      `🪛 Schrott: ${player.scrap || 0}\n\n` +
      `**Direkte Ausbauten**\n` +
      `${weaponTier >= EQUIPMENT_MAX_TIER ? 'Waffe: Max-Stufe' : `Waffe T${nextWeaponTier}: ${formatRecipeCost(CRAFTING_RECIPES.weapon_tier[nextWeaponTier])}`}\n` +
      `${armorTier >= EQUIPMENT_MAX_TIER ? 'Rüstung: Max-Stufe' : `Rüstung T${nextArmorTier}: ${formatRecipeCost(CRAFTING_RECIPES.armor_tier[nextArmorTier])}`}\n` +
      `${scannerTier >= EQUIPMENT_MAX_TIER ? 'Suchgerät: Max-Stufe' : `Suchgerät T${nextScannerTier}: ${formatRecipeCost(CRAFTING_RECIPES.scanner_tier[nextScannerTier])}`}\n\n` +
      `**Handelskits im Inventar**\n` +
      `${getForgeInventoryText(player)}\n\n` +
      `Du kannst weiterhin direkt aufrüsten **oder** handelbare Kits herstellen und auf dem Markt anbieten.`
    )
    .setColor(0xf39c12);

  return {
    content: '',
    embeds: [embed],
    components: buildForgeComponents(player)
  };
}

async function runForgeUpgrade(player, interaction, fieldName) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const camp = getCampState().progress;
  if (camp.level < SCHMIEDE_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Schmiede noch nicht freigeschaltet',
      `Die Werkbank wird erst ab **Camp-Stufe ${SCHMIEDE_UNLOCK_CAMP_LEVEL}** ausgebaut.`
    );
  }

  const currentTier = Number(player[fieldName]) || 0;
  if (currentTier >= EQUIPMENT_MAX_TIER) {
    return buildLockedPayload(
      '✨ Bereits maximiert',
      `${EQUIPMENT_LABELS[fieldName]} ist bereits auf der höchsten Ausbaustufe.`
    );
  }

  const nextTier = currentTier + 1;
  const costs = CRAFTING_RECIPES[fieldName]?.[nextTier];
  if (!costs) {
    return buildLockedPayload('⚠️ Rezept fehlt', 'Für diesen Ausbau ist aktuell kein Rezept hinterlegt.');
  }

  if (!canAffordCosts(player, costs)) {
    return buildLockedPayload(
      '📦 Nicht genug Materialien',
      `Dir fehlen Ressourcen für **${EQUIPMENT_LABELS[fieldName]} T${nextTier}**.\n\nBenötigt: ${formatRecipeCost(costs)}`
    );
  }

  const changes = { [fieldName]: 1 };
  for (const [key, amount] of Object.entries(costs)) {
    changes[key] = -(Number(amount) || 0);
  }

  await applyProgressWithLevelUpAnnouncement({
    client: interaction.client,
    discordUserId: player.discord_user_id,
    changes
  });

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  const refreshedPlayer = getPlayerByDiscordUserId(player.discord_user_id);

  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('⚒️ Ausbau abgeschlossen')
        .setDescription(
          `Deine **${EQUIPMENT_LABELS[fieldName]}** wurde verbessert.\n\n` +
          `Neue Stufe: **${getEquipmentTierName(fieldName, nextTier)}**\n` +
          `Verbrauchte Materialien: ${formatRecipeCost(costs)}`
        )
        .setColor(0xf39c12)
    ],
    components: buildForgeComponents(refreshedPlayer)
  };
}

async function runCraftKit(player, interaction, itemKey) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const camp = getCampState().progress;
  if (camp.level < SCHMIEDE_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Schmiede noch nicht freigeschaltet',
      `Die Werkbank wird erst ab **Camp-Stufe ${SCHMIEDE_UNLOCK_CAMP_LEVEL}** ausgebaut.`
    );
  }

  const item = getItemDefinition(itemKey);
  if (!item) {
    return buildLockedPayload('⚠️ Unbekanntes Kit', 'Dieses Kit ist aktuell nicht definiert.');
  }

  try {
    craftMarketItem({ playerId: player.id, itemKey });
  } catch (error) {
    return buildLockedPayload('📦 Herstellung fehlgeschlagen', String(error.message || error));
  }

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);
  const refreshedPlayer = getPlayerByDiscordUserId(player.discord_user_id);

  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('📦 Handelskits hergestellt')
        .setDescription(
          `Du hast **${item.label}** hergestellt.\n\n` +
          `Kosten: ${formatRecipeCost(item.recipe)}\n` +
          `Das Kit liegt jetzt in deinem Inventar und kann auf dem Markt verkauft oder direkt genutzt werden.`
        )
        .setColor(0x16a085)
    ],
    components: buildForgeComponents(refreshedPlayer)
  };
}

async function runUseKit(player, itemKey) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const item = getItemDefinition(itemKey);
  if (!item) {
    return buildLockedPayload('⚠️ Unbekanntes Kit', 'Dieses Kit ist aktuell nicht definiert.');
  }

  try {
    useInventoryItem({ playerId: player.id, itemKey });
  } catch (error) {
    return buildLockedPayload('📦 Kit konnte nicht genutzt werden', String(error.message || error));
  }

  const refreshedPlayer = getPlayerByDiscordUserId(player.discord_user_id);

  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('✨ Kit eingesetzt')
        .setDescription(
          `Du hast **${item.label}** verwendet.\n\n` +
          `${EQUIPMENT_LABELS[item.targetField]} ist jetzt auf **${getEquipmentTierName(item.targetField, item.targetTier)}**.`
        )
        .setColor(0x1abc9c)
    ],
    components: buildForgeComponents(refreshedPlayer)
  };
}

function buildMarketPayload(player) {
  const camp = getCampState().progress;

  if (camp.level < MARKET_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Markt noch nicht freigeschaltet',
      `Der Markt öffnet erst ab **Camp-Stufe ${MARKET_UNLOCK_CAMP_LEVEL}**.\n\nAktuell ist euer Camp auf **Stufe ${camp.level}**.`
    );
  }

  const busy = getBusyStatus(player);
  const overview = getMarketOverview(player.id);
  const activeListings = overview.activeListings.slice(0, MAX_MARKET_LISTINGS);
  const ownListings = overview.ownListings.slice(0, MAX_MARKET_LISTINGS);
  const sellableInventory = getSellableInventory(player);

  const embed = new EmbedBuilder()
    .setTitle('🛒 Markt')
    .setDescription(
      `${busy.isBusy ? `${busy.label}\n\nWährenddessen ist der Markt gesperrt.\n\n` : ''}` +
      `**Deine Ressourcen**\n` +
      `${formatResourceAmount('wood', player.wood || 0, true)}\n` +
      `${formatResourceAmount('food', player.food || 0, true)}\n` +
      `${formatResourceAmount('stone', player.stone || 0, true)}\n` +
      `${formatResourceAmount('ore', player.ore || 0, true)}\n` +
      `${formatResourceAmount('fiber', player.fiber || 0, true)}\n` +
      `${formatResourceAmount('scrap', player.scrap || 0, true)}\n\n` +
      `**Dein Marktinventar**\n${formatInventorySummary(sellableInventory)}\n\n` +
      `**Aktive Angebote**: ${activeListings.length}\n` +
      `**Deine Angebote**: ${ownListings.length}\n\n` +
      `Für neue Angebote wählst du unten zuerst ein Kit aus deinem Inventar. Preisformat im Dialog: **wood=12, stone=6, ore=2**`
    )
    .setColor(0x3498db);

  return {
    content: '',
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('camp:market:listings')
          .setPlaceholder(activeListings.length ? 'Angebot ansehen oder kaufen' : 'Keine aktiven Angebote gefunden')
          .setDisabled(busy.isBusy || activeListings.length === 0)
          .addOptions(
            activeListings.length
              ? buildMarketListingOptions(activeListings)
              : [{
                label: 'Keine Angebote',
                description: 'Im Moment ist kein Angebot aktiv.',
                value: 'none'
              }]
          )
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('camp:market:sellitem')
          .setPlaceholder(sellableInventory.length ? 'Eigenes Kit zum Verkauf auswählen' : 'Kein verkaufbares Kit im Inventar')
          .setDisabled(busy.isBusy || sellableInventory.length === 0)
          .addOptions(
            sellableInventory.length
              ? buildSellableInventoryOptions(sellableInventory)
              : [{
                label: 'Nichts im Inventar',
                description: 'Stelle erst Kits in der Schmiede her.',
                value: 'none'
              }]
          )
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('camp:market:mylistings')
          .setPlaceholder(ownListings.length ? 'Eigenes Angebot verwalten' : 'Du hast keine aktiven Angebote')
          .setDisabled(busy.isBusy || ownListings.length === 0)
          .addOptions(
            ownListings.length
              ? buildOwnListingOptions(ownListings)
              : [{
                label: 'Keine eigenen Angebote',
                description: 'Stelle ein Kit ein, um es hier zu verwalten.',
                value: 'none'
              }]
          )
      ),
      buildBackRow()
    ]
  };
}

function buildListingDetailText(listing) {
  return (
    `${listing.item?.emoji || '📦'} **${listing.item?.label || listing.item_key}** ×${listing.quantity}\n` +
    `Anbieter: **${listing.seller_name}**\n` +
    `Preis: ${formatResourceMap(listing.price, true)}`
  );
}

function buildMarketListingPayload(player, listing) {
  const isOwnListing = Number(listing.seller_player_id) === Number(player.id);

  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('🧾 Angebotsdetails')
        .setDescription(
          `${buildListingDetailText(listing)}\n\n` +
          `${isOwnListing ? 'Dies ist dein eigenes Angebot.' : 'Wenn du genug Ressourcen hast, kannst du dieses Angebot sofort kaufen.'}`
        )
        .setColor(0x2980b9)
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`camp:market:buy:${listing.id}`)
          .setLabel(isOwnListing ? 'Eigenes Angebot' : 'Jetzt kaufen')
          .setStyle(ButtonStyle.Success)
          .setDisabled(isOwnListing || listing.status !== 'active')
      ),
      buildMarketBackRow()
    ]
  };
}

function buildOwnListingPayload(listing) {
  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('📦 Dein Angebot')
        .setDescription(
          `${buildListingDetailText(listing)}\n\n` +
          `Du kannst dieses Angebot zurückziehen. Das Kit landet dann wieder in deinem Inventar.`
        )
        .setColor(0x8e44ad)
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`camp:market:cancel:${listing.id}`)
          .setLabel('Angebot zurückziehen')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(listing.status !== 'active')
      ),
      buildMarketBackRow()
    ]
  };
}

function buildActionMenu(player) {
  const starter = getStarter(player.pokemon_key);
  const guild = getGuild(player.guild_key);
  const cooldowns = getActionStatus(player);
  const busy = getBusyStatus(player);
  const camp = getCampState().progress;

  const trainingUnlocked = camp.level >= TRAINIEREN_UNLOCK_CAMP_LEVEL;
  const erkundenUnlocked = camp.level >= ERKUNDEN_UNLOCK_CAMP_LEVEL;
  const forgeUnlocked = camp.level >= SCHMIEDE_UNLOCK_CAMP_LEVEL;
  const expeditionUnlocked = camp.level >= EXPEDITION_UNLOCK_CAMP_LEVEL;
  const marketUnlocked = camp.level >= MARKET_UNLOCK_CAMP_LEVEL;
  const bossUnlocked = camp.level >= BOSS_UNLOCK_CAMP_LEVEL;
  const bossState = bossUnlocked ? getBossDisplayState(player) : null;

  const nextUnlockHint = getNextUnlockHint(camp.level);

  const statusLines = [
    busy.label,
    cooldowns.sammelnLabel,
    cooldowns.arbeitenLabel
  ];

  if (trainingUnlocked) {
    statusLines.push(cooldowns.trainierenLabel);
  }

  if (forgeUnlocked) {
    statusLines.push(cooldowns.expeditionLabel);
    statusLines.push(`⚔️ Kampfkraft: ${getPlayerCombatPower(player)} | 🔎 Beutebonus: +${getPlayerLootBonus(player)}%`);
  }

  if (bossUnlocked && bossState) {
    const bossLine = bossState.isActive
      ? `👾 Boss aktiv: ${bossState.boss.name} bis ${formatShortTime(bossState.event.resolve_at)} Uhr (${bossState.event.participantCount} Teilnehmer)`
      : bossState.event.status === 'ready'
        ? `👾 Boss angelockt: ${bossState.boss.name} spawnt um ${formatShortTime(bossState.event.spawn_at)} Uhr`
        : bossState.event.status === 'won'
          ? `👾 Boss besiegt: ${bossState.boss.name}`
          : bossState.event.status === 'lost'
            ? `👾 Boss verloren: ${bossState.boss.name}`
            : bossState.event.status === 'missed'
              ? '👾 Heute wurde kein Boss angelockt'
              : `👾 Bossjagd: ${bossState.event.foodInvested}/${bossState.event.foodTarget} Nahrung investiert`;

    statusLines.push(bossLine);
  }

  const actionOptions = buildActionOptions({
    busy,
    cooldowns,
    trainingUnlocked,
    erkundenUnlocked,
    forgeUnlocked,
    expeditionUnlocked,
    marketUnlocked,
    bossUnlocked,
    bossState
  });

  const embed = new EmbedBuilder()
    .setTitle('🎮 Deine Aktionen')
    .setDescription(
      `**Pokémon:** ${starter?.name ?? player.pokemon_key} ${starter?.emoji ?? ''}\n` +
      `**Gilde:** ${guild?.name ?? player.guild_key} ${guild?.emoji ?? ''}\n` +
      `**Level:** ${player.level}\n` +
      `**Fortschritt:** ${getXpProgressText(player)}\n` +
      `**Camp-Stufe:** ${camp.level} (${camp.phaseLabel})\n\n` +
      `**Status**\n` +
      `${statusLines.join('\n')}\n\n` +
      `${nextUnlockHint}\n\n` +
      'Wähle deine nächste Aktion.'
    )
    .setFooter({
      text: 'Falls dieses Menü später nicht mehr reagiert, öffne es erneut über die feste Aktionsnachricht.'
    })
    .setColor(guild?.color ?? 0x5865f2);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('camp:actions:menu')
    .setPlaceholder(
      busy.isBusy
        ? `Unterwegs: ${getBusyActivityLabel(busy.activityKey)}`
        : 'Aktion auswählen'
    )
    .addOptions(actionOptions);

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
  const camp = getCampState().progress;
  const stats = calculateScaledStats(player.pokemon_key, player.level);
  const maxHp = getDisplayedMaxHp(stats);
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
      `${buildStatsText(stats)}\n` +
      `**❤️ Max-KP:** ${maxHp}\n` +
      `**⚔️ Kampfkraft:** ${getPlayerCombatPower(player)}\n` +
      `**🔎 Beutebonus:** +${getPlayerLootBonus(player)}%\n\n` +
      `**Ressourcen**\n` +
      `**🪵 Holz:** ${player.wood}\n` +
      `**🍖 Nahrung:** ${player.food}\n` +
      `**🪨 Stein:** ${player.stone}\n` +
      `**⛏️ Erz:** ${player.ore || 0}\n` +
      `**🧵 Fasern:** ${player.fiber || 0}\n` +
      `**🪛 Schrott:** ${player.scrap || 0}\n` +
      `**🏗️ Lagerbeitrag:** ${player.contribution}\n` +
      `**🧭 Erkundungspunkte:** ${player.exploration_points || 0}\n\n` +
      `**Ausrüstung**\n` +
      `Waffe: ${getEquipmentTierName('weapon_tier', Number(player.weapon_tier) || 0)}\n` +
      `Rüstung: ${getEquipmentTierName('armor_tier', Number(player.armor_tier) || 0)}\n` +
      `Suchgerät: ${getEquipmentTierName('scanner_tier', Number(player.scanner_tier) || 0)}\n\n` +
      `**Status**\n` +
      `${busy.label}\n` +
      `${cooldowns.sammelnLabel}\n` +
      `${cooldowns.arbeitenLabel}\n` +
      `${cooldowns.trainierenLabel}` +
      `${camp.level >= EXPEDITION_UNLOCK_CAMP_LEVEL ? `\n${cooldowns.expeditionLabel}` : ''}`
    )
    .setColor(guild?.color ?? 0x2ecc71);

  return {
    content: '',
    embeds: [embed],
    components: [buildBackRow()]
  };
}

async function runSammeln(player, interaction) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const cooldowns = getActionStatus(player);
  const { stats } = cooldowns;

  const remainingMs = getCooldownRemainingMs(player, 'sammeln_cooldown_until');
  if (remainingMs > 0) {
    return buildCooldownPayload('Sammeln', remainingMs);
  }

  const wood = randomInt(1, 2) + Math.floor((stats.geschick || 0) / 5);
  const food = randomInt(0, 1) + Math.floor((stats.instinkt || 0) / 5);
  const stone = randomInt(0, 1) + Math.floor((stats.kraft || 0) / 8);
  const xp = randomInt(3, 5) + Math.floor(((stats.instinkt || 0) + (stats.geschick || 0)) / 10);

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

  const cooldownUntil = new Date(Date.now() + cooldowns.sammelnCooldownMs).toISOString();
  setActionCooldown(player.discord_user_id, 'sammeln', cooldownUntil);

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  return buildActionResultPayload({
    title: '🌿 Sammeln abgeschlossen',
    description:
      `Du warst für das Lager unterwegs.\n\n` +
      `+${wood} Holz\n` +
      `+${food} Nahrung\n` +
      `+${stone} Stein\n` +
      `+${xp} XP\n\n` +
      `**Instinkt** und **Geschick** haben deine Ausbeute verbessert.\n` +
      `Nächste Sammelaktion in **${formatRemaining(cooldowns.sammelnCooldownMs)}**.${result.levelUpText}`,
    color: 0x27ae60
  });
}

async function runArbeiten(player, interaction) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const cooldowns = getActionStatus(player);
  const { stats } = cooldowns;

  const remainingMs = getCooldownRemainingMs(player, 'arbeiten_cooldown_until');
  if (remainingMs > 0) {
    return buildCooldownPayload('Arbeiten', remainingMs);
  }

  const contribution = randomInt(2, 4) + Math.floor((stats.kraft || 0) / 4);
  const wood = randomInt(0, 1) + Math.floor((stats.geschick || 0) / 9);
  const stone = randomInt(0, 1) + Math.floor((stats.kraft || 0) / 10);
  const xp = randomInt(2, 4) + Math.floor(((stats.kraft || 0) + (stats.ausdauer || 0)) / 12);

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

  const cooldownUntil = new Date(Date.now() + cooldowns.arbeitenCooldownMs).toISOString();
  setActionCooldown(player.discord_user_id, 'arbeiten', cooldownUntil);

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  return buildActionResultPayload({
    title: '🔨 Arbeit im Lager erledigt',
    description:
      `Du hast beim Ausbau des Camps geholfen.\n\n` +
      `+${contribution} Lagerbeitrag\n` +
      `+${wood} Holz\n` +
      `+${stone} Stein\n` +
      `+${xp} XP\n\n` +
      `**Kraft** hat deinen Lagerbeitrag verbessert.\n` +
      `Nächste Arbeitsaktion in **${formatRemaining(cooldowns.arbeitenCooldownMs)}**.${result.levelUpText}`,
    color: 0xe67e22
  });
}

async function runTrainieren(player, interaction) {
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

  const cooldowns = getActionStatus(player);
  const { stats } = cooldowns;

  const remainingMs = getCooldownRemainingMs(player, 'trainieren_cooldown_until');
  if (remainingMs > 0) {
    return buildCooldownPayload('Trainieren', remainingMs);
  }

  const xp =
    randomInt(6, 9) +
    Math.floor(((stats.kraft || 0) + (stats.tempo || 0)) / 8);

  const result = await applyProgressWithLevelUpAnnouncement({
    client: interaction.client,
    discordUserId: player.discord_user_id,
    changes: { xp }
  });

  logPlayerActivity(player.discord_user_id, 'trainieren', {
    xp
  });

  const cooldownUntil = new Date(Date.now() + cooldowns.trainierenCooldownMs).toISOString();
  setActionCooldown(player.discord_user_id, 'trainieren', cooldownUntil);

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  return buildActionResultPayload({
    title: '💪 Training abgeschlossen',
    description:
      `Du hast konzentriert trainiert und dein Pokémon weiterentwickelt.\n\n` +
      `+${xp} XP\n\n` +
      `**Kraft** und **Tempo** haben dein Training verbessert.\n` +
      `Nächstes Training in **${formatRemaining(cooldowns.trainierenCooldownMs)}**.${result.levelUpText}`,
    color: 0x9b59b6
  });
}

async function runErkunden(player, interaction) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const camp = getCampState().progress;
  if (camp.level < ERKUNDEN_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Erkunden noch nicht freigeschaltet',
      `Erkundungen werden erst ab **Camp-Stufe ${ERKUNDEN_UNLOCK_CAMP_LEVEL}** möglich.\n\nAktuell ist euer Camp auf **Stufe ${camp.level}**.`
    );
  }

  const stats = getPlayerStats(player);
  const explorationPoints =
    randomInt(4, 7) +
    Math.floor(((stats.instinkt || 0) + (stats.geschick || 0)) / 10);

  const xp =
    randomInt(4, 7) +
    Math.floor((stats.tempo || 0) / 6);

  const foodCost = 1;

  if ((player.food || 0) < foodCost) {
    return buildLockedPayload(
      '🍖 Nicht genug Nahrung',
      'Für eine Erkundung benötigst du **1 Nahrung**.'
    );
  }

  const result = await applyProgressWithLevelUpAnnouncement({
    client: interaction.client,
    discordUserId: player.discord_user_id,
    changes: {
      food: -foodCost,
      exploration_points: explorationPoints,
      xp
    }
  });

  const busyUntil = new Date(Date.now() + ERKUNDEN_BUSY_MS).toISOString();
  setPlayerBusy(player.discord_user_id, 'erkunden', busyUntil);

  logPlayerActivity(player.discord_user_id, 'erkunden', {
    food: -foodCost,
    exploration_points: explorationPoints,
    xp,
    busy_until: busyUntil
  });

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  return buildActionResultPayload({
    title: '🧭 Erkundung gestartet',
    description:
      `Du machst dich auf den Weg und bist jetzt für **1 Stunde** unterwegs.\n\n` +
      `-${foodCost} Nahrung\n` +
      `+${explorationPoints} Erkundungspunkte\n` +
      `+${xp} XP\n\n` +
      `Rückkehr in **${formatRemaining(ERKUNDEN_BUSY_MS)}**.` +
      `${result.levelUpText}`,
    color: 0x3498db
  });
}

async function runExpedition(player, interaction) {
  const busy = getBusyStatus(player);
  if (busy.isBusy) {
    return buildBusyPayload(player);
  }

  const camp = getCampState().progress;
  if (camp.level < EXPEDITION_UNLOCK_CAMP_LEVEL) {
    return buildLockedPayload(
      '🔒 Expeditionen noch nicht freigeschaltet',
      `Expeditionen werden erst ab **Camp-Stufe ${EXPEDITION_UNLOCK_CAMP_LEVEL}** möglich.`
    );
  }

  const cooldowns = getActionStatus(player);
  const remainingMs = getCooldownRemainingMs(player, 'expedition_cooldown_until');
  if (remainingMs > 0) {
    return buildCooldownPayload('Expedition', remainingMs);
  }

  const foodCost = 2;
  if ((player.food || 0) < foodCost) {
    return buildLockedPayload(
      '🍖 Nicht genug Nahrung',
      `Für eine Expedition benötigst du **${foodCost} Nahrung**.`
    );
  }

  const combatPower = getPlayerCombatPower(player);
  const lootBonusPercent = getPlayerLootBonus(player);
  const expeditionRoll = combatPower + randomInt(1, 12);
  const difficulty = randomInt(18, 34);
  const success = expeditionRoll >= difficulty;

  const baseExploration = success ? randomInt(12, 20) : randomInt(4, 8);
  const xp = success ? randomInt(8, 13) : randomInt(3, 6);
  const ore = success ? randomInt(1, 2) : randomInt(0, 1);
  const fiber = success ? randomInt(1, 2) : randomInt(0, 1);
  const scrap = success ? randomInt(1, 2) : randomInt(0, 1);

  const bonusRoll = randomInt(1, 100);
  const bonusHit = bonusRoll <= lootBonusPercent;
  const bonusOre = bonusHit ? 1 : 0;
  const bonusFiber = bonusHit ? 1 : 0;
  const bonusScrap = bonusHit ? 1 : 0;

  const result = await applyProgressWithLevelUpAnnouncement({
    client: interaction.client,
    discordUserId: player.discord_user_id,
    changes: {
      food: -foodCost,
      exploration_points: baseExploration,
      xp,
      ore: ore + bonusOre,
      fiber: fiber + bonusFiber,
      scrap: scrap + bonusScrap
    }
  });

  const cooldownUntil = new Date(Date.now() + cooldowns.expeditionCooldownMs).toISOString();
  setActionCooldown(player.discord_user_id, 'expedition', cooldownUntil);

  const busyUntil = new Date(Date.now() + EXPEDITION_BUSY_MS).toISOString();
  setPlayerBusy(player.discord_user_id, 'expedition', busyUntil);

  logPlayerActivity(player.discord_user_id, 'expedition', {
    food: -foodCost,
    exploration_points: baseExploration,
    xp,
    busy_until: busyUntil,
    cooldown_until: cooldownUntil
  });

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  return buildActionResultPayload({
    title: '🗺️ Expedition gestartet',
    description:
      `${success ? 'Du bist erfolgreich zu einer Expedition aufgebrochen.' : 'Die Expedition beginnt holprig, aber du bist unterwegs.'}\n\n` +
      `⚔️ Kampfkraft: ${combatPower} (Wurf ${expeditionRoll})\n` +
      `🎯 Schwierigkeit: ${difficulty}\n\n` +
      `-${foodCost} Nahrung\n` +
      `+${baseExploration} Erkundungspunkte\n` +
      `+${xp} XP\n` +
      `+${ore + bonusOre} Erz\n` +
      `+${fiber + bonusFiber} Fasern\n` +
      `+${scrap + bonusScrap} Schrott\n` +
      `${bonusHit ? '\n🔎 Dein Suchgerät hat zusätzliche Beute entdeckt.\n' : '\n'}` +
      `Rückkehr in **${formatRemaining(EXPEDITION_BUSY_MS)}**.\n` +
      `Nächste Expedition in **${formatRemaining(cooldowns.expeditionCooldownMs)}**.` +
      `${result.levelUpText}`,
    color: success ? 0x1abc9c : 0x95a5a6
  });
}

function buildLagerPayload() {
  const { totals, progress: camp } = getCampState();

  const campProgressText = camp.isMaxLevel
    ? 'Max-Stufe erreicht'
    : `${camp.currentInLevel}/${camp.neededForNextLevel} ${camp.progressionLabel} bis Stufe ${camp.nextLevel}`;

  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('🏕️ Lagerstatus')
        .setDescription(
          `**Camp-Stufe:** ${camp.level}\n` +
          `**Phase:** ${camp.phaseLabel}\n` +
          `**Camp-Fortschritt:** ${campProgressText}\n\n` +
          `**Abenteurer:** ${totals.players}\n` +
          `**Gesamt-XP:** ${totals.xp}\n\n` +
          `**🪵 Holz:** ${totals.wood}\n` +
          `**🍖 Nahrung:** ${totals.food}\n` +
          `**🪨 Stein:** ${totals.stone}\n` +
          `**⛏️ Erz:** ${totals.ore || 0}\n` +
          `**🧵 Fasern:** ${totals.fiber || 0}\n` +
          `**🪛 Schrott:** ${totals.scrap || 0}\n` +
          `**🏗️ Gesamtbeitrag:** ${totals.contribution}\n` +
          `**🧭 Erkundungspunkte:** ${totals.exploration_points || 0}\n\n` +
          `**Freischaltungen**\n` +
          `Stufe 1: Sammeln, Arbeiten\n` +
          `Stufe 2: Trainieren\n` +
          `Stufe 3: Erkunden\n` +
          `Stufe 4: Schmiede, Expedition, Markt\n` +
          `Stufe 5: Bossjagd`
        )
        .setColor(0xf1c40f)
    ],
    components: [buildBackRow()]
  };
}

function getMissingPlayerPayload() {
  return {
    content: 'Du hast noch kein Abenteuer begonnen. Öffne das Menü bitte erneut über die feste Aktionsnachricht.',
    embeds: [],
    components: []
  };
}

module.exports = {
  canHandleInteraction(interaction) {
    return Boolean(
      interaction.customId &&
      (
        interaction.customId === 'camp:actions:open' ||
        interaction.customId === 'camp:actions:back' ||
        interaction.customId === 'camp:market:back' ||
        interaction.customId === 'camp:boss:refresh' ||
        interaction.customId === 'camp:boss:join' ||
        interaction.customId.startsWith('camp:boss:donate:') ||
        interaction.customId === 'camp:market:listings' ||
        interaction.customId === 'camp:market:sellitem' ||
        interaction.customId === 'camp:market:mylistings' ||
        interaction.customId.startsWith('camp:market:buy:') ||
        interaction.customId.startsWith('camp:market:cancel:') ||
        interaction.customId.startsWith('camp:market:create:') ||
        interaction.customId === 'camp:actions:menu' ||
        interaction.customId === 'camp:forge:craftkit' ||
        interaction.customId === 'camp:forge:usekit' ||
        interaction.customId === 'camp:forge:weapon' ||
        interaction.customId === 'camp:forge:armor' ||
        interaction.customId === 'camp:forge:scanner'
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
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      await interaction.editReply(buildActionMenu(player)).catch(() => null);
      return true;
    }

    if (interaction.isButton() && interaction.customId === 'camp:boss:refresh') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);
      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      await interaction.editReply(buildBossPayload(player)).catch(() => null);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith('camp:boss:donate:')) {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);
      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      const amount = Number(interaction.customId.split(':').pop()) || 1;
      await interaction.editReply(await runBossDonate(player, interaction, amount)).catch(() => null);
      return true;
    }

    if (interaction.isButton() && interaction.customId === 'camp:boss:join') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);
      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      await interaction.editReply(await runBossJoin(player)).catch(() => null);
      return true;
    }

    if (interaction.isButton() && interaction.customId === 'camp:market:back') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      await interaction.editReply(buildMarketPayload(player)).catch(() => null);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith('camp:market:buy:')) {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);
      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      if (getBusyStatus(player).isBusy) {
        await interaction.editReply(buildBusyPayload(player)).catch(() => null);
        return true;
      }

      const listingId = Number(interaction.customId.split(':').pop());

      try {
        const listing = purchaseListing({ listingId, buyerPlayerId: player.id });
        const refreshedPlayer = getPlayerByDiscordUserId(player.discord_user_id);

        await interaction.editReply({
          content: '',
          embeds: [
            new EmbedBuilder()
              .setTitle('✅ Kauf abgeschlossen')
              .setDescription(
                `Du hast **${listing.quantity}x ${listing.item?.label || listing.item_key}** gekauft.\n\n` +
                `Gezahlt: ${formatResourceMap(listing.price, true)}\n\n` +
                `Das Kit liegt jetzt in deinem Inventar.`
              )
              .setColor(0x27ae60)
          ],
          components: [buildMarketBackRow(), buildBackRow()]
        }).catch(() => null);

        await syncCampStatusMessage(interaction.client, refreshedPlayer.guild_key).catch(() => null);
      } catch (error) {
        await interaction.editReply(buildMarketResultPayload({
          title: '❌ Kauf fehlgeschlagen',
          description: String(error.message || error),
          color: 0xe74c3c
        })).catch(() => null);
      }

      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith('camp:market:cancel:')) {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);
      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      if (getBusyStatus(player).isBusy) {
        await interaction.editReply(buildBusyPayload(player)).catch(() => null);
        return true;
      }

      const listingId = Number(interaction.customId.split(':').pop());

      try {
        const listing = cancelListing({ listingId, sellerPlayerId: player.id });

        await interaction.editReply({
          content: '',
          embeds: [
            new EmbedBuilder()
              .setTitle('↩️ Angebot zurückgezogen')
              .setDescription(
                `Dein Angebot für **${listing.quantity}x ${listing.item?.label || listing.item_key}** wurde entfernt.\n\n` +
                `Das Kit liegt wieder in deinem Inventar.`
              )
              .setColor(0xf39c12)
          ],
          components: [buildMarketBackRow(), buildBackRow()]
        }).catch(() => null);
      } catch (error) {
        await interaction.editReply(buildMarketResultPayload({
          title: '❌ Rückzug fehlgeschlagen',
          description: String(error.message || error),
          color: 0xe74c3c
        })).catch(() => null);
      }

      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith('camp:forge:')) {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      if (interaction.customId === 'camp:forge:weapon') {
        await interaction.editReply(await runForgeUpgrade(player, interaction, 'weapon_tier')).catch(() => null);
        return true;
      }

      if (interaction.customId === 'camp:forge:armor') {
        await interaction.editReply(await runForgeUpgrade(player, interaction, 'armor_tier')).catch(() => null);
        return true;
      }

      if (interaction.customId === 'camp:forge:scanner') {
        await interaction.editReply(await runForgeUpgrade(player, interaction, 'scanner_tier')).catch(() => null);
        return true;
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'camp:market:sellitem') {
      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.reply({ ...getMissingPlayerPayload(), flags: MessageFlags.Ephemeral }).catch(() => null);
        return true;
      }

      if (getBusyStatus(player).isBusy) {
        await interaction.reply({ ...buildBusyPayload(player), flags: MessageFlags.Ephemeral }).catch(() => null);
        return true;
      }

      const itemKey = interaction.values[0];
      if (!itemKey || itemKey === 'none') {
        const ok = await safeDeferUpdate(interaction);
        if (!ok) return false;
        await interaction.editReply(buildMarketPayload(player)).catch(() => null);
        return true;
      }

      const item = getItemDefinition(itemKey);
      if (!item) {
        await interaction.reply({
          content: 'Dieses Item ist nicht definiert.',
          flags: MessageFlags.Ephemeral
        }).catch(() => null);
        return true;
      }

      const ok = await safeShowModal(interaction, buildCreateListingModal(itemKey, item.label));
      return ok;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'camp:forge:craftkit') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      if (getBusyStatus(player).isBusy) {
        await interaction.editReply(buildBusyPayload(player)).catch(() => null);
        return true;
      }

      const itemKey = interaction.values[0];
      if (!itemKey || itemKey === 'none') {
        await interaction.editReply(buildForgePayload(player)).catch(() => null);
        return true;
      }

      await interaction.editReply(await runCraftKit(player, interaction, itemKey)).catch(() => null);
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'camp:forge:usekit') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      if (getBusyStatus(player).isBusy) {
        await interaction.editReply(buildBusyPayload(player)).catch(() => null);
        return true;
      }

      const itemKey = interaction.values[0];
      if (!itemKey || itemKey === 'none') {
        await interaction.editReply(buildForgePayload(player)).catch(() => null);
        return true;
      }

      await interaction.editReply(await runUseKit(player, itemKey)).catch(() => null);
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'camp:market:listings') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      if (getBusyStatus(player).isBusy) {
        await interaction.editReply(buildBusyPayload(player)).catch(() => null);
        return true;
      }

      const listingId = Number(interaction.values[0]);
      if (!listingId) {
        await interaction.editReply(buildMarketPayload(player)).catch(() => null);
        return true;
      }

      const listing = getListingById(listingId);
      if (!listing) {
        await interaction.editReply(buildMarketResultPayload({
          title: '❌ Angebot nicht gefunden',
          description: 'Dieses Angebot existiert nicht mehr.',
          color: 0xe74c3c
        })).catch(() => null);
        return true;
      }

      await interaction.editReply(buildMarketListingPayload(player, listing)).catch(() => null);
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'camp:market:mylistings') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      if (getBusyStatus(player).isBusy) {
        await interaction.editReply(buildBusyPayload(player)).catch(() => null);
        return true;
      }

      const listingId = Number(interaction.values[0]);
      if (!listingId) {
        await interaction.editReply(buildMarketPayload(player)).catch(() => null);
        return true;
      }

      const listing = getListingById(listingId);
      if (!listing) {
        await interaction.editReply(buildMarketResultPayload({
          title: '❌ Angebot nicht gefunden',
          description: 'Dieses Angebot existiert nicht mehr.',
          color: 0xe74c3c
        })).catch(() => null);
        return true;
      }

      await interaction.editReply(buildOwnListingPayload(listing)).catch(() => null);
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'camp:actions:menu') {
      const ok = await safeDeferUpdate(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      const value = interaction.values[0];

      if (getBusyStatus(player).isBusy && BUSY_BLOCKED_ACTIONS.has(value)) {
        await interaction.editReply(buildBusyPayload(player)).catch(() => null);
        return true;
      }

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

      if (value === 'schmiede') {
        await interaction.editReply(buildForgePayload(player)).catch(() => null);
        return true;
      }

      if (value === 'expedition') {
        await interaction.editReply(await runExpedition(player, interaction)).catch(() => null);
        return true;
      }

      if (value === 'markt') {
        await interaction.editReply(buildMarketPayload(player)).catch(() => null);
        return true;
      }

      if (value === 'boss') {
        await interaction.editReply(buildBossPayload(player)).catch(() => null);
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith('camp:market:create:')) {
      const ok = await safeDeferReply(interaction);
      if (!ok) return false;

      const player = getPlayerByDiscordUserId(interaction.user.id);

      if (!player) {
        await interaction.editReply(getMissingPlayerPayload()).catch(() => null);
        return true;
      }

      if (getBusyStatus(player).isBusy) {
        await interaction.editReply(buildBusyPayload(player)).catch(() => null);
        return true;
      }

      const itemKey = interaction.customId.split(':').slice(-1)[0];
      const item = getItemDefinition(itemKey);

      if (!item) {
        await interaction.editReply(buildMarketResultPayload({
          title: '❌ Item nicht gefunden',
          description: 'Dieses Item ist nicht definiert.',
          color: 0xe74c3c
        })).catch(() => null);
        return true;
      }

      const quantityRaw = interaction.fields.getTextInputValue('quantity');
      const priceRaw = interaction.fields.getTextInputValue('price');
      const quantity = Number(quantityRaw);

      if (!Number.isInteger(quantity) || quantity <= 0) {
        await interaction.editReply(buildMarketResultPayload({
          title: '❌ Ungültige Menge',
          description: 'Bitte gib eine ganze Zahl größer als 0 an.',
          color: 0xe74c3c
        })).catch(() => null);
        return true;
      }

      try {
        const price = parsePriceInput(priceRaw);
        const listing = createListing({
          sellerPlayerId: player.id,
          itemKey,
          quantity,
          price
        });

        await interaction.editReply(buildMarketResultPayload({
          title: '✅ Angebot erstellt',
          description:
            `Du hast **${listing.quantity}x ${listing.item?.label || listing.item_key}** eingestellt.\n\n` +
            `Preis: ${formatResourceMap(listing.price, true)}`,
          color: 0x27ae60
        })).catch(() => null);
      } catch (error) {
        await interaction.editReply(buildMarketResultPayload({
          title: '❌ Angebot fehlgeschlagen',
          description: String(error.message || error),
          color: 0xe74c3c
        })).catch(() => null);
      }

      return true;
    }

    return false;
  }
};