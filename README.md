# Camp Indigo Bot

Discord-RPG mit Gilden, Camp-Fortschritt, Sammelaktionen, Expeditionen, Markt, Bossjagd und Arena-Kämpfen.

## Enthaltene Systeme

- `/ping`, `/setup-start` und `/setup-actions`
- Starter- und Gildenwahl
- automatische Gildenrollen: `Nimbus`, `Ember`, `Volt`
- Profil mit Level, Werten, Ausrüstung, Ressourcen und PvP-Bilanz
- Sammeln, Arbeiten, Trainieren und Erkunden
- Schmiede, Expeditionen und Markt
- tägliche Bossjagd pro Gilde ab Camp-Stufe 5
- Arena/PvP ab Camp-Stufe 6
- textbasierte Camp-Fortschrittsnachricht ohne Hintergrundbilder oder Canvas
- Admin-Webinterface zum Bearbeiten, Löschen, Zurücksetzen und Exportieren von Spielständen

## Arena / PvP

- Die Gegnerauswahl enthält ausschließlich aktuell spielbare Camp-Indigo-Spieler.
- Nicht angezeigt werden unter anderem Spieler aus einer anderen Levelklasse, beschäftigte Spieler, Personen in Kampfpause, Spieler am Tageslimit oder Personen mit einer offenen Herausforderung.
- Die Herausforderung und das Kampfergebnis werden im festen Arena-Kanal gepostet.
- Nur die herausgeforderte Person kann annehmen oder ablehnen.
- Kämpfe finden nur innerhalb derselben Levelklasse statt: 1–10, 11–20, 21–30 usw.
- Beschäftigte Spieler können nicht kämpfen.
- Nach einem Kampf gelten fünf Minuten Kampfpause.
- Pro Person sind höchstens fünf gewertete Kämpfe innerhalb von 24 Stunden möglich.
- Es werden keine Ressourcen gestohlen.
- Sieger: 8 XP; Verlierer: 3 XP.
- Die Kampfrunden berücksichtigen Level, Pokémon-Werte, Waffe und Rüstung.

## Boss-Benachrichtigungen

Wenn ein Boss um 20:00 Uhr erscheint, pingt der Bot die zugehörige Gildenrolle:

- Nimbus-Boss → `@Nimbus`
- Ember-Boss → `@Ember`
- Volt-Boss → `@Volt`

Der Bot benötigt dafür im Boss-/Gildenkanal die Berechtigung **„@everyone, @here und alle Rollen erwähnen“**. Seine Bot-Rolle sollte außerdem über den drei Gildenrollen stehen.

## Environment Variables

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
CHAT_CHANNEL_ID=
START_CHANNEL_ID=
ACTION_CHANNEL_ID=
PVP_CHANNEL_ID=1485798330406801549

NIMBUS_CHAT_CHANNEL_ID=
NIMBUS_PROGRESS_CHANNEL_ID=
EMBER_CHAT_CHANNEL_ID=
EMBER_PROGRESS_CHANNEL_ID=
VOLT_CHAT_CHANNEL_ID=
VOLT_PROGRESS_CHANNEL_ID=

# optional
SAMMELN_COOLDOWN_MINUTES=10
ARBEITEN_COOLDOWN_MINUTES=8
TRAINIEREN_COOLDOWN_MINUTES=12
EXPEDITION_COOLDOWN_MINUTES=30
EXPEDITION_BUSY_MINUTES=60

# Admin-Webinterface
ADMIN_WEB_ENABLED=true
ADMIN_WEB_HOST=0.0.0.0
ADMIN_WEB_PORT=3001
ADMIN_WEB_USER=admin
ADMIN_WEB_PASSWORD=bitte-sehr-lang-und-zufällig

# Datenbank auf dem Server, falls nicht /data/camp_indigo.db genutzt werden soll
DB_PATH=
DB_DIR=/data
```

`START_CHANNEL_ID` ist optional. Wenn es leer bleibt, postet `/setup-start` in den Kanal, in dem der Befehl ausgeführt wird.

`ACTION_CHANNEL_ID` ist optional. Wenn es leer bleibt, nutzt `/setup-actions` zuerst `CHAT_CHANNEL_ID` und sonst den aktuellen Kanal.

`PVP_CHANNEL_ID` bestimmt den gemeinsamen Arena-Kanal. Ohne Eintrag verwendet der Bot standardmäßig `1485798330406801549`.

## Installation und Start

```bash
npm install
npm start
```

Auf dem Server mit PM2 beispielsweise:

```bash
cd /opt/camp-indigo
npm install
pm2 restart camp-indigo --update-env
```

## Fortschrittsvorschau

Die Camp-Anzeige besteht vollständig aus Discord-Text und Embeds. Eine lokale Textvorschau kann erzeugt werden mit:

```bash
npm run preview:camp
```

Die Ausgabe landet unter `tmp/camp-preview.txt`.

## Discord-Rechte des Bots

- Kanäle ansehen
- Nachrichten senden
- Links einbetten
- Nachrichtenverlauf lesen
- Rollen verwalten
- `@everyone`, `@here` und alle Rollen erwähnen

Die Bot-Rolle muss über `Nimbus`, `Ember` und `Volt` stehen, damit Rollen angelegt, vergeben und beim Boss-Spawn erwähnt werden können.

## Automatischer Abgleich mit Discord-Mitgliedern

Camp Indigo gleicht gespeicherte Spieler mit dem Discord-Server ab:

- sofort bei `guildMemberRemove` und `guildMemberAdd`
- einmal beim Botstart
- zusätzlich alle drei Tage als Sicherheitsabgleich
- bei jeder Interaktion wird der ausführende Spieler als anwesend bestätigt

Verlassene Spieler werden nur deaktiviert. Sie erscheinen nicht mehr in Ranglisten, PvP-Gegnerlisten oder der aktiven Spielerzahl. Ihr Spielstand bleibt erhalten und wird bei einem erneuten Beitritt automatisch reaktiviert. Ein endgültiges Löschen ist weiterhin im Admin-Webinterface möglich.

Damit die Ereignisse und der vollständige Abgleich funktionieren, muss im Discord Developer Portal der privilegierte Intent **Server Members Intent** aktiviert sein.
