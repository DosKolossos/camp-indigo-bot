const starters = require('../config/starters');
const starterGrowth = require('../config/starterGrowth');

const PLAYER_LEVEL_THRESHOLDS = [
  0,
  20,
  55,
  105,
  175,
  270,
  390,
  540,
  720,
  935,
  1190,
  1490,
  1840,
  2245,
  2710,
  3240,
  3840,
  4515,
  5270,
  6110,
  7040
];

const CAMP_BUILD_THRESHOLDS = [
  0,
  40,
  120
];

const CAMP_EXPLORATION_THRESHOLDS = [
  0,
  140,
  380,
  780,
  1380,
  2180
];

const CAMP_LEVEL_THRESHOLDS = [
  ...CAMP_BUILD_THRESHOLDS,
  ...CAMP_EXPLORATION_THRESHOLDS.slice(1)
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

function normalizeCampInput(input) {
  if (typeof input === 'number') {
    return {
      contribution: Math.max(0, Number(input) || 0),
      explorationPoints: 0
    };
  }

  return {
    contribution: Math.max(0, Number(input?.contribution) || 0),
    explorationPoints: Math.max(
      0,
      Number(input?.explorationPoints ?? input?.exploration_points) || 0
    )
  };
}

function buildProgressPayload({
  level,
  currentLevelStart,
  nextLevelTarget,
  resourceValue,
  progressionKey,
  progressionLabel,
  phaseLabel
}) {
  const isMaxLevel = nextLevelTarget === null;

  if (isMaxLevel) {
    return {
      level,
      currentLevelStart,
      nextLevelTarget: null,
      currentInLevel: resourceValue - currentLevelStart,
      neededForNextLevel: 0,
      remainingToNextLevel: 0,
      nextLevel: null,
      isMaxLevel: true,
      progressionKey,
      progressionLabel,
      phaseLabel,
      resourceValue
    };
  }

  return {
    level,
    currentLevelStart,
    nextLevelTarget,
    currentInLevel: resourceValue - currentLevelStart,
    neededForNextLevel: nextLevelTarget - currentLevelStart,
    remainingToNextLevel: Math.max(0, nextLevelTarget - resourceValue),
    nextLevel: level + 1,
    isMaxLevel: false,
    progressionKey,
    progressionLabel,
    phaseLabel,
    resourceValue
  };
}

function calculateCampLevelFromContribution(contribution) {
  return getThresholdLevel(Math.max(0, Number(contribution) || 0), CAMP_BUILD_THRESHOLDS);
}

function getCampProgress(input) {
  const { contribution, explorationPoints } = normalizeCampInput(input);
  const buildLevel = calculateCampLevelFromContribution(contribution);

  if (buildLevel < 3) {
    const levelIndex = buildLevel - 1;
    const currentLevelStart = CAMP_BUILD_THRESHOLDS[levelIndex] ?? 0;
    const nextLevelTarget = CAMP_BUILD_THRESHOLDS[levelIndex + 1] ?? null;

    return {
      ...buildProgressPayload({
        level: buildLevel,
        currentLevelStart,
        nextLevelTarget,
        resourceValue: contribution,
        progressionKey: 'contribution',
        progressionLabel: 'Beitrag',
        phaseLabel: 'Ausbau'
      }),
      contribution,
      explorationPoints
    };
  }

  const explorationStage = getThresholdLevel(explorationPoints, CAMP_EXPLORATION_THRESHOLDS);
  const level = 2 + explorationStage;
  const levelIndex = explorationStage - 1;
  const currentLevelStart = CAMP_EXPLORATION_THRESHOLDS[levelIndex] ?? 0;
  const nextLevelTarget = CAMP_EXPLORATION_THRESHOLDS[levelIndex + 1] ?? null;

  return {
    ...buildProgressPayload({
      level,
      currentLevelStart,
      nextLevelTarget,
      resourceValue: explorationPoints,
      progressionKey: 'exploration_points',
      progressionLabel: 'Erkundungspunkte',
      phaseLabel: 'Gebietserkundung'
    }),
    contribution,
    explorationPoints
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
  CAMP_BUILD_THRESHOLDS,
  CAMP_EXPLORATION_THRESHOLDS,
  calculateLevelFromXp,
  getXpProgress,
  calculateCampLevelFromContribution,
  getCampProgress,
  calculateScaledStats
};
