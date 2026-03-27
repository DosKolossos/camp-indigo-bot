const { getPlayerByDiscordUserId, updatePlayerProgress } = require('./playerService');
const { getNumericState, incrementState } = require('./stateService');

function getVillageFoodStateKey(guildKey) {
  return `village_food:${guildKey}`;
}

function getVillageFood(guildKey) {
  if (!guildKey) return 0;
  return getNumericState(getVillageFoodStateKey(guildKey), 0);
}

function depositVillageFood(discordUserId, amount = null) {
  const player = getPlayerByDiscordUserId(discordUserId);
  if (!player) {
    throw new Error('Spieler nicht gefunden.');
  }

  const maxAmount = Math.max(0, Number(player.food) || 0);
  const requestedAmount = amount == null ? maxAmount : Math.floor(Number(amount));
  const safeAmount = Number.isFinite(requestedAmount) ? requestedAmount : 0;

  if (safeAmount <= 0) {
    throw new Error('Du hast keine Nahrung zum Einlagern.');
  }

  if (safeAmount > maxAmount) {
    throw new Error('Du kannst nicht mehr Nahrung einlagern, als du aktuell besitzt.');
  }

  const updatedPlayer = updatePlayerProgress(discordUserId, {
    food: -safeAmount,
    food_credit: safeAmount
  });

  const villageFood = incrementState(getVillageFoodStateKey(player.guild_key), safeAmount);

  return {
    player: updatedPlayer,
    deposited: safeAmount,
    villageFood,
    foodCredit: Number(updatedPlayer?.food_credit) || 0,
    guildKey: player.guild_key
  };
}

function consumeVillageFoodForExpedition(discordUserId, amount) {
  const player = getPlayerByDiscordUserId(discordUserId);
  if (!player) {
    throw new Error('Spieler nicht gefunden.');
  }

  const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
  if (safeAmount <= 0) {
    throw new Error('Ungültige Nahrungsmenge.');
  }

  const villageFood = getVillageFood(player.guild_key);
  const foodCredit = Math.max(0, Number(player.food_credit) || 0);

  if (villageFood < safeAmount) {
    throw new Error('In der Dorfkammer liegt nicht genug Nahrung.');
  }

  if (foodCredit < safeAmount) {
    throw new Error('Du kannst nur so viel Nahrung entnehmen, wie du selbst eingelagert hast.');
  }

  const updatedPlayer = updatePlayerProgress(discordUserId, {
    food_credit: -safeAmount
  });

  const nextVillageFood = incrementState(getVillageFoodStateKey(player.guild_key), -safeAmount);

  return {
    player: updatedPlayer,
    consumed: safeAmount,
    villageFood: nextVillageFood,
    foodCredit: Number(updatedPlayer?.food_credit) || 0,
    guildKey: player.guild_key
  };
}

module.exports = {
  getVillageFoodStateKey,
  getVillageFood,
  depositVillageFood,
  consumeVillageFoodForExpedition
};
