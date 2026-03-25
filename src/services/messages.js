const starterConfigs = require('../config/starters');
const guildConfigs = require('../config/guilds');

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildWelcomeMessage(player) {
  const starter = starterConfigs.find(item => item.key === player.pokemon_key);
  const guild = guildConfigs.find(item => item.key === player.guild_key);

  const templates = [
    `🎉 **${player.discord_username}** ist Camp Indigo beigetreten!\nPartner-Pokémon: **${starter?.name ?? player.pokemon_key}**\nGilde: **${guild?.name ?? player.guild_key}** ${guild?.emoji ?? ''}`,
    `🏕 Ein neues Pokémon ist im Lager angekommen!\n**${player.discord_username}** startet als **${starter?.name ?? player.pokemon_key}** bei **${guild?.name ?? player.guild_key}** ${guild?.emoji ?? ''}.`,
    `✨ Das Lager wächst weiter: **${player.discord_username}** hat sich **${guild?.name ?? player.guild_key}** ${guild?.emoji ?? ''} angeschlossen.\nGewähltes Pokémon: **${starter?.name ?? player.pokemon_key}**`,
    `🔔 Neu im Camp: **${player.discord_username}**\nPokémon: **${starter?.name ?? player.pokemon_key}**\nGilde: **${guild?.name ?? player.guild_key}** ${guild?.emoji ?? ''}`
  ];

  return pickRandom(templates);
}

function buildLevelUpMessage(player, previousLevel) {
  const starter = starterConfigs.find(item => item.key === player.pokemon_key);
  const guild = guildConfigs.find(item => item.key === player.guild_key);

  const fromLevel = Number(previousLevel) || 1;
  const toLevel = Number(player.level) || fromLevel;

  if (toLevel <= fromLevel) {
    return null;
  }

  const levelText =
    toLevel === fromLevel + 1
      ? `ist auf **Level ${toLevel}** aufgestiegen`
      : `ist von **Level ${fromLevel}** auf **Level ${toLevel}** aufgestiegen`;

  return (
    `🎉 **Levelaufstieg!**\n` +
    `**${player.discord_username}** ${levelText}.\n` +
    `Partner-Pokémon: **${starter?.name ?? player.pokemon_key}** ${starter?.emoji ?? ''}\n` +
    `Gilde: **${guild?.name ?? player.guild_key}** ${guild?.emoji ?? ''}`
  );
}

module.exports = {
  buildWelcomeMessage,
  buildLevelUpMessage
};
