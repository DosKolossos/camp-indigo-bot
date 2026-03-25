const guildConfigs = require('../config/guilds');

function getGuildConfig(guildKey) {
  return guildConfigs.find(item => item.key === guildKey) || null;
}

function getGuildChatChannelId(guildKey) {
  const guild = getGuildConfig(guildKey);
  return guild?.chatChannelId || process.env.CHAT_CHANNEL_ID || null;
}

function getGuildProgressChannelId(guildKey) {
  const guild = getGuildConfig(guildKey);
  return guild?.progressChannelId || process.env.CAMP_STATUS_CHANNEL_ID || null;
}

async function fetchTextChannel(client, channelId) {
  if (!client || !channelId) {
    return null;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return null;
  }

  return channel;
}

async function fetchGuildChatChannel(client, guildKey) {
  return fetchTextChannel(client, getGuildChatChannelId(guildKey));
}

async function fetchGuildProgressChannel(client, guildKey) {
  return fetchTextChannel(client, getGuildProgressChannelId(guildKey));
}

module.exports = {
  getGuildConfig,
  getGuildChatChannelId,
  getGuildProgressChannelId,
  fetchTextChannel,
  fetchGuildChatChannel,
  fetchGuildProgressChannel
};
