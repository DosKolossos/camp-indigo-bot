const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
require('dotenv').config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error('DISCORD_TOKEN, DISCORD_CLIENT_ID oder DISCORD_GUILD_ID fehlt.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  const payload = [...client.commands.values()].map(command => command.data.toJSON());

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: payload });
  console.log('Slash-Commands registriert.');
}

client.once('clientReady', async readyClient => {
  console.log(`Eingeloggt als ${readyClient.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('camp:start:')) {
      const startCommand = client.commands.get('setup-start');
      if (!startCommand?.handleButton) return;
      await startCommand.handleButton(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'camp:start:starter-select') {
      const startCommand = client.commands.get('setup-start');
      if (!startCommand?.handleStringSelect) return;
      await startCommand.handleStringSelect(interaction);
    }
  } catch (error) {
    console.error('Interaktionsfehler:', error);

    if (interaction.isRepliable()) {
      const payload = { content: 'Beim Ausführen der Aktion ist ein Fehler aufgetreten.', ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
  }
});

client.login(token);
