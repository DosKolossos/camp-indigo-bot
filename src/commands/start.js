const {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} = require('discord.js');
const starters = require('../config/starters');
const guilds = require('../config/guilds');
const { ensureAdmin } = require('../utils/admin');
const { getPlayerByDiscordUserId, createPlayer } = require('../services/playerService');
const { ensureGuildRole } = require('../services/guildRoleService');
const { buildWelcomeMessage } = require('../services/messages');
const { getState, setState } = require('../services/stateService');

function starterSelectMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('camp:start:starter-select')
      .setPlaceholder('Wähle dein Start-Pokémon')
      .addOptions(
        starters.map(starter => ({
          label: starter.name,
          value: starter.key,
          description: starter.style.slice(0, 100),
          emoji: starter.emoji
        }))
      )
  );
}

function buildStartPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🏕️ Willkommen in Camp Indigo')
    .setDescription(
      'Du bist kein Trainer — du **bist selbst ein Pokémon**.\n\n' +
      'Wähle dein Start-Pokémon, tritt einer Gilde bei und hilf mit, aus einem kleinen Lager etwas Großes zu bauen.\n\n' +
      'Klicke auf **Abenteuer beginnen**, um dein Abenteuer zu starten.'
    )
    .addFields(
      { name: '🔹 Gilden', value: guilds.map(g => `${g.emoji} **${g.name}**`).join('\n'), inline: true },
      { name: '🔸 Start-Pokémon', value: `${starters.length} auswählbar`, inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('camp:start:begin')
      .setLabel('Abenteuer beginnen')
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

function buildStarterEmbed(starterKey) {
  const starter = starters.find(item => item.key === starterKey) || starters[0];

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${starter.emoji} ${starter.name}`)
    .setDescription(`${starter.style}\n\n**Fähigkeit:** ${starter.ability}`)
    .addFields(
      {
        name: 'Startwerte',
        value:
          `Kraft: **${starter.stats.kraft}**\n` +
          `Tempo: **${starter.stats.tempo}**\n` +
          `Ausdauer: **${starter.stats.ausdauer}**\n` +
          `Instinkt: **${starter.stats.instinkt}**\n` +
          `Geschick: **${starter.stats.geschick}**`
      },
      {
        name: 'Nächster Schritt',
        value: 'Wenn dir dein Pokémon gefällt, wähle jetzt deine Gilde.'
      }
    );

  if (starter.imageUrl) embed.setImage(starter.imageUrl);

  return embed;
}

function buildGuildChoiceRows(starterKey) {
  const firstRow = new ActionRowBuilder();
  const secondRow = new ActionRowBuilder();

  guilds.forEach((guildConfig, index) => {
    const button = new ButtonBuilder()
      .setCustomId(`camp:start:join-guild:${guildConfig.key}:${starterKey}`)
      .setLabel(guildConfig.name)
      .setEmoji(guildConfig.emoji)
      .setStyle(index === 0 ? ButtonStyle.Primary : index === 1 ? ButtonStyle.Danger : ButtonStyle.Secondary);

    if (index < 3) {
      firstRow.addComponents(button);
    } else {
      secondRow.addComponents(button);
    }
  });

  return secondRow.components.length ? [firstRow, secondRow] : [firstRow];
}

function buildGuildChoiceEmbed(starterKey) {
  const starter = starters.find(item => item.key === starterKey);

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🛡️ Wähle deine Gilde')
    .setDescription(
      `Dein gewähltes Pokémon: **${starter?.name ?? starterKey}** ${starter?.emoji ?? ''}\n\n` +
      guilds.map(item => `${item.emoji} **${item.name}** — ${item.description}`).join('\n\n')
    );

  return embed;
}

function buildExistingProfileEmbed(player) {
  const starter = starters.find(item => item.key === player.pokemon_key);
  const guild = guilds.find(item => item.key === player.guild_key);

  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🏕️ Dein Abenteuer läuft bereits')
    .setDescription(
      `Du bist bereits Teil von Camp Indigo.\n\n` +
      `**Pokémon:** ${starter?.name ?? player.pokemon_key} ${starter?.emoji ?? ''}\n` +
      `**Gilde:** ${guild?.name ?? player.guild_key} ${guild?.emoji ?? ''}\n` +
      `**Level:** ${player.level}`
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-start')
    .setDescription('Postet oder aktualisiert die Startnachricht in #start.'),

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;

    const channelId = process.env.START_CHANNEL_ID || interaction.channelId;
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      return interaction.reply({
        content: 'Der Zielkanal konnte nicht geladen werden.',
        flags: MessageFlags.Ephemeral
      });
    }

    const existingMessageId = getState('start_panel_message_id');
    const payload = buildStartPanel();

    let message = null;

    if (existingMessageId) {
      message = await channel.messages.fetch(existingMessageId).catch(() => null);
      if (message) {
        await message.edit(payload);
      }
    }

    if (!message) {
      message = await channel.send(payload);
      setState('start_panel_channel_id', channel.id);
      setState('start_panel_message_id', message.id);
    }

    return interaction.reply({
      content: `Startnachricht ist bereit in <#${channel.id}>.`,
      flags: MessageFlags.Ephemeral
    });
  },

  async handleButton(interaction) {
    const player = getPlayerByDiscordUserId(interaction.user.id);
    if (player) {
      return interaction.reply({
        embeds: [buildExistingProfileEmbed(player)],
        flags: MessageFlags.Ephemeral
      });
    }

    const [, , action, guildKey, starterKey] = interaction.customId.split(':');

    if (action === 'begin') {
      return interaction.reply({
        embeds: [buildStarterEmbed(starters[0].key)],
        components: [starterSelectMenu()],
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'join-guild') {
      const starter = starters.find(item => item.key === starterKey);
      const guildConfig = guilds.find(item => item.key === guildKey);
      if (!starter || !guildConfig) {
        return interaction.reply({
          content: 'Starter oder Gilde konnte nicht gefunden werden.',
          flags: MessageFlags.Ephemeral
        });
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const role = await ensureGuildRole(interaction.guild, guildKey);
      await member.roles.add(role);

      const createdPlayer = createPlayer({
        discordUserId: interaction.user.id,
        discordUsername: interaction.user.globalName || interaction.user.username,
        pokemonKey: starter.key,
        guildKey: guildConfig.key,
        guildRoleId: role.id
      });

      const chatChannelId = process.env.CHAT_CHANNEL_ID;
      if (chatChannelId) {
        const chatChannel = await interaction.client.channels.fetch(chatChannelId).catch(() => null);
        if (chatChannel && chatChannel.isTextBased()) {
          await chatChannel.send(buildWelcomeMessage(createdPlayer)).catch(() => null);
        }
      }

      return interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(guildConfig.color)
            .setTitle('✨ Willkommen in Camp Indigo')
            .setDescription(
              `Du startest als **${starter.name}** ${starter.emoji}\n` +
              `Gilde: **${guildConfig.name}** ${guildConfig.emoji}\n\n` +
              'Dein Profil wurde angelegt. Das Lager wartet auf deinen ersten Beitrag.'
            )
        ],
        components: []
      });
    }
  },

  async handleStringSelect(interaction) {
    const starterKey = interaction.values[0];

    return interaction.update({
      embeds: [buildStarterEmbed(starterKey), buildGuildChoiceEmbed(starterKey)],
      components: buildGuildChoiceRows(starterKey)
    });
  }
};
