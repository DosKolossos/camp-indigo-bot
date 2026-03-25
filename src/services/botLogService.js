async function sendBotLog(client, content, options = {}) {
  const channelId = process.env.BOT_LOGS_CHANNEL_ID;
  if (!channelId || !client || !content) {
    return false;
  }

  const prefix = options.level === 'error'
    ? '🛑'
    : options.level === 'warn'
      ? '⚠️'
      : 'ℹ️';

  const message = `${prefix} ${content}`.slice(0, 1900);

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return false;
    }

    await channel.send({ content: message }).catch(() => null);
    return true;
  } catch (error) {
    console.error('BOT_LOGS_CHANNEL_ID konnte nicht beschrieben werden:', error);
    return false;
  }
}

module.exports = { sendBotLog };
