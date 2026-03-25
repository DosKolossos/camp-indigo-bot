require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Collection,
  MessageFlags
} = require('discord.js');

const pingCommand = require('./commands/ping');
const setupStartCommand = require('./commands/setup-start');
const setupActionsCommand = require('./commands/setup-actions');
const startFlow = require('./interactions/startFlow');
const actionFlow = require('./interactions/actionFlow');
const { startAdminServer } = require('./web/adminServer');

function envFlag(name, fallback = false) {
  const value = String(process.env[name] ?? fallback).toLowerCase().trim();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

const ENABLE_ADMIN_WEB = envFlag('ADMIN_WEB_ENABLED', true);
const ENABLE_DISCORD_BOT = envFlag('ENABLE_DISCORD_BOT', true);

if (ENABLE_ADMIN_WEB) {
  startAdminServer();
} else {
  console.log('Admin-Webinterface deaktiviert (ADMIN_WEB_ENABLED=false).');
}

if (!ENABLE_DISCORD_BOT) {
  console.log('Discord-Bot deaktiviert (ENABLE_DISCORD_BOT=false).');
} else {
  if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN fehlt, obwohl ENABLE_DISCORD_BOT=true gesetzt ist.');
    process.exit(1);
  }

  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_GUILD_ID) {
    console.error('DISCORD_CLIENT_ID oder DISCORD_GUILD_ID fehlt.');
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  client.commands = new Collection();
  client.commands.set(pingCommand.data.name, pingCommand);
  client.commands.set(setupStartCommand.data.name, setupStartCommand);
  client.commands.set(setupActionsCommand.data.name, setupActionsCommand);

  async function registerCommands() {
    const commands = [
      pingCommand.data.toJSON(),
      setupStartCommand.data.toJSON(),
      setupActionsCommand.data.toJSON()
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID
      ),
      { body: commands }
    );

    console.log('Slash-Commands registriert.');
  }

  client.once('clientReady', async () => {
    console.log(`Eingeloggt als ${client.user.tag}`);
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

      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        if (startFlow.canHandleInteraction(interaction)) {
          const handled = await startFlow.handleInteraction(interaction);
          if (handled !== false) return;
        }

        if (actionFlow.canHandleInteraction(interaction)) {
          const handled = await actionFlow.handleInteraction(interaction);
          if (handled !== false) return;
        }
      }
    } catch (error) {
      console.error(error);

      const payload = {
        content: 'Beim Ausführen der Aktion ist ein Fehler aufgetreten.',
        flags: MessageFlags.Ephemeral
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => null);
      } else if (interaction.isRepliable()) {
        await interaction.reply(payload).catch(() => null);
      }
    }
  });

  client.login(process.env.DISCORD_TOKEN);
}