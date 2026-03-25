const { getGuildByKey } = require('./guildService');

async function ensureGuildRole(guild, guildKey) {
  const config = getGuildByKey(guildKey);
  if (!config) {
    throw new Error(`Unbekannte Gilde: ${guildKey}`);
  }

  let role = guild.roles.cache.find(item => item.name === config.roleName);
  if (role) return role;

  role = await guild.roles.create({
    name: config.roleName,
    color: config.color,
    mentionable: false,
    reason: `Camp Indigo Gildenrolle für ${config.name}`
  });

  return role;
}

module.exports = { ensureGuildRole };
