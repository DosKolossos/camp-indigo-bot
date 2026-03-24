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
const {
  XP_PER_LEVEL,
  getPlayerByDiscordUserId,
  updatePlayerProgress,
  getCampTotals
} = require('../services/playerService');

function getStarter(key) {
  return starters.find(item => item.key === key) || null;
}

function getGuild(key) {
  return guilds.find(item => item.key === key) || null;
}

function getXpProgressText(player) {
  const currentLevelXp = (player.level - 1) * XP_PER_LEVEL;
  const xpInLevel = player.xp - currentLevelXp;
  return `${xpInLevel}/${XP_PER_LEVEL} XP bis Level ${player.level + 1}`;
}

function buildBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('camp:actions:back')
      .setLabel('Zurück zum Aktionsmenü')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildActionMenu(player) {
  const starter = getStarter(player.pokemon_key);
  const guild = getGuild(player.guild_key);

  const embed = new EmbedBuilder()
    .setTitle('🎮 Deine Aktionen')
    .setDescription(
      `**Pokémon:** ${starter?.name ?? player.pokemon_key} ${starter?.emoji ?? ''}\n` +
      `**Gilde:** ${guild?.name ?? player.guild_key} ${guild?.emoji ?? ''}\n` +
      `**Level:** ${player.level}\n` +
      `**Fortschritt:** ${getXpProgressText(player)}\n\n` +
      'Wähle deine nächste Aktion.'
    )
    .setColor(guild?.color ?? 0x5865f2);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('camp:actions:menu')
    .setPlaceholder('Aktion auswählen')
    .addOptions([
      {
        label: 'Profil ansehen',
        description: 'Zeigt dein Pokémon, deine Gilde und deine Werte',
        value: 'profil',
        emoji: '📜'
      },
      {
        label: 'Sammeln',
        description: 'Sammle Holz, Nahrung, Stein und XP',
        value: 'sammeln',
        emoji: '🌿'
      },
      {
        label: 'Arbeiten',
        description: 'Hilf dem Lager beim Ausbau',
        value: 'arbeiten',
        emoji: '🔨'
      },
      {
        label: 'Lagerstatus',
        description: 'Zeigt den Fortschritt des gesamten Camps',
        value: 'lager',
        emoji: '🏕️'
      }
    ]);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral
  };
}

function buildProfilePayload(player) {
  const starter = getStarter(player.pokemon_key);
  const guild = getGuild(player.guild_key);

  const embed = new EmbedBuilder()
    .setTitle(`📜 Profil von ${player.discord_username}`)
    .setDescription(
      `**Pokémon:** ${starter?.name ?? player.pokemon_key} ${starter?.emoji ?? ''}\n` +
      `**Gilde:** ${guild?.name ?? player.guild_key} ${guild?.emoji ?? ''}\n\n` +
      `**Level:** ${player.level}\n` +
      `**XP gesamt:** ${player.xp}\n` +
      `**Fortschritt:** ${getXpProgressText(player)}\n\n` +
      `**🪵 Holz:** ${player.wood}\n` +
      `**🍖 Nahrung:** ${player.food}\n` +
      `**🪨 Stein:** ${player.stone}\n` +
      `**🏗️ Lagerbeitrag:** ${player.contribution}`
    )
    .setColor(guild?.color ?? 0x2ecc71);

  return {
    embeds: [embed],
    components: [buildBackRow()],
    flags: MessageFlags.Ephemeral
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildActionResultPayload({ title, description, color = 0x2ecc71 }) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
    ],
    components: [buildBackRow()],
    flags: MessageFlags.Ephemeral
  };
}

function runSammeln(player) {
  const wood = randomInt(1, 3);
  const food = randomInt(1, 2);
  const stone = randomInt(0, 2);
  const xp = randomInt(4, 6);

  const updatedPlayer = updatePlayerProgress(player.discord_user_id, { wood, food, stone, xp });
  const levelUpText = updatedPlayer && updatedPlayer.level > player.level
    ? `\n\n🎉 **Levelaufstieg!** Du bist jetzt Level **${updatedPlayer.level}**.`
    : '';

  return buildActionResultPayload({
    title: '🌿 Sammeln abgeschlossen',
    description:
      `Du warst für das Lager unterwegs.\n\n` +
      `+${wood} Holz\n` +
      `+${food} Nahrung\n` +
      `+${stone} Stein\n` +
      `+${xp} XP${levelUpText}`,
    color: 0x27ae60
  });
}

function runArbeiten(player) {
  const contribution = randomInt(2, 5);
  const wood = randomInt(0, 1);
  const stone = randomInt(0, 1);
  const xp = randomInt(3, 5);

  const updatedPlayer = updatePlayerProgress(player.discord_user_id, {
    contribution,
    wood,
    stone,
    xp
  });

  const levelUpText = updatedPlayer && updatedPlayer.level > player.level
    ? `\n\n🎉 **Levelaufstieg!** Du bist jetzt Level **${updatedPlayer.level}**.`
    : '';

  return buildActionResultPayload({
    title: '🔨 Arbeit im Lager erledigt',
    description:
      `Du hast beim Ausbau des Camps geholfen.\n\n` +
      `+${contribution} Lagerbeitrag\n` +
      `+${wood} Holz\n` +
      `+${stone} Stein\n` +
      `+${xp} XP${levelUpText}`,
    color: 0xe67e22
  });
}

function buildLagerPayload() {
  const totals = getCampTotals();

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('🏕️ Lagerstatus')
        .setDescription(
          `**Abenteurer:** ${totals.players}\n` +
          `**Gesamt-XP:** ${totals.xp}\n\n` +
          `**🪵 Holz:** ${totals.wood}\n` +
          `**🍖 Nahrung:** ${totals.food}\n` +
          `**🪨 Stein:** ${totals.stone}\n` +
          `**🏗️ Gesamtbeitrag:** ${totals.contribution}`
        )
        .setColor(0xf1c40f)
    ],
    components: [buildBackRow()],
    flags: MessageFlags.Ephemeral
  };
}

function buildMissingPlayerPayload() {
  return {
    content: 'Du hast noch kein Abenteuer begonnen. Nutze zuerst die Startnachricht.',
    flags: MessageFlags.Ephemeral
  };
}

module.exports = {
  canHandleInteraction(interaction) {
    return Boolean(
      interaction.customId &&
      (
        interaction.customId === 'camp:actions:open' ||
        interaction.customId === 'camp:actions:back' ||
        interaction.customId === 'camp:actions:menu'
      )
    );
  },

  async handleInteraction(interaction) {
    const player = getPlayerByDiscordUserId(interaction.user.id);

    if (!player) {
      const payload = buildMissingPlayerPayload();
      if (interaction.isButton()) {
        return interaction.reply(payload);
      }
      return interaction.update({ ...payload, components: [] });
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'camp:actions:open') {
        return interaction.reply(buildActionMenu(player));
      }

      if (interaction.customId === 'camp:actions:back') {
        return interaction.update(buildActionMenu(getPlayerByDiscordUserId(interaction.user.id)));
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'camp:actions:menu') {
      const action = interaction.values[0];
      const freshPlayer = getPlayerByDiscordUserId(interaction.user.id);

      if (action === 'profil') {
        return interaction.update(buildProfilePayload(freshPlayer));
      }

      if (action === 'sammeln') {
        return interaction.update(runSammeln(freshPlayer));
      }

      if (action === 'arbeiten') {
        return interaction.update(runArbeiten(freshPlayer));
      }

      if (action === 'lager') {
        return interaction.update(buildLagerPayload());
      }
    }

    return false;
  }
};
