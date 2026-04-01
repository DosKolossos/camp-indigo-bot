const { CRAFTING_RECIPES } = require('./crafting');

const ITEM_DEFINITIONS = {
  weapon_kit_t1: {
    key: 'weapon_kit_t1',
    label: 'Waffen-Kit T1',
    shortLabel: 'Waffen-Kit T1',
    emoji: '🗡️',
    category: 'equipment_kit',
    targetField: 'weapon_tier',
    targetTier: 1,
    recipe: CRAFTING_RECIPES.weapon_tier[1]
  },
  weapon_kit_t2: {
    key: 'weapon_kit_t2',
    label: 'Waffen-Kit T2',
    shortLabel: 'Waffen-Kit T2',
    emoji: '🗡️',
    category: 'equipment_kit',
    targetField: 'weapon_tier',
    targetTier: 2,
    recipe: CRAFTING_RECIPES.weapon_tier[2]
  },
  weapon_kit_t3: {
    key: 'weapon_kit_t3',
    label: 'Waffen-Kit T3',
    shortLabel: 'Waffen-Kit T3',
    emoji: '🗡️',
    category: 'equipment_kit',
    targetField: 'weapon_tier',
    targetTier: 3,
    recipe: CRAFTING_RECIPES.weapon_tier[3]
  },
  armor_kit_t1: {
    key: 'armor_kit_t1',
    label: 'Rüstungs-Kit T1',
    shortLabel: 'Rüstungs-Kit T1',
    emoji: '🛡️',
    category: 'equipment_kit',
    targetField: 'armor_tier',
    targetTier: 1,
    recipe: CRAFTING_RECIPES.armor_tier[1]
  },
  armor_kit_t2: {
    key: 'armor_kit_t2',
    label: 'Rüstungs-Kit T2',
    shortLabel: 'Rüstungs-Kit T2',
    emoji: '🛡️',
    category: 'equipment_kit',
    targetField: 'armor_tier',
    targetTier: 2,
    recipe: CRAFTING_RECIPES.armor_tier[2]
  },
  armor_kit_t3: {
    key: 'armor_kit_t3',
    label: 'Rüstungs-Kit T3',
    shortLabel: 'Rüstungs-Kit T3',
    emoji: '🛡️',
    category: 'equipment_kit',
    targetField: 'armor_tier',
    targetTier: 3,
    recipe: CRAFTING_RECIPES.armor_tier[3]
  },
  scanner_kit_t1: {
    key: 'scanner_kit_t1',
    label: 'Scanner-Kit T1',
    shortLabel: 'Scanner-Kit T1',
    emoji: '🔎',
    category: 'equipment_kit',
    targetField: 'scanner_tier',
    targetTier: 1,
    recipe: CRAFTING_RECIPES.scanner_tier[1]
  },
  scanner_kit_t2: {
    key: 'scanner_kit_t2',
    label: 'Scanner-Kit T2',
    shortLabel: 'Scanner-Kit T2',
    emoji: '🔎',
    category: 'equipment_kit',
    targetField: 'scanner_tier',
    targetTier: 2,
    recipe: CRAFTING_RECIPES.scanner_tier[2]
  },
  scanner_kit_t3: {
    key: 'scanner_kit_t3',
    label: 'Scanner-Kit T3',
    shortLabel: 'Scanner-Kit T3',
    emoji: '🔎',
    category: 'equipment_kit',
    targetField: 'scanner_tier',
    targetTier: 3,
    recipe: CRAFTING_RECIPES.scanner_tier[3]
  }
};

function getItemDefinition(itemKey) {
  return ITEM_DEFINITIONS[itemKey] || null;
}

function getAllItemDefinitions() {
  return Object.values(ITEM_DEFINITIONS);
}

module.exports = {
  ITEM_DEFINITIONS,
  getItemDefinition,
  getAllItemDefinitions
};
