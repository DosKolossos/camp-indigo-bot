const { MessageFlags, PermissionFlagsBits } = require('discord.js');

async function ensureAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  await interaction.reply({
    content: 'Dafür fehlen dir die Rechte.',
    flags: MessageFlags.Ephemeral
  });
  return false;
}

module.exports = { ensureAdmin };
