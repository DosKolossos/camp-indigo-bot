const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Testet, ob Camp Indigo online ist.'),

  async execute(interaction) {
    await interaction.reply('Pong! Camp Indigo lebt. 🏕️');
  }
};
