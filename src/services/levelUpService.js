const { getPlayerByDiscordUserId, updatePlayerProgress } = require('./playerService');
const { buildLevelUpMessage } = require('./messages');
const { fetchGuildChatChannel } = require('./channelService');

function getActionLevelUpText(previousPlayer, updatedPlayer) {
  if (!previousPlayer || !updatedPlayer) {
    return '';
  }

  if ((updatedPlayer.level || 1) <= (previousPlayer.level || 1)) {
    return '';
  }

  return `\n\n🎉 **Levelaufstieg!** Du bist jetzt Level **${updatedPlayer.level}**.`;
}

async function postLevelUpToGuildChat(client, previousPlayer, updatedPlayer) {
  if (!client || !previousPlayer || !updatedPlayer) {
    return;
  }

  if ((updatedPlayer.level || 1) <= (previousPlayer.level || 1)) {
    return;
  }

  const content = buildLevelUpMessage(updatedPlayer, previousPlayer.level);
  if (!content) {
    return;
  }

  const channel = await fetchGuildChatChannel(client, updatedPlayer.guild_key).catch(() => null);
  if (!channel) {
    return;
  }

  await channel.send({ content }).catch(() => null);
}

async function applyProgressWithLevelUpAnnouncement({ client, discordUserId, changes }) {
  const previousPlayer = getPlayerByDiscordUserId(discordUserId);
  if (!previousPlayer) {
    return {
      previousPlayer: null,
      updatedPlayer: null,
      leveledUp: false,
      levelUpText: ''
    };
  }

  const updatedPlayer = updatePlayerProgress(discordUserId, changes);

  await postLevelUpToGuildChat(client, previousPlayer, updatedPlayer);

  return {
    previousPlayer,
    updatedPlayer,
    leveledUp: Boolean(updatedPlayer && updatedPlayer.level > previousPlayer.level),
    levelUpText: getActionLevelUpText(previousPlayer, updatedPlayer)
  };
}

module.exports = {
  applyProgressWithLevelUpAnnouncement,
  postLevelUpToGuildChat,
  getActionLevelUpText
};
