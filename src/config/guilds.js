module.exports = [
  {
    key: 'nimbus',
    name: 'Nimbus',
    emoji: '🔵',
    description: 'Wissen, Ruhe und Planung.',
    color: 0x4f86f7,
    roleName: 'Nimbus',
    chatChannelId: process.env.NIMBUS_CHAT_CHANNEL_ID || null,
    progressChannelId: process.env.NIMBUS_PROGRESS_CHANNEL_ID || null
  },
  {
    key: 'ember',
    name: 'Ember',
    emoji: '🔴',
    description: 'Mut, Stärke und Ehrgeiz.',
    color: 0xf25f5c,
    roleName: 'Ember',
    chatChannelId: process.env.EMBER_CHAT_CHANNEL_ID || null,
    progressChannelId: process.env.EMBER_PROGRESS_CHANNEL_ID || null
  },
  {
    key: 'volt',
    name: 'Volt',
    emoji: '🟡',
    description: 'Instinkt, Tempo und Anpassung.',
    color: 0xf7d154,
    roleName: 'Volt',
    chatChannelId: process.env.VOLT_CHAT_CHANNEL_ID || null,
    progressChannelId: process.env.VOLT_PROGRESS_CHANNEL_ID || null
  }
];
