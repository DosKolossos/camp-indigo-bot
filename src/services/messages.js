const starterConfigs = require('../config/starters');
const { getGuildByKey } = require('./guildService');

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildWelcomeMessage(player) {
  const starter = starterConfigs.find(item => item.key === player.pokemon_key);
  const guild = getGuildByKey(player.guild_key);

  const templates = [
    `🎉 **${player.discord_username}** ist Camp Indigo beigetreten!\nPartner-Pokémon: **${starter?.name ?? player.pokemon_key}**\nGilde: **${guild?.name ?? player.guild_key}** ${guild?.emoji ?? ''}`,
    `🏕 Ein neues Pokémon ist im Lager angekommen!\n**${player.discord_username}** startet als **${starter?.name ?? player.pokemon_key}** bei **${guild?.name ?? player.guild_key}** ${guild?.emoji ?? ''}.`,
    `✨ Das Lager wächst weiter: **${player.discord_username}** hat sich **${guild?.name ?? player.guild_key}** ${guild?.emoji ?? ''} angeschlossen.\nGewähltes Pokémon: **${starter?.name ?? player.pokemon_key}**`,
    `🔔 Neu im Camp: **${player.discord_username}**\nPokémon: **${starter?.name ?? player.pokemon_key}**\nGilde: **${guild?.name ?? player.guild_key}** ${guild?.emoji ?? ''}`
  ];

  return pickRandom(templates);
}

module.exports = { buildWelcomeMessage };
