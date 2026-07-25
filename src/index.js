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
const { sendBotLog } = require('./services/botLogService');
const { processBossSchedulerTick } = require('./services/bossService');
const { syncCampStatusMessage } = require('./services/campStatusService');
const {
  syncAllDiscordMembers,
  updatePlayerFromMember,
  touchPlayerFromInteraction
} = require('./services/memberSyncService');

function envFlag(name, fallback = false) {
  const value = String(process.env[name] ?? fallback).toLowerCase().trim();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

const ENABLE_ADMIN_WEB = envFlag('ADMIN_WEB_ENABLED', true);
const ENABLE_DISCORD_BOT = envFlag('ENABLE_DISCORD_BOT', true);
const MEMBER_SYNC_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

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

  let bossTickTimer = null;
  let memberSyncTimer = null;

  async function refreshChangedCampStatuses(guildKeys = []) {
    for (const guildKey of guildKeys) {
      if (!guildKey) continue;
      await syncCampStatusMessage(client, guildKey);
    }
  }

  client.once('clientReady', async () => {
    console.log(`Eingeloggt als ${client.user.tag}`);
    await registerCommands();

    try {
      const memberSync = await syncAllDiscordMembers(client);
      console.log(`[members] ${memberSync.checked} Spielstände geprüft: ${memberSync.active} aktiv, ${memberSync.inactive} inaktiv, ${memberSync.changed} geändert.`);
      await refreshChangedCampStatuses(memberSync.changedGuildKeys);
    } catch (error) {
      console.error('Spieler-Synchronisierung beim Start fehlgeschlagen:', error);
    }

    await sendBotLog(
      client,
      `Bot online als **${client.user.tag}**. Start-, Aktions- und Gildenkanäle sind aktiv.`,
      { level: 'info' }
    );

    const runBossTick = async () => {
      try {
        await processBossSchedulerTick(client);
      } catch (error) {
        console.error('Boss-Scheduler Fehler:', error);
      }
    };

    await runBossTick();

    if (bossTickTimer) {
      clearInterval(bossTickTimer);
    }

    bossTickTimer = setInterval(runBossTick, 30 * 1000);

    if (memberSyncTimer) {
      clearInterval(memberSyncTimer);
    }

    memberSyncTimer = setInterval(async () => {
      try {
        const memberSync = await syncAllDiscordMembers(client);
        if (memberSync.changed > 0) {
          console.log(`[members] ${memberSync.changed} Mitgliedsstatus geändert.`);
          await refreshChangedCampStatuses(memberSync.changedGuildKeys);
        }
      } catch (error) {
        console.error('Regelmäßige Spieler-Synchronisierung fehlgeschlagen:', error);
      }
    }, MEMBER_SYNC_INTERVAL_MS);
  });

  client.on('guildMemberRemove', async member => {
    if (member.guild.id !== process.env.DISCORD_GUILD_ID) return;

    const result = updatePlayerFromMember(member, false);
    if (!result?.player) return;

    console.log(`[members] ${result.player.discord_username} wurde deaktiviert (Server verlassen).`);
    await refreshChangedCampStatuses([result.guildKey]);
  });

  client.on('guildMemberAdd', async member => {
    if (member.guild.id !== process.env.DISCORD_GUILD_ID) return;

    const result = updatePlayerFromMember(member, true);
    if (!result?.player) return;

    console.log(`[members] ${result.player.discord_username} wurde reaktiviert (Server beigetreten).`);
    await refreshChangedCampStatuses([result.guildKey]);
  });

  client.on('interactionCreate', async interaction => {
    try {
      const memberTouch = touchPlayerFromInteraction(interaction);
      if (memberTouch?.changed) {
        await refreshChangedCampStatuses([memberTouch.guildKey]);
      }

      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      if (
        interaction.isButton() ||
        interaction.isStringSelectMenu() ||
        interaction.isUserSelectMenu() ||
        interaction.isModalSubmit()
      ) {
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
      const errorCode =
        error?.code ??
        error?.rawError?.code ??
        error?.data?.code ??
        null;

      if (errorCode === 10062) {
        console.warn('Interaction war bereits abgelaufen oder wurde schon beantwortet (10062).');
        return;
      }

      if (errorCode === 40060) {
        console.warn('Interaction wurde bereits beantwortet (40060).');
        return;
      }

      console.error(error);
      await sendBotLog(
        client,
        `Interaction-Fehler: **${interaction.customId || interaction.commandName || 'unbekannt'}** → ${String(error?.message || error).slice(0, 1200)}`,
        { level: 'error' }
      );

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

// moini?