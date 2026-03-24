# Camp Indigo Bot – Panels, Cooldowns und Admin-Webinterface

Enthalten:
- `/ping`
- `/setup-start`
- `/setup-actions`
- Startnachricht mit Button **Abenteuer beginnen**
- ephemerale Starterwahl
- ephemerale Gildenwahl
- Aktionspanel mit Button **Aktionen öffnen**
- erste Aktionen: **Profil**, **Sammeln**, **Arbeiten**, **Lagerstatus**
- Cooldowns für **Sammeln** und **Arbeiten**
- Spielerprofil in SQLite
- automatische Gildenrollen-Anlage (`Nimbus`, `Ember`, `Volt`)
- Willkommensnachricht im Chat
- simples Admin-Webinterface zum **Bearbeiten, Löschen und Zurücksetzen** von Spielständen

## Environment Variables

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
CHAT_CHANNEL_ID=
START_CHANNEL_ID=
ACTION_CHANNEL_ID=

# optional, Standard: 10 und 8
SAMMELN_COOLDOWN_MINUTES=10
ARBEITEN_COOLDOWN_MINUTES=8

# Admin-Webinterface
ADMIN_WEB_ENABLED=true
ADMIN_WEB_HOST=0.0.0.0
ADMIN_WEB_PORT=3001
ADMIN_WEB_USER=admin
ADMIN_WEB_PASSWORD=bitte-sehr-lang-und-zufällig
```

`START_CHANNEL_ID` ist optional. Wenn leer, postet `/setup-start` in den Kanal, in dem du den Befehl ausführst.

`ACTION_CHANNEL_ID` ist optional. Wenn leer, nutzt `/setup-actions` zuerst `CHAT_CHANNEL_ID` und sonst den aktuellen Kanal.

## Lokaler Start

```bash
npm install
node src/index.js
```

## Admin-Webinterface

Sobald `ADMIN_WEB_USER` und `ADMIN_WEB_PASSWORD` gesetzt sind, läuft ein kleines Adminpanel unter:

```txt
http://localhost:3001/admin
```

Auf Railway oder einem Server entsprechend unter deiner öffentlichen Domain plus `/admin`.

Das Panel kann:
- alle Spielstände anzeigen
- einzelne Spielstände bearbeiten
- einzelne Spielstände löschen
- Cooldowns pro Spieler zurücksetzen
- alle Cooldowns global zurücksetzen
- alle Spielstände für Testphasen löschen
- Spielstände als JSON exportieren

## Rechte des Bots

- Send Messages
- Embed Links
- Read Message History
- Manage Roles
- View Channels

Die Bot-Rolle muss **über** den drei Gildenrollen stehen, damit die automatische Rollenvergabe funktioniert.
