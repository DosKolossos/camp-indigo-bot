const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureCampStatusMessage } = require('../services/campStatusService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-camp')
    .setDescription('Postet oder aktualisiert die feste Camp-Fortschrittsnachricht.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'Dafür brauchst du Admin-Rechte.',
        flags: MessageFlags.Ephemeral
      });
    }

    const targetChannelId =
      process.env.CAMP_STATUS_CHANNEL_ID ||
      process.env.CHAT_CHANNEL_ID ||
      interaction.channelId;

    await ensureCampStatusMessage(interaction.client, targetChannelId);

    return interaction.reply({
      content: `Camp-Fortschritt wurde in <#${targetChannelId}> erstellt oder aktualisiert.`,
      flags: MessageFlags.Ephemeral
    });
  }
};
