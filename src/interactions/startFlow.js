const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const { syncCampStatusMessage } = require('../services/campStatusService')

const starters = require('../config/starters');
const guilds = require('../config/guilds');
const {
  getPlayerByDiscordUserId,
  createPlayer
} = require('../services/playerService');
const { ensureGuildRole } = require('../services/guildRoleService');
const { buildWelcomeMessage } = require('../services/messages');
const { fetchGuildChatChannel } = require('../services/channelService');
const { sendBotLog } = require('../services/botLogService');

function getStarter(key) {
  return starters.find(starter => starter.key === key) || starters[0];
}

function getGuild(key) {
  return guilds.find(guild => guild.key === key) || guilds[0];
}

function buildStatsText(stats) {
  return [
    `**Kraft:** ${stats.kraft}`,
    `**Tempo:** ${stats.tempo}`,
    `**Ausdauer:** ${stats.ausdauer}`,
    `**Instinkt:** ${stats.instinkt}`,
    `**Geschick:** ${stats.geschick}`
  ].join('\n');
}

function buildExistingProfilePayload(player) {
  const starter = getStarter(player.pokemon_key);
  const guild = getGuild(player.guild_key);

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('🏕️ Dein Abenteuer läuft bereits')
        .setDescription(
          `**Pokémon:** ${starter.name} ${starter.emoji}\n` +
          `**Gilde:** ${guild.name} ${guild.emoji}\n` +
          `**Level:** ${player.level}\n` +
          `**XP:** ${player.xp}`
        )
        .setColor(guild.color)
    ],
    components: [],
    flags: MessageFlags.Ephemeral
  };
}

function buildStarterPayload(selectedKey) {
  const starter = getStarter(selectedKey);
  const embed = new EmbedBuilder()
    .setTitle(`${starter.emoji} ${starter.name}`)
    .setDescription(
      `**Stil:** ${starter.style}\n` +
      `**Fähigkeit:** ${starter.ability}\n\n` +
      `${buildStatsText(starter.stats)}`
    )
    .setImage(starter.imageUrl)
    .setColor(0x6c5ce7);

  const starterSelect = new StringSelectMenuBuilder()
    .setCustomId('camp:starter:select')
    .setPlaceholder('Pokémon anschauen')
    .addOptions(
      starters.map(item => ({
        label: item.name,
        description: item.style.slice(0, 100),
        value: item.key,
        default: item.key === starter.key
      }))
    );

  const row1 = new ActionRowBuilder().addComponents(starterSelect);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`camp:starter:confirm:${starter.key}`)
      .setLabel(`${starter.name} wählen`)
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [row1, row2],
    flags: MessageFlags.Ephemeral
  };
}

function buildGuildPayload(starterKey, guildKey) {
  const starter = getStarter(starterKey);
  const guild = getGuild(guildKey);

  const embed = new EmbedBuilder()
    .setTitle(`🏳️ Gilde wählen – ${guild.emoji} ${guild.name}`)
    .setDescription(
      `**Dein Pokémon:** ${starter.name}\n\n` +
      `**Gilde:** ${guild.name}\n` +
      `${guild.description}`
    )
    .setImage(starter.imageUrl)
    .setColor(guild.color);

  const guildSelect = new StringSelectMenuBuilder()
    .setCustomId(`camp:guild:select:${starter.key}`)
    .setPlaceholder('Gilde anschauen')
    .addOptions(
      guilds.map(item => ({
        label: item.name,
        description: item.description.slice(0, 100),
        value: item.key,
        default: item.key === guild.key
      }))
    );

  const row1 = new ActionRowBuilder().addComponents(guildSelect);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`camp:guild:confirm:${starter.key}:${guild.key}`)
      .setLabel(`${guild.name} beitreten`)
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [embed],
    components: [row1, row2],
    flags: MessageFlags.Ephemeral
  };
}

async function assignGuildRole(interaction, guildConfig) {
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const rolesToRemove = guilds
    .map(item => interaction.guild.roles.cache.find(role => role.name === item.roleName))
    .filter(Boolean);

  if (rolesToRemove.length > 0) {
    await member.roles.remove(rolesToRemove).catch(() => null);
  }

  const targetRole = await ensureGuildRole(interaction.guild, guildConfig.key);
  await member.roles.add(targetRole);
  return targetRole;
}

module.exports = {
  canHandleInteraction(interaction) {
    return Boolean(interaction.customId && interaction.customId.startsWith('camp:'));
  },

  async handleInteraction(interaction) {
    if (interaction.isButton()) {
      if (interaction.customId === 'camp:start') {
        const existingPlayer = getPlayerByDiscordUserId(interaction.user.id);
        if (existingPlayer) {
          return interaction.reply(buildExistingProfilePayload(existingPlayer));
        }

        return interaction.reply(buildStarterPayload(starters[0].key));
      }

      if (interaction.customId.startsWith('camp:starter:confirm:')) {
        const starterKey = interaction.customId.split(':')[3];
        return interaction.update(buildGuildPayload(starterKey, guilds[0].key));
      }

      if (interaction.customId.startsWith('camp:guild:confirm:')) {
        const existingPlayer = getPlayerByDiscordUserId(interaction.user.id);
        if (existingPlayer) {
          return interaction.update(buildExistingProfilePayload(existingPlayer));
        }

        const [, , , starterKey, guildKey] = interaction.customId.split(':');
        const starter = getStarter(starterKey);
        const guild = getGuild(guildKey);
        const role = await assignGuildRole(interaction, guild);

        const player = createPlayer({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.globalName || interaction.user.username,
          pokemonKey: starter.key,
          guildKey: guild.key,
          guildRoleId: role?.id ?? null
        });

        await syncCampStatusMessage(interaction.client, guild.key).catch(() => null);
        
        const chatChannel = await fetchGuildChatChannel(interaction.client, guild.key).catch(() => null);
        if (chatChannel) {
          await chatChannel.send({ content: buildWelcomeMessage(player) }).catch(() => null);
        } else {
          console.warn(`Kein Gilden-Chat für ${guild.key} gefunden.`);
          await sendBotLog(
            interaction.client,
            `Kein Chatkanal für Gilde **${guild.name}** gefunden. Bitte ENV prüfen.`,
            { level: 'warn' }
          );
        }

        await sendBotLog(
          interaction.client,
          `Neuer Abenteuerstart: **${player.discord_username}** → **${starter.name}** bei **${guild.name}**.`,
          { level: 'info' }
        );

        return interaction.update({
          content:
            `✅ Willkommen in **Camp Indigo**!\n` +
            `Dein Pokémon: **${starter.name}**\n` +
            `Deine Gilde: **${guild.name}** ${guild.emoji}\n\n` +
            'Nutze jetzt die Aktionsnachricht im Chat, um deine ersten Aufgaben zu erledigen.',
          embeds: [],
          components: [],
          files: []
        });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'camp:starter:select') {
        return interaction.update(buildStarterPayload(interaction.values[0]));
      }

      if (interaction.customId.startsWith('camp:guild:select:')) {
        const starterKey = interaction.customId.split(':')[3];
        return interaction.update(buildGuildPayload(starterKey, interaction.values[0]));
      }
    }

    return false;
  }
};
