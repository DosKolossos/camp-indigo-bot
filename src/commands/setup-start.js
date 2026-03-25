const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const { getState, setState } = require('../services/stateService');

function buildStartMessage() {
  const embed = new EmbedBuilder()
    .setTitle('🏕️ Willkommen in Camp Indigo')
    .setDescription(
      'Wähle dein Start-Pokémon, tritt einer Gilde bei und beginne dein Abenteuer.\n\n' +
      'Klicke unten auf **Abenteuer beginnen**.'
    )
    .setColor(0x5cb85c);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('camp:start')
      .setLabel('Abenteuer beginnen')
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

async function findExistingStartMessage(client) {
  const savedChannelId = getState('start_panel_channel_id');
  const savedMessageId = getState('start_panel_message_id');

  if (!savedChannelId || !savedMessageId) {
    return null;
  }

  const channel = await client.channels.fetch(savedChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return null;
  }

  const message = await channel.messages.fetch(savedMessageId).catch(() => null);
  if (!message) {
    return null;
  }

  return { channel, message };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-start')
    .setDescription('Postet oder aktualisiert die Startnachricht für Camp Indigo.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'Dafür brauchst du Admin-Rechte.',
        flags: MessageFlags.Ephemeral
      });
    }

    const targetChannelId = process.env.START_CHANNEL_ID || interaction.channelId;
    const targetChannel = await interaction.client.channels.fetch(targetChannelId).catch(() => null);

    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({
        content: 'Der Startkanal konnte nicht gefunden werden.',
        flags: MessageFlags.Ephemeral
      });
    }

    const payload = buildStartMessage();
    const existing = await findExistingStartMessage(interaction.client);

    let finalMessage;
    let infoText;

    if (existing) {
      const sameChannel = existing.channel.id === targetChannel.id;

      if (sameChannel) {
        finalMessage = await existing.message.edit(payload);
        infoText = `Startnachricht wurde in <#${targetChannel.id}> aktualisiert.`;
      } else {
        await existing.message.delete().catch(() => null);
        finalMessage = await targetChannel.send(payload);
        infoText = `Startnachricht wurde nach <#${targetChannel.id}> verschoben.`;
      }
    } else {
      finalMessage = await targetChannel.send(payload);
      infoText = `Startnachricht wurde in <#${targetChannel.id}> gepostet.`;
    }

    setState('start_panel_channel_id', targetChannel.id);
    setState('start_panel_message_id', finalMessage.id);

    return interaction.reply({
      content: infoText,
      flags: MessageFlags.Ephemeral
    });
  }
};