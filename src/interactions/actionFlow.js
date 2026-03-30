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
  logPlayerActivity
} = require('../services/playerService');
const { applyProgressWithLevelUpAnnouncement } = require('../services/levelUpService');
const { syncCampStatusMessage } = require('../services/campStatusService');
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

const SAMMELN_COOLDOWN_MS = parseDurationMs(process.env.SAMMELN_COOLDOWN_MINUTES, 10 * 60 * 1000, 60 * 1000);
const ARBEITEN_COOLDOWN_MS = parseDurationMs(process.env.ARBEITEN_COOLDOWN_MINUTES, 8 * 60 * 1000, 60 * 1000);
const TRAINIEREN_COOLDOWN_MS = parseDurationMs(process.env.TRAINIEREN_COOLDOWN_MINUTES, 12 * 60 * 1000, 60 * 1000);

const TRAINIEREN_UNLOCK_CAMP_LEVEL = 2;
const ERKUNDEN_UNLOCK_CAMP_LEVEL = 3;
const SCHMIEDE_UNLOCK_CAMP_LEVEL = 4;
const EXPEDITION_UNLOCK_CAMP_LEVEL = 4;

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

  const sammelnRemaining = getCooldownRemainingMs(player, 'sammeln_cooldown_until');
  const arbeitenRemaining = getCooldownRemainingMs(player, 'arbeiten_cooldown_until');
  const trainierenRemaining = getCooldownRemainingMs(player, 'trainieren_cooldown_until');

  return {
    stats,
    sammelnCooldownMs,
    arbeitenCooldownMs,
    trainierenCooldownMs,
    sammelnRemaining,
    arbeitenRemaining,
    trainierenRemaining,
    sammelnLabel: sammelnRemaining > 0
      ? `⏳ Sammeln in ${formatRemaining(sammelnRemaining)}`
      : `✅ Sammeln ist bereit (${formatRemaining(sammelnCooldownMs)} Cooldown)`,
    arbeitenLabel: arbeitenRemaining > 0
      ? `⏳ Arbeiten in ${formatRemaining(arbeitenRemaining)}`
      : `✅ Arbeiten ist bereit (${formatRemaining(arbeitenCooldownMs)} Cooldown)`,
    trainierenLabel: trainierenRemaining > 0
      ? `⏳ Trainieren in ${formatRemaining(trainierenRemaining)}`
      : `✅ Trainieren ist bereit (${formatRemaining(trainierenCooldownMs)} Cooldown)`
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

function getUnlockedActionKeys(campLevel) {
  const keys = ['profil', 'sammeln', 'arbeiten', 'lager'];

  if (campLevel >= TRAINIEREN_UNLOCK_CAMP_LEVEL) {
    keys.push('trainieren');
  }

  if (campLevel >= ERKUNDEN_UNLOCK_CAMP_LEVEL) {
    keys.push('erkunden');
  }

  if (campLevel >= SCHMIEDE_UNLOCK_CAMP_LEVEL) {
    keys.push('schmiede', 'expedition');
  }

  return keys;
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

  return '✨ Alle aktuell eingebauten Camp-Aktionen sind freigeschaltet.';
}

function buildActionOptions({ busy, cooldowns, trainingUnlocked, erkundenUnlocked, forgeUnlocked, expeditionUnlocked }) {
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
      description: 'Baue Waffen, Rüstungen und Suchgeräte',
      value: 'schmiede',
      emoji: '⚒️'
    });
  }

  if (expeditionUnlocked) {
    options.push({
      label: 'Expedition',
      description: busy.isBusy
        ? `Gesperrt: Du bist auf ${getBusyActivityLabel(busy.activityKey)}`
        : 'Bestehe gefährliche Ausflüge für bessere Beute',
      value: 'expedition',
      emoji: '🗺️'
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
  const labels = {
    wood: 'Holz',
    stone: 'Stein',
    food: 'Nahrung',
    ore: 'Erz',
    fiber: 'Fasern',
    scrap: 'Schrott'
  };

  return Object.entries(costs)
    .filter(([, amount]) => Number(amount) > 0)
    .map(([key, amount]) => `${amount} ${labels[key] || key}`)
    .join(', ');
}

function canAffordCosts(player, costs = {}) {
  return Object.entries(costs).every(([key, amount]) => (Number(player[key]) || 0) >= (Number(amount) || 0));
}

function buildForgeButtons(player) {
  const weaponTier = Number(player.weapon_tier) || 0;
  const armorTier = Number(player.armor_tier) || 0;
  const scannerTier = Number(player.scanner_tier) || 0;

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
      new ButtonBuilder()
        .setCustomId('camp:actions:back')
        .setLabel('Zurück zum Aktionsmenü')
        .setStyle(ButtonStyle.Secondary)
    )
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
      `⛏️ Erz: ${player.ore || 0}\n` +
      `🧵 Fasern: ${player.fiber || 0}\n` +
      `🪛 Schrott: ${player.scrap || 0}\n\n` +
      `**Nächste Rezepte**\n` +
      `${weaponTier >= EQUIPMENT_MAX_TIER ? 'Waffe: Max-Stufe' : `Waffe T${nextWeaponTier}: ${formatRecipeCost(CRAFTING_RECIPES.weapon_tier[nextWeaponTier])}`}\n` +
      `${armorTier >= EQUIPMENT_MAX_TIER ? 'Rüstung: Max-Stufe' : `Rüstung T${nextArmorTier}: ${formatRecipeCost(CRAFTING_RECIPES.armor_tier[nextArmorTier])}`}\n` +
      `${scannerTier >= EQUIPMENT_MAX_TIER ? 'Suchgerät: Max-Stufe' : `Suchgerät T${nextScannerTier}: ${formatRecipeCost(CRAFTING_RECIPES.scanner_tier[nextScannerTier])}`}\n\n` +
      `Waffen erhöhen deine **Kampfkraft**, Rüstungen geben **Sicherheit**, Suchgeräte verbessern deine **Beute** auf Expeditionen.`
    )
    .setColor(0xf39c12);

  return {
    content: '',
    embeds: [embed],
    components: buildForgeButtons(player)
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
    components: buildForgeButtons(refreshedPlayer)
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
    statusLines.push(`⚔️ Kampfkraft: ${getPlayerCombatPower(player)} | 🔎 Beutebonus: +${getPlayerLootBonus(player)}%`);
  }

  const actionOptions = buildActionOptions({
    busy,
    cooldowns,
    trainingUnlocked,
    erkundenUnlocked,
    forgeUnlocked,
    expeditionUnlocked
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
    .setPlaceholder('Aktion auswählen')
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
  const xp = randomInt(2, 4) + Math.floor((((stats.kraft || 0) + (stats.ausdauer || 0))) / 12);

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

  logPlayerActivity(player.discord_user_id, 'expedition', {
    food: -foodCost,
    exploration_points: baseExploration,
    xp
  });

  await syncCampStatusMessage(interaction.client, player.guild_key).catch(() => null);

  return buildActionResultPayload({
    title: success ? '🗺️ Expedition gelungen' : '🗺️ Expedition überstanden',
    description:
      `${success ? 'Du hast die Expedition erfolgreich abgeschlossen.' : 'Die Expedition war hart, aber du bist mit etwas Beute zurückgekehrt.'}\n\n` +
      `⚔️ Kampfkraft: ${combatPower} (Wurf ${expeditionRoll})\n` +
      `🎯 Schwierigkeit: ${difficulty}\n\n` +
      `-${foodCost} Nahrung\n` +
      `+${baseExploration} Erkundungspunkte\n` +
      `+${xp} XP\n` +
      `+${ore + bonusOre} Erz\n` +
      `+${fiber + bonusFiber} Fasern\n` +
      `+${scrap + bonusScrap} Schrott\n` +
      `${bonusHit ? '\n🔎 Dein Suchgerät hat zusätzliche Beute entdeckt.\n' : '\n'}` +
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
          `**🍖 Nahrung:** ${totals.food}
` +
          `**🪨 Stein:** ${totals.stone}
` +
          `**⛏️ Erz:** ${totals.ore || 0}
` +
          `**🧵 Fasern:** ${totals.fiber || 0}
` +
          `**🪛 Schrott:** ${totals.scrap || 0}
` +
          `**🏗️ Gesamtbeitrag:** ${totals.contribution}
` +
          `**🧭 Erkundungspunkte:** ${totals.exploration_points || 0}

` +
          `**Freischaltungen**
` +
          `Stufe 1: Sammeln, Arbeiten
` +
          `Stufe 2: Trainieren
` +
          `Stufe 3: Erkunden
` +
          `Stufe 4: Schmiede, Expedition`
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
        interaction.customId === 'camp:actions:menu' ||
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

    if (interaction.isButton() && interaction.customId.startsWith('camp:forge:')) {
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