# Camp Indigo Bot – Startflow V1

Enthalten:
- `/ping`
- `/setup-start`
- Startnachricht mit Button **Abenteuer beginnen**
- ephemerale Starterwahl
- ephemerale Gildenwahl
- Spielerprofil in SQLite
- automatische Gildenrollen-Anlage (`Nimbus`, `Ember`, `Volt`)
- Willkommensnachricht im Chat

## Environment Variables

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
CHAT_CHANNEL_ID=
START_CHANNEL_ID=
```

`START_CHANNEL_ID` ist optional. Wenn leer, postet `/setup-start` in den Kanal, in dem du den Befehl ausführst.

## Lokaler Start

```bash
npm install
node src/index.js
```

## Rechte des Bots

- Send Messages
- Embed Links
- Attach Files
- Read Message History
- Manage Roles
- Manage Channels (optional für spätere Ausbaustufen)
- View Channels

Die Bot-Rolle muss **über** den drei Gildenrollen stehen, damit die automatische Rollenvergabe funktioniert.
