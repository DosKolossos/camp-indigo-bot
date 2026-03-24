const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error('DISCORD_TOKEN, DISCORD_CLIENT_ID oder DISCORD_GUILD_ID fehlt.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Testet, ob der Bot online ist.')
    .toJSON()
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
  );
  console.log('Slash-Commands registriert.');
}

client.once('ready', async () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong! Camp Indigo lebt. 🏕️');
  }
});

client.login(token);