const {
  allPlayers,
  getPlayerByDiscordUserId,
  setPlayerMembershipStatus
} = require('./playerService');

function getDiscordServerId() {
  return String(process.env.DISCORD_GUILD_ID || '').trim();
}

function getMemberUsername(member) {
  return member?.user?.globalName || member?.displayName || member?.user?.username || null;
}

function updatePlayerFromMember(member, isActive) {
  if (!member?.user?.id || member.user.bot) return null;

  const existing = getPlayerByDiscordUserId(member.user.id);
  if (!existing) return null;

  const beforeActive = Number(existing.is_active) === 1;
  const username = isActive ? getMemberUsername(member) : null;
  const updated = setPlayerMembershipStatus(member.user.id, {
    isActive,
    discordUsername: username
  });

  return {
    player: updated,
    changed: beforeActive !== Boolean(isActive),
    guildKey: updated?.guild_key || existing.guild_key
  };
}

function touchPlayerFromInteraction(interaction) {
  const user = interaction?.user;
  if (!user?.id || user.bot) return null;

  const existing = getPlayerByDiscordUserId(user.id);
  if (!existing) return null;

  const username = user.globalName || interaction?.member?.displayName || user.username || existing.discord_username;
  const beforeActive = Number(existing.is_active) === 1;
  const updated = setPlayerMembershipStatus(user.id, {
    isActive: true,
    discordUsername: username
  });

  return {
    player: updated,
    changed: !beforeActive,
    guildKey: updated?.guild_key || existing.guild_key
  };
}

async function syncAllDiscordMembers(client) {
  const guildId = getDiscordServerId();
  if (!guildId) {
    throw new Error('DISCORD_GUILD_ID fehlt für die Spieler-Synchronisierung.');
  }

  const guild = await client.guilds.fetch(guildId);
  const members = await guild.members.fetch();
  const players = allPlayers(null, { includeInactive: true });
  const changedGuildKeys = new Set();
  let active = 0;
  let inactive = 0;
  let changed = 0;

  for (const player of players) {
    const member = members.get(player.discord_user_id) || null;
    const isActive = Boolean(member && !member.user?.bot);
    const beforeActive = Number(player.is_active) === 1;

    setPlayerMembershipStatus(player.discord_user_id, {
      isActive,
      discordUsername: isActive ? getMemberUsername(member) : null
    });

    if (isActive) active += 1;
    else inactive += 1;

    if (beforeActive !== isActive) {
      changed += 1;
      changedGuildKeys.add(player.guild_key);
    }
  }

  return {
    checked: players.length,
    active,
    inactive,
    changed,
    changedGuildKeys: [...changedGuildKeys]
  };
}

module.exports = {
  syncAllDiscordMembers,
  updatePlayerFromMember,
  touchPlayerFromInteraction
};
