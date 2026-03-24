const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');

const starters = require('../config/starters');
const guilds = require('../config/guilds');
const { upsertPlayer } = require('../services/playerStore');

function getStarter(key) {
    return starters.find(starter => starter.key === key) || starters[0];
}

function getGuild(key) {
    return guilds.find(guild => guild.key === key) || guilds[0];
}

function starterImagePath(starter) {
    return path.resolve(__dirname, '..', 'assets', 'pokemon', starter.imageUrl);
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
        .setThumbnail(`attachment://${starter.imageUrl}`)
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

function buildWelcomeMessage(username, starter, guild) {
    const variants = [
        `🎉 **@${username}** ist dem Lager beigetreten!\nPartner-Pokémon: **${starter.name}**\nGilde: **@${guild.name}** ${guild.emoji}`,
        `🏕️ Ein neues Pokémon ist angekommen!\n**@${username}** startet als **${starter.name}** bei **@${guild.name}** ${guild.emoji}.`,
        `✨ Das Lager wächst weiter: **@${username}** hat sich **@${guild.name}** angeschlossen.\nGewähltes Pokémon: **${starter.name}**`
    ];
    return variants[Math.floor(Math.random() * variants.length)];
}

async function ensureGuildRole(guild, guildConfig) {
    let role = guild.roles.cache.find(item => item.name === guildConfig.roleName);

    if (!role) {
        role = await guild.roles.create({
            name: guildConfig.roleName,
            color: guildConfig.color,
            reason: `Camp Indigo Standardgilde ${guildConfig.name}`
        });
    }

    return role;
}

async function assignGuildRole(interaction, guildConfig) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const rolesToRemove = guilds.map(item => item.roleName)
        .map(roleName => interaction.guild.roles.cache.find(role => role.name === roleName))
        .filter(Boolean);

    if (rolesToRemove.length > 0) {
        await member.roles.remove(rolesToRemove).catch(() => null);
    }

    const targetRole = await ensureGuildRole(interaction.guild, guildConfig);
    await member.roles.add(targetRole);
}

module.exports = {
    canHandleInteraction(interaction) {
        return Boolean(interaction.customId && interaction.customId.startsWith('camp:'));
    },

    async handleInteraction(interaction) {
        if (interaction.isButton()) {
            if (interaction.customId === 'camp:start') {
                return interaction.reply(buildStarterPayload(starters[0].key));
            }

            if (interaction.customId.startsWith('camp:starter:confirm:')) {
                const starterKey = interaction.customId.split(':')[3];
                return interaction.update(buildGuildPayload(starterKey, guilds[0].key));
            }

            if (interaction.customId.startsWith('camp:guild:confirm:')) {
                const [, , , starterKey, guildKey] = interaction.customId.split(':');
                const starter = getStarter(starterKey);
                const guild = getGuild(guildKey);

                upsertPlayer({
                    discordUserId: interaction.user.id,
                    username: interaction.user.username,
                    starterKey: starter.key,
                    guildKey: guild.key,
                    joinedAt: new Date().toISOString()
                });

                await assignGuildRole(interaction, guild);

                const chatChannelId = process.env.CHAT_CHANNEL_ID;

                if (!chatChannelId) {
                    console.warn('CHAT_CHANNEL_ID ist nicht gesetzt.');
                } else {
                    const chatChannel = await interaction.client.channels.fetch(chatChannelId).catch(error => {
                        console.error('CHAT_CHANNEL_ID konnte nicht geladen werden:', chatChannelId, error);
                        return null;
                    });

                    if (!chatChannel) {
                        console.warn(`Chat-Channel nicht gefunden: ${chatChannelId}`);
                    } else if (!chatChannel.isTextBased()) {
                        console.warn(`Channel ist nicht textbasiert: ${chatChannelId}`);
                    } else {
                        await chatChannel.send(
                            buildWelcomeMessage(interaction.user.id, starter, guild)
                        );
                    }
                }

                return interaction.update({
                    content:
                        `✅ Willkommen in **Camp Indigo**!\n` +
                        `Dein Pokémon: **${starter.name}**\n` +
                        `Deine Gilde: **${guild.name}** ${guild.emoji}`,

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