const { getGuildByKey } = require('./guildService');

async function ensureGuildRole(guild, guildKey) {
  const config = getGuildByKey(guildKey);
  if (!config) {
    throw new Error(`Unbekannte Gilde: ${guildKey}`);
  }

  const roleName = config.roleName || config.name;

  let role = guild.roles.cache.find(item => item.name === roleName);
  if (role) return role;

  role = await guild.roles.create({
    name: roleName,
    color: config.color,
    reason: `Camp Indigo Gildenrolle ${config.name} anlegen`
  });

  return role;
}

module.exports = { ensureGuildRole };