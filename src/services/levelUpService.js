const { getPlayerByDiscordUserId, updatePlayerProgress } = require('./playerService');
const { buildLevelUpMessage } = require('./messages');

function getActionLevelUpText(previousPlayer, updatedPlayer) {
  if (!previousPlayer || !updatedPlayer) {
    return '';
  }

  if ((updatedPlayer.level || 1) <= (previousPlayer.level || 1)) {
    return '';
  }

  return `\n\n🎉 **Levelaufstieg!** Du bist jetzt Level **${updatedPlayer.level}**.`;
}

async function postLevelUpToChat(client, previousPlayer, updatedPlayer) {
  if (!client || !previousPlayer || !updatedPlayer) {
    return;
  }

  if ((updatedPlayer.level || 1) <= (previousPlayer.level || 1)) {
    return;
  }

  const chatChannelId = process.env.CHAT_CHANNEL_ID;
  if (!chatChannelId) {
    return;
  }

  const content = buildLevelUpMessage(updatedPlayer, previousPlayer.level);
  if (!content) {
    return;
  }

  try {
    const channel = await client.channels.fetch(chatChannelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      return;
    }

    await channel.send({ content }).catch(() => null);
  } catch (error) {
    console.error('Levelaufstieg konnte nicht im Chat gepostet werden:', error);
  }
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

  await postLevelUpToChat(client, previousPlayer, updatedPlayer);

  return {
    previousPlayer,
    updatedPlayer,
    leveledUp: Boolean(updatedPlayer && updatedPlayer.level > previousPlayer.level),
    levelUpText: getActionLevelUpText(previousPlayer, updatedPlayer)
  };
}

module.exports = {
  applyProgressWithLevelUpAnnouncement,
  postLevelUpToChat,
  getActionLevelUpText
};