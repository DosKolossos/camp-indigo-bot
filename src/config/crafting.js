const EQUIPMENT_MAX_TIER = 3;

const EQUIPMENT_LABELS = {
  weapon_tier: 'Waffe',
  armor_tier: 'Rüstung',
  scanner_tier: 'Suchgerät'
};

const EQUIPMENT_TIER_NAMES = {
  weapon_tier: ['Keine', 'Improvisierte Klinge', 'Verstärkte Klinge', 'Reliktklinge'],
  armor_tier: ['Keine', 'Feldrüstung', 'Panzerweste', 'Hüterpanzer'],
  scanner_tier: ['Keins', 'Spürsensor', 'Reliktscanner', 'Präzisionsscanner']
};

const CRAFTING_RECIPES = {
  weapon_tier: {
    1: { wood: 12, stone: 8, ore: 4 },
    2: { wood: 18, stone: 12, ore: 8, scrap: 2 },
    3: { wood: 24, stone: 18, ore: 12, scrap: 5 }
  },
  armor_tier: {
    1: { wood: 10, fiber: 6, stone: 4 },
    2: { wood: 16, fiber: 10, stone: 8, ore: 3 },
    3: { wood: 22, fiber: 14, stone: 12, ore: 6 }
  },
  scanner_tier: {
    1: { stone: 6, scrap: 4, fiber: 2 },
    2: { stone: 10, scrap: 7, fiber: 4, ore: 2 },
    3: { stone: 14, scrap: 10, fiber: 6, ore: 4 }
  }
};

module.exports = {
  EQUIPMENT_MAX_TIER,
  EQUIPMENT_LABELS,
  EQUIPMENT_TIER_NAMES,
  CRAFTING_RECIPES
};
