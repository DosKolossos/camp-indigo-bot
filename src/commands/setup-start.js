const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-start')
    .setDescription('Postet die Startnachricht für Camp Indigo.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'Dafür brauchst du Admin-Rechte.',
        flags: MessageFlags.Ephemeral
      });
    }

    const targetChannelId = process.env.START_CHANNEL_ID || interaction.channelId;
    const targetChannel = await interaction.client.channels.fetch(targetChannelId);

    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({
        content: 'Der Startkanal konnte nicht gefunden werden.',
        flags: MessageFlags.Ephemeral
      });
    }

    await targetChannel.send(buildStartMessage());

    return interaction.reply({
      content: `Startnachricht wurde in <#${targetChannel.id}> gepostet.`,
      flags: MessageFlags.Ephemeral
    });
  }
};