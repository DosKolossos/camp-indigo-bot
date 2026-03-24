const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const { ensureAdmin } = require('../utils/admin');
const { getState, setState } = require('../services/stateService');

function buildActionsMessage() {
  const embed = new EmbedBuilder()
    .setTitle('⚔️ Camp-Aktionen')
    .setDescription(
      'Öffne dein Aktionsmenü und wähle, was dein Pokémon als Nächstes tun soll.\n\n' +
      'Dort findest du zuerst **Profil**, **Sammeln**, **Arbeiten** und den **Lagerstatus**.'
    )
    .setColor(0x3498db);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('camp:actions:open')
      .setLabel('Aktionen öffnen')
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-actions')
    .setDescription('Postet oder aktualisiert die Aktionsnachricht für Camp Indigo.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;

    const channelId = process.env.ACTION_CHANNEL_ID || process.env.CHAT_CHANNEL_ID || interaction.channelId;
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      return interaction.reply({
        content: 'Der Aktionskanal konnte nicht gefunden werden.',
        flags: MessageFlags.Ephemeral
      });
    }

    const existingMessageId = getState('actions_panel_message_id');
    const payload = buildActionsMessage();

    let message = null;

    if (existingMessageId) {
      message = await channel.messages.fetch(existingMessageId).catch(() => null);
      if (message) {
        await message.edit(payload);
      }
    }

    if (!message) {
      message = await channel.send(payload);
    }

    setState('actions_panel_channel_id', channel.id);
    setState('actions_panel_message_id', message.id);

    return interaction.reply({
      content: `Aktionsnachricht ist bereit in <#${channel.id}>.`,
      flags: MessageFlags.Ephemeral
    });
  }
};
