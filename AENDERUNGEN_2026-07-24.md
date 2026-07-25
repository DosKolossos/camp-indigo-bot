# Camp Indigo – Arbeitsstand 24.07.2026

## Fortschrittsanzeige ohne Bilder

- Camp-Hintergründe, PSD-Datei, Camp-Schriften und Bildvorschau wurden entfernt.
- Die feste Fortschrittsnachricht ist jetzt ein reines Discord-Embed.
- Enthalten bleiben Camp-Stufe, Text-Fortschrittsbalken, Gildenbestände, Freischaltungen, Top-Beiträger und der aktivste Spieler der letzten 24 Stunden.
- `@napi-rs/canvas` wurde aus den Abhängigkeiten entfernt.

## Arena / PvP ab Camp-Stufe 6

- Gegnerwahl über Discord-Nutzerauswahl.
- Öffentliche Herausforderung mit Annahme- und Ablehnen-Button.
- Matchmaking nur innerhalb derselben Zehner-Levelklasse.
- Keine Kämpfe während Busy-Aktionen.
- Fünf Minuten Kampfpause nach jedem Kampf.
- Höchstens fünf gewertete Kämpfe je Person innerhalb von 24 Stunden.
- Keine Ressourcenverluste oder erzwungenen Kämpfe.
- 8 XP für den Sieger, 3 XP für den Verlierer.
- Automatischer rundenbasierter Kampf mit Kraft, Ausdauer, Tempo, Instinkt, Geschick, Waffe und Rüstung.
- PvP-Bilanz wird im Profil und Aktionsmenü angezeigt.
- Neue Datenbanktabelle `pvp_challenges` mit Löschkaskaden zu Spielern.
- Kampfabschluss, XP-Vergabe und Kampfprotokoll werden gemeinsam in einer Datenbanktransaktion gespeichert.

## Boss-Ping

- Beim tatsächlichen Boss-Spawn wird die passende Gildenrolle erwähnt: `@Nimbus`, `@Ember` oder `@Volt`.
- Die Rolle wird zunächst über die gespeicherte Rollen-ID und ersatzweise über den Rollennamen aufgelöst.
- Es wird nur die betroffene Gilde gepingt, nicht jedes Mal alle drei Rollen.
- Ein fehlgeschlagener Discord-Versand wird nicht als erledigt markiert; der Scheduler versucht die Meldung erneut.

## Weitere Reparatur

- User-Select-Menüs und Modal-Submits werden nun im zentralen Interaction-Router verarbeitet.
- Der Lagerstatus und die Profil-Camp-Stufe verwenden jetzt korrekt die jeweilige Gilde statt globaler Summen.
- Die zuvor geprüften Reparaturen an Bossmigration, Adminpanel, Spielerlöschung und Camp-Stufen 9–10 bleiben enthalten.

## Prüfungen

- Alle JavaScript-Dateien bestehen `node --check`.
- PvP-Simulation mit 1.000 Testkämpfen bestanden.
- SQLite-Schema inklusive `pvp_challenges` erfolgreich in einer In-Memory-Datenbank angelegt.
- Textbasierter Camp-Payload ohne Dateien oder Attachments erfolgreich geprüft.
- Ein vollständiger Laufzeittest mit echten npm-Paketen war in der Arbeitsumgebung nicht möglich, weil der interne npm-Paketserver wiederholt HTTP 503 geliefert hat.

## Arena-Kanal und gefilterte Gegnerwahl

- PvP-Herausforderungen und Kampfergebnisse werden ausschließlich im Arena-Kanal `1485798330406801549` veröffentlicht.
- Der Kanal kann bei Bedarf über `PVP_CHANNEL_ID` geändert werden.
- Die allgemeine Discord-Nutzerauswahl wurde durch eine Camp-Indigo-Gegnerliste ersetzt.
- Angezeigt werden nur Spieler in derselben Levelklasse, deren Gilde Camp-Stufe 6 erreicht hat und die weder beschäftigt noch in Kampfpause oder am Tageslimit sind.
- Spieler mit einer bereits offenen Herausforderung werden ebenfalls ausgeblendet.
- Die Auswahl zeigt Pokémon, Level, Kampfkraft und Gilde des Gegners.
- Die Verfügbarkeit wird beim Absenden erneut geprüft, damit zwischenzeitliche Statusänderungen keinen ungültigen Kampf erzeugen.


## Automatische Server-Mitgliedschaft

- Spielstände werden beim Botstart mit den Mitgliedern des Discord-Servers abgeglichen.
- Beim Verlassen des Servers wird der Spielstand automatisch deaktiviert.
- Beim erneuten Beitritt wird derselbe Spielstand automatisch reaktiviert.
- Zusätzlich erfolgt alle drei Tage ein vollständiger Sicherheitsabgleich.
- Jede Interaktion reaktiviert den ausführenden Spieler, falls ein Discord-Ereignis verpasst wurde.
- Inaktive Spieler erscheinen nicht in Ranglisten, PvP-Gegnerlisten oder der aktiven Spielerzahl.
- Ihre bisherigen Beiträge und Erkundungspunkte bleiben für den erreichten Camp-Fortschritt erhalten.
- Im Adminbereich werden aktive und inaktive Spielstände sichtbar getrennt; endgültiges Löschen bleibt möglich.
