const starters = require('../config/starters');
const starterGrowth = require('../config/starterGrowth');

const PLAYER_LEVEL_THRESHOLDS = [
  0,     // Level 1
  20,    // Level 2
  55,    // Level 3
  105,   // Level 4
  175,   // Level 5
  270,   // Level 6
  390,   // Level 7
  540,   // Level 8
  720,   // Level 9
  935,   // Level 10
  1190,  // Level 11
  1490,  // Level 12
  1840,  // Level 13
  2245,  // Level 14
  2710,  // Level 15
  3240,  // Level 16
  3840,  // Level 17
  4515,  // Level 18
  5270,  // Level 19
  6110,  // Level 20
  7040   // Level 21
];

const CAMP_LEVEL_THRESHOLDS = [
  0,     // Stufe 1
  40,    // Stufe 2
  120,   // Stufe 3
  260,   // Stufe 4
  500,   // Stufe 5
  900,   // Stufe 6
  1500,  // Stufe 7
  2300   // Stufe 8
];

function getStarterByKey(key) {
  return starters.find(starter => starter.key === key) || null;
}

function getThresholdLevel(value, thresholds) {
  let level = 1;

  for (let i = 0; i < thresholds.length; i += 1) {
    if (value >= thresholds[i]) {
      level = i + 1;
    } else {
      break;
    }
  }

  return level;
}

function calculateLevelFromXp(xp) {
  return getThresholdLevel(Math.max(0, Number(xp) || 0), PLAYER_LEVEL_THRESHOLDS);
}

function getXpProgress(xp) {
  const safeXp = Math.max(0, Number(xp) || 0);
  const level = calculateLevelFromXp(safeXp);
  const levelIndex = level - 1;
  const currentLevelStartXp = PLAYER_LEVEL_THRESHOLDS[levelIndex] ?? 0;
  const nextLevelTotalXp = PLAYER_LEVEL_THRESHOLDS[levelIndex + 1] ?? null;
  const isMaxLevel = nextLevelTotalXp === null;

  if (isMaxLevel) {
    return {
      level,
      currentLevelStartXp,
      nextLevelTotalXp: null,
      currentXpInLevel: safeXp - currentLevelStartXp,
      neededForNextLevel: 0,
      remainingToNextLevel: 0,
      nextLevel: null,
      isMaxLevel: true
    };
  }

  return {
    level,
    currentLevelStartXp,
    nextLevelTotalXp,
    currentXpInLevel: safeXp - currentLevelStartXp,
    neededForNextLevel: nextLevelTotalXp - currentLevelStartXp,
    remainingToNextLevel: Math.max(0, nextLevelTotalXp - safeXp),
    nextLevel: level + 1,
    isMaxLevel: false
  };
}

function calculateCampLevelFromContribution(contribution) {
  return getThresholdLevel(Math.max(0, Number(contribution) || 0), CAMP_LEVEL_THRESHOLDS);
}

function getCampProgress(contribution) {
  const safeContribution = Math.max(0, Number(contribution) || 0);
  const level = calculateCampLevelFromContribution(safeContribution);
  const levelIndex = level - 1;
  const currentLevelStart = CAMP_LEVEL_THRESHOLDS[levelIndex] ?? 0;
  const nextLevelTarget = CAMP_LEVEL_THRESHOLDS[levelIndex + 1] ?? null;
  const isMaxLevel = nextLevelTarget === null;

  if (isMaxLevel) {
    return {
      level,
      currentLevelStart,
      nextLevelTarget: null,
      currentInLevel: safeContribution - currentLevelStart,
      neededForNextLevel: 0,
      remainingToNextLevel: 0,
      nextLevel: null,
      isMaxLevel: true
    };
  }

  return {
    level,
    currentLevelStart,
    nextLevelTarget,
    currentInLevel: safeContribution - currentLevelStart,
    neededForNextLevel: nextLevelTarget - currentLevelStart,
    remainingToNextLevel: Math.max(0, nextLevelTarget - safeContribution),
    nextLevel: level + 1,
    isMaxLevel: false
  };
}

function calculateScaledStats(pokemonKey, level) {
  const starter = getStarterByKey(pokemonKey);
  const safeLevel = Math.max(1, Number(level) || 1);

  if (!starter || !starter.stats) {
    return {
      kraft: 1,
      tempo: 1,
      ausdauer: 1,
      instinkt: 1,
      geschick: 1
    };
  }

  const growth = starterGrowth[pokemonKey] || {
    kraft: 0.5,
    tempo: 0.5,
    ausdauer: 0.5,
    instinkt: 0.5,
    geschick: 0.5
  };

  return {
    kraft: starter.stats.kraft + Math.floor((safeLevel - 1) * growth.kraft),
    tempo: starter.stats.tempo + Math.floor((safeLevel - 1) * growth.tempo),
    ausdauer: starter.stats.ausdauer + Math.floor((safeLevel - 1) * growth.ausdauer),
    instinkt: starter.stats.instinkt + Math.floor((safeLevel - 1) * growth.instinkt),
    geschick: starter.stats.geschick + Math.floor((safeLevel - 1) * growth.geschick)
  };
}

module.exports = {
  PLAYER_LEVEL_THRESHOLDS,
  CAMP_LEVEL_THRESHOLDS,
  calculateLevelFromXp,
  getXpProgress,
  calculateCampLevelFromContribution,
  getCampProgress,
  calculateScaledStats
};