const guildConfigs = require('../config/guilds');

async function ensureGuildRole(guild, guildKey) {
  const config = guildConfigs.find(item => item.key === guildKey);
  if (!config) {
    throw new Error(`Unbekannte Gilde: ${guildKey}`);
  }

  let role = guild.roles.cache.find(item => item.name === config.name);
  if (role) return role;

  role = await guild.roles.create({
    name: config.name,
    color: config.color,
    reason: `Camp Indigo Standardgilde ${config.name} anlegen`
  });

  return role;
}

module.exports = { ensureGuildRole };
