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

function buildActionsMessage() {
  const embed = new EmbedBuilder()
    .setTitle('⚔️ Camp-Aktionen')
    .setDescription(
      'Öffne dein Aktionsmenü und wähle, was dein Pokémon als Nächstes tun soll.\n\n' +
      'Dort findest du zuerst **Profil, Sammeln, Arbeiten** und den **Lagerstatus**.'
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

async function findExistingActionsMessage(client) {
  const savedChannelId = getState('actions_panel_channel_id');
  const savedMessageId = getState('actions_panel_message_id');

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


async function findPanelMessageByScan(channel) {
  if (!channel || !channel.isTextBased() || !channel.messages?.fetch) {
    return null;
  }

  const recentMessages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recentMessages) {
    return null;
  }

  for (const message of recentMessages.values()) {
    const firstEmbed = message.embeds?.[0];
    const button = message.components?.[0]?.components?.[0];

    if (
      message.author?.id === channel.client.user?.id &&
      firstEmbed?.title === '⚔️ Camp-Aktionen' &&
      button?.customId === 'camp:actions:open'
    ) {
      return { channel, message };
    }
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-actions')
    .setDescription('Postet oder aktualisiert die Aktionsnachricht für Camp Indigo.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'Dafür brauchst du Admin-Rechte.',
        flags: MessageFlags.Ephemeral
      });
    }

    const targetChannelId =
      process.env.ACTION_CHANNEL_ID ||
      process.env.CHAT_CHANNEL_ID ||
      interaction.channelId;

    const targetChannel = await interaction.client.channels.fetch(targetChannelId).catch(() => null);

    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({
        content: 'Der Aktionskanal konnte nicht gefunden werden.',
        flags: MessageFlags.Ephemeral
      });
    }

    const payload = buildActionsMessage();
    const existing =
      await findExistingActionsMessage(interaction.client) ||
      await findPanelMessageByScan(targetChannel);

    let finalMessage;
    let infoText;

    if (existing) {
      const sameChannel = existing.channel.id === targetChannel.id;

      if (sameChannel) {
        finalMessage = await existing.message.edit(payload);
        infoText = `Aktionsnachricht wurde in <#${targetChannel.id}> aktualisiert.`;
      } else {
        await existing.message.delete().catch(() => null);
        finalMessage = await targetChannel.send(payload);
        infoText = `Aktionsnachricht wurde nach <#${targetChannel.id}> verschoben.`;
      }
    } else {
      finalMessage = await targetChannel.send(payload);
      infoText = `Aktionsnachricht wurde in <#${targetChannel.id}> gepostet.`;
    }

    setState('actions_panel_channel_id', targetChannel.id);
    setState('actions_panel_message_id', finalMessage.id);

    return interaction.reply({
      content: infoText,
      flags: MessageFlags.Ephemeral
    });
  }
};