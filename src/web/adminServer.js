const express = require('express');
const starters = require('../config/starters');
const {
  allPlayers,
  getPlayerById,
  getCampTotals,
  updatePlayerAdmin,
  deletePlayerById,
  deleteAllPlayers,
  resetPlayerCooldowns,
  resetAllCooldowns
} = require('../services/playerService');
const {
  getXpProgress,
  getCampProgress
} = require('../services/progressionService');
const {
  getGuilds,
  getGuildByKey,
  upsertGuild,
  deleteGuildByKey,
  normalizeColor
} = require('../services/guildService');

function startAdminServer() {
  const enabled = String(process.env.ADMIN_WEB_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    console.log('Admin-Webinterface deaktiviert (ADMIN_WEB_ENABLED=false).');
    return null;
  }

  const username = process.env.ADMIN_WEB_USER;
  const password = process.env.ADMIN_WEB_PASSWORD;

  if (!username || !password) {
    console.warn('Admin-Webinterface wurde nicht gestartet, weil ADMIN_WEB_USER oder ADMIN_WEB_PASSWORD fehlt.');
    return null;
  }

  const port = Number(process.env.PORT || process.env.ADMIN_WEB_PORT) || 3001;
  const host = process.env.ADMIN_WEB_HOST || '0.0.0.0';
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(basicAuth(username, password));

  app.get('/', (_req, res) => {
    res.redirect('/admin');
  });

  app.get('/admin', (req, res) => {
    const players = allPlayers();
    const totals = getCampTotals();
    const notice = req.query.notice ? String(req.query.notice) : '';
    const message = req.query.message ? String(req.query.message) : '';
    const livePollMs = Math.max(0, Number(process.env.ADMIN_WEB_REFRESH_MS || 5000));

    res.send(renderLayout({
      title: 'Camp Indigo Admin',
      body: renderDashboard(players, totals, notice, message),
      extraScript: renderDashboardPollingScript(livePollMs)
    }));
  });

  app.get('/admin/dashboard-data.json', (_req, res) => {
    res.json(buildDashboardData());
  });

  app.get('/admin/player/:id', (req, res) => {
    const player = getPlayerById(Number(req.params.id));
    if (!player) {
      return res.redirect('/admin?notice=error&message=' + encodeURIComponent('Spielstand nicht gefunden.'));
    }

    return res.send(renderLayout({
      title: `Spielstand bearbeiten – ${player.discord_username}`,
      body: renderPlayerEditor(player)
    }));
  });

  app.post('/admin/player/:id', (req, res) => {
    const id = Number(req.params.id);
    const player = getPlayerById(id);

    if (!player) {
      return res.redirect('/admin?notice=error&message=' + encodeURIComponent('Spielstand nicht gefunden.'));
    }

    updatePlayerAdmin(id, {
      discord_username: req.body.discord_username,
      pokemon_key: req.body.pokemon_key,
      guild_key: req.body.guild_key,
      xp: req.body.xp,
      wood: req.body.wood,
      food: req.body.food,
      stone: req.body.stone,
      contribution: req.body.contribution,
      sammeln_cooldown_until: req.body.sammeln_cooldown_until,
      arbeiten_cooldown_until: req.body.arbeiten_cooldown_until,
      trainieren_cooldown_until: req.body.trainieren_cooldown_until,
      busy_until: req.body.busy_until,
      busy_activity: req.body.busy_activity
    });

    return res.redirect('/admin/player/' + id + '?notice=success&message=' + encodeURIComponent('Spielstand gespeichert.'));
  });

  app.post('/admin/player/:id/delete', (req, res) => {
    const id = Number(req.params.id);
    deletePlayerById(id);
    return res.redirect('/admin?notice=success&message=' + encodeURIComponent('Spielstand gelöscht.'));
  });

  app.post('/admin/player/:id/reset-cooldowns', (req, res) => {
    const id = Number(req.params.id);
    const player = getPlayerById(id);

    if (!player) {
      return res.redirect('/admin?notice=error&message=' + encodeURIComponent('Spielstand nicht gefunden.'));
    }

    resetPlayerCooldowns(player.discord_user_id);
    return res.redirect('/admin/player/' + id + '?notice=success&message=' + encodeURIComponent('Cooldowns und Busy-Status zurückgesetzt.'));
  });

  app.post('/admin/players/delete-all', (_req, res) => {
    deleteAllPlayers();
    return res.redirect('/admin?notice=success&message=' + encodeURIComponent('Alle Spielstände wurden gelöscht.'));
  });

  app.post('/admin/players/reset-cooldowns', (_req, res) => {
    resetAllCooldowns();
    return res.redirect('/admin?notice=success&message=' + encodeURIComponent('Alle Cooldowns und Busy-States wurden zurückgesetzt.'));
  });

  app.get('/admin/guilds', (req, res) => {
    const notice = req.query.notice ? String(req.query.notice) : '';
    const message = req.query.message ? String(req.query.message) : '';

    return res.send(renderLayout({
      title: 'Gilden verwalten',
      body: renderGuildListPage(getGuilds(), allPlayers(), notice, message)
    }));
  });

  app.get('/admin/guild/new', (_req, res) => {
    return res.send(renderLayout({
      title: 'Neue Gilde',
      body: renderGuildEditor(null)
    }));
  });

  app.get('/admin/guild/:key', (req, res) => {
    const guild = getGuildByKey(req.params.key);
    if (!guild) {
      return res.redirect('/admin/guilds?notice=error&message=' + encodeURIComponent('Gilde nicht gefunden.'));
    }

    return res.send(renderLayout({
      title: `Gilde bearbeiten – ${guild.name}`,
      body: renderGuildEditor(guild)
    }));
  });

  app.post('/admin/guilds', (req, res) => {
    const key = String(req.body.key || '').trim().toLowerCase();
    const guilds = getGuilds();

    if (!key) {
      return res.redirect('/admin/guild/new?notice=error&message=' + encodeURIComponent('Bitte einen Gilden-Key angeben.'));
    }

    if (guilds.some(item => item.key === key)) {
      return res.redirect('/admin/guild/new?notice=error&message=' + encodeURIComponent('Dieser Gilden-Key existiert bereits.'));
    }

    try {
      upsertGuild({
        key,
        name: req.body.name,
        emoji: req.body.emoji,
        description: req.body.description,
        color: req.body.color,
        roleName: req.body.role_name
      });
    } catch (error) {
      return res.redirect('/admin/guild/new?notice=error&message=' + encodeURIComponent(error.message || 'Gilde konnte nicht gespeichert werden.'));
    }

    return res.redirect('/admin/guilds?notice=success&message=' + encodeURIComponent('Gilde erstellt.'));
  });

  app.post('/admin/guild/:key', (req, res) => {
    const current = getGuildByKey(req.params.key);
    if (!current) {
      return res.redirect('/admin/guilds?notice=error&message=' + encodeURIComponent('Gilde nicht gefunden.'));
    }

    try {
      upsertGuild({
        key: current.key,
        name: req.body.name,
        emoji: req.body.emoji,
        description: req.body.description,
        color: req.body.color,
        roleName: req.body.role_name
      });
    } catch (error) {
      return res.redirect('/admin/guild/' + encodeURIComponent(current.key) + '?notice=error&message=' + encodeURIComponent(error.message || 'Gilde konnte nicht gespeichert werden.'));
    }

    return res.redirect('/admin/guild/' + encodeURIComponent(current.key) + '?notice=success&message=' + encodeURIComponent('Gilde gespeichert.'));
  });

  app.post('/admin/guild/:key/delete', (req, res) => {
    const key = req.params.key;
    const guild = getGuildByKey(key);

    if (!guild) {
      return res.redirect('/admin/guilds?notice=error&message=' + encodeURIComponent('Gilde nicht gefunden.'));
    }

    const playersUsingGuild = allPlayers().filter(player => player.guild_key === key);
    if (playersUsingGuild.length > 0) {
      return res.redirect('/admin/guilds?notice=error&message=' + encodeURIComponent('Die Gilde wird noch von Spielern verwendet und kann nicht gelöscht werden.'));
    }

    if (getGuilds().length <= 1) {
      return res.redirect('/admin/guilds?notice=error&message=' + encodeURIComponent('Es muss mindestens eine Gilde bestehen bleiben.'));
    }

    deleteGuildByKey(key);
    return res.redirect('/admin/guilds?notice=success&message=' + encodeURIComponent('Gilde gelöscht.'));
  });

  app.get('/admin/export.json', (_req, res) => {
    res.json({
      exportedAt: new Date().toISOString(),
      players: allPlayers(),
      totals: getCampTotals(),
      guilds: getGuilds()
    });
  });

  const server = app.listen(port, host, () => {
    const publicBaseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : `http://localhost:${port}`;

    console.log(`Admin-Webinterface läuft lokal auf http://localhost:${port}/admin`);
    console.log(`Admin-Webinterface erreichbar unter ${publicBaseUrl}/admin`);
  });

  return server;
}

function buildDashboardData() {
  const players = allPlayers();
  const totals = getCampTotals();
  const camp = getCampProgress(totals.contribution);

  return {
    generatedAt: new Date().toISOString(),
    totals,
    camp: {
      level: camp.level,
      progressText: getCampProgressLabel(totals.contribution),
      unlocks: [
        'Stufe 1: Sammeln, Arbeiten',
        'Stufe 2: Trainieren',
        'Stufe 3: Erkunden'
      ]
    },
    players: players.map(player => ({
      id: player.id,
      discord_username: player.discord_username,
      discord_user_id: player.discord_user_id,
      starter_label: getStarterLabel(player),
      guild_label: getGuildLabel(player),
      level_label: `Lv ${player.level}`,
      progress_label: getProgressLabel(player),
      wood: player.wood,
      food: player.food,
      stone: player.stone,
      contribution: player.contribution,
      updated_at_label: formatDate(player.updated_at),
      sammeln_label: getRemainingLabel(player.sammeln_cooldown_until, 'Sammeln'),
      arbeiten_label: getRemainingLabel(player.arbeiten_cooldown_until, 'Arbeiten'),
      trainieren_label: getRemainingLabel(player.trainieren_cooldown_until, 'Trainieren'),
      busy_label: getBusyLabel(player)
    }))
  };
}

function basicAuth(expectedUser, expectedPassword) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');

    if (scheme !== 'Basic' || !encoded) {
      return unauthorized(res);
    }

    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
    const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

    if (username !== expectedUser || password !== expectedPassword) {
      return unauthorized(res);
    }

    return next();
  };
}

function unauthorized(res) {
  res.set('WWW-Authenticate', 'Basic realm="Camp Indigo Admin"');
  return res.status(401).send('Authentifizierung erforderlich.');
}

function renderLayout({ title, body, extraScript = '' }) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f172a;
      --panel: #111827;
      --panel-2: #1f2937;
      --text: #e5e7eb;
      --muted: #9ca3af;
      --border: #334155;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --blue: #60a5fa;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, system-ui, Arial, sans-serif;
      background: linear-gradient(180deg, #0b1120, var(--bg));
      color: var(--text);
      padding: 24px;
    }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .wrap { max-width: 1280px; margin: 0 auto; }
    .topbar { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 20px; }
    .title { font-size: 28px; font-weight: 800; }
    .subtitle { color: var(--muted); margin-top: 4px; }
    .panel { background: rgba(17,24,39,.85); backdrop-filter: blur(6px); border: 1px solid var(--border); border-radius: 18px; padding: 20px; box-shadow: 0 8px 40px rgba(0,0,0,.2); }
    .grid { display: grid; gap: 16px; }
    .grid-4 { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    .stat { padding: 16px; border-radius: 16px; background: var(--panel-2); border: 1px solid var(--border); }
    .stat .label { color: var(--muted); font-size: 13px; }
    .stat .value { font-size: 28px; font-weight: 800; margin-top: 4px; }
    .notice { padding: 14px 16px; border-radius: 14px; margin-bottom: 16px; }
    .notice.success { background: rgba(16,185,129,.12); border: 1px solid rgba(16,185,129,.4); }
    .notice.error { background: rgba(239,68,68,.12); border: 1px solid rgba(239,68,68,.4); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 12px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-size: 13px; font-weight: 700; }
    .muted { color: var(--muted); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn, button {
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--text);
      padding: 10px 14px;
      border-radius: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .btn-primary { background: rgba(96,165,250,.15); border-color: rgba(96,165,250,.35); }
    .btn-danger { background: rgba(239,68,68,.15); border-color: rgba(239,68,68,.35); }
    .btn-warning { background: rgba(245,158,11,.12); border-color: rgba(245,158,11,.35); }
    .btn-success { background: rgba(16,185,129,.12); border-color: rgba(16,185,129,.35); }
    form.inline { display: inline; }
    .spacer { height: 16px; }
    label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
    input, select, textarea {
      width: 100%;
      background: #0b1220;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 12px;
      margin-bottom: 14px;
    }
    textarea { min-height: 120px; resize: vertical; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    .toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .pill { display: inline-block; padding: 4px 8px; border-radius: 999px; background: rgba(96,165,250,.12); color: var(--blue); font-size: 12px; font-weight: 700; }
    .danger-zone { border: 1px solid rgba(239,68,68,.35); background: rgba(239,68,68,.08); }
    .nav { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
    .nav a { display:inline-block; padding:8px 12px; border-radius:999px; border:1px solid var(--border); background: rgba(31,41,55,.7); }
    .meta { display:flex; gap:10px; flex-wrap:wrap; color:var(--muted); font-size:12px; margin-top:8px; }
    .right { text-align:right; }
  </style>
</head>
<body>
  <div class="wrap">
    ${body}
  </div>
  ${extraScript}
</body>
</html>`;
}

function renderTopbar(title, subtitle, activeNav = 'dashboard') {
  return `
    <div class="topbar">
      <div>
        <div class="title">${escapeHtml(title)}</div>
        <div class="subtitle">${escapeHtml(subtitle)}</div>
        <div class="nav">
          <a href="/admin" ${activeNav === 'dashboard' ? 'style="border-color:rgba(96,165,250,.5);background:rgba(96,165,250,.12);"' : ''}>Übersicht</a>
          <a href="/admin/guilds" ${activeNav === 'guilds' ? 'style="border-color:rgba(96,165,250,.5);background:rgba(96,165,250,.12);"' : ''}>Gilden</a>
          <a href="/admin/export.json">JSON-Export</a>
        </div>
      </div>
      <div class="pill">SQLite · Railway</div>
    </div>
  `;
}

function renderDashboard(players, totals, notice, message) {
  const rows = players.map(renderPlayerRow).join('') || `
    <tr>
      <td colspan="9" class="muted">Noch keine Spieler vorhanden.</td>
    </tr>
  `;

  const campProgress = getCampProgressLabel(totals.contribution);

  return `
    ${renderTopbar('Camp Indigo Admin', 'Live-Ansicht ohne kompletten Seiten-Reload.', 'dashboard')}
    ${renderNotice(notice, message)}
    <div class="panel">
      <div class="toolbar">
        <div>
          <div class="title" style="font-size:20px;">Camp-Status</div>
          <div class="subtitle">Spielstände, Fortschritt, Cooldowns und Busy-Status.</div>
        </div>
        <div class="meta">
          <span id="live-status">Live-Update aktiv</span>
          <span id="last-sync">Letzte Aktualisierung: gerade eben</span>
        </div>
      </div>
      <div class="grid grid-4" id="stats-grid">
        ${renderStatsGrid(totals)}
      </div>
      <div class="spacer"></div>
      <div class="panel" style="padding:16px;">
        <div class="label">Camp-Fortschritt</div>
        <div class="value" id="camp-progress-text" style="font-size:20px;font-weight:700;">${escapeHtml(campProgress)}</div>
        <div class="muted" style="margin-top:10px;">Freischaltungen: Stufe 2 = Trainieren, Stufe 3 = Erkunden</div>
      </div>
    </div>
    <div class="spacer"></div>
    <div class="panel">
      <div class="toolbar">
        <div>
          <div class="title" style="font-size:20px;">Spielstände</div>
          <div class="subtitle">Bearbeiten, löschen oder Testzustände direkt zurücksetzen.</div>
        </div>
        <div class="actions">
          <form class="inline" method="post" action="/admin/players/reset-cooldowns" onsubmit="return confirm('Wirklich alle Cooldowns und Busy-States zurücksetzen?');">
            <button class="btn btn-warning" type="submit">Alle Cooldowns resetten</button>
          </form>
          <form class="inline" method="post" action="/admin/players/delete-all" onsubmit="return confirm('Wirklich ALLE Spielstände löschen?');">
            <button class="btn btn-danger" type="submit">Alle Spielstände löschen</button>
          </form>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Spieler</th>
            <th>Pokémon</th>
            <th>Gilde</th>
            <th>Level / XP</th>
            <th>Ressourcen</th>
            <th>Beitrag</th>
            <th>Status</th>
            <th>Letztes Update</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody id="players-table-body">${rows}</tbody>
      </table>
    </div>
  `;
}

function renderStatsGrid(totals) {
  return `
    <div class="stat"><div class="label">Spieler</div><div class="value">${totals.players}</div></div>
    <div class="stat"><div class="label">Gesamt-XP</div><div class="value">${totals.xp}</div></div>
    <div class="stat"><div class="label">Lagerbeitrag</div><div class="value">${totals.contribution}</div></div>
    <div class="stat"><div class="label">Holz</div><div class="value">${totals.wood}</div></div>
    <div class="stat"><div class="label">Nahrung</div><div class="value">${totals.food}</div></div>
    <div class="stat"><div class="label">Stein</div><div class="value">${totals.stone}</div></div>
  `;
}

function renderPlayerRow(player) {
  return `
    <tr>
      <td>
        <strong>${escapeHtml(player.discord_username)}</strong><br />
        <span class="muted">${escapeHtml(player.discord_user_id)}</span>
      </td>
      <td>${escapeHtml(getStarterLabel(player))}</td>
      <td>${escapeHtml(getGuildLabel(player))}</td>
      <td><strong>Lv ${player.level}</strong><br /><span class="muted">${escapeHtml(getProgressLabel(player))}</span></td>
      <td>🪵 ${player.wood} · 🍖 ${player.food} · 🪨 ${player.stone}</td>
      <td>${player.contribution}</td>
      <td>
        <div class="muted">${escapeHtml(getRemainingLabel(player.sammeln_cooldown_until, 'Sammeln'))}</div>
        <div class="muted">${escapeHtml(getRemainingLabel(player.arbeiten_cooldown_until, 'Arbeiten'))}</div>
        <div class="muted">${escapeHtml(getRemainingLabel(player.trainieren_cooldown_until, 'Trainieren'))}</div>
        <div class="muted">${escapeHtml(getBusyLabel(player))}</div>
      </td>
      <td><span class="muted">${escapeHtml(formatDate(player.updated_at))}</span></td>
      <td>
        <div class="actions">
          <a class="btn btn-primary" href="/admin/player/${player.id}">Bearbeiten</a>
          <form class="inline" method="post" action="/admin/player/${player.id}/reset-cooldowns">
            <button class="btn btn-warning" type="submit">Reset</button>
          </form>
          <form class="inline" method="post" action="/admin/player/${player.id}/delete" onsubmit="return confirm('Spielstand von ${escapeHtmlJs(player.discord_username)} wirklich löschen?');">
            <button class="btn btn-danger" type="submit">Löschen</button>
          </form>
        </div>
      </td>
    </tr>
  `;
}

function renderPlayerEditor(player) {
  const sammelnValue = player.sammeln_cooldown_until ? toDatetimeLocal(player.sammeln_cooldown_until) : '';
  const arbeitenValue = player.arbeiten_cooldown_until ? toDatetimeLocal(player.arbeiten_cooldown_until) : '';
  const trainierenValue = player.trainieren_cooldown_until ? toDatetimeLocal(player.trainieren_cooldown_until) : '';
  const busyUntilValue = player.busy_until ? toDatetimeLocal(player.busy_until) : '';

  const optionsStarters = starters.map(starter => `
    <option value="${escapeHtml(starter.key)}" ${starter.key === player.pokemon_key ? 'selected' : ''}>${escapeHtml(starter.name)} (${escapeHtml(starter.key)})</option>
  `).join('');

  const optionsGuilds = getGuilds().map(guild => `
    <option value="${escapeHtml(guild.key)}" ${guild.key === player.guild_key ? 'selected' : ''}>${escapeHtml(guild.name)} (${escapeHtml(guild.key)})</option>
  `).join('');

  return `
    ${renderTopbar('Spielstand bearbeiten', `${player.discord_username} · ${getStarterLabel(player)} · ${getGuildLabel(player)}`, 'dashboard')}
    ${renderNoticeFromLocation()}
    <div class="panel">
      <form method="post" action="/admin/player/${player.id}">
        <div class="form-grid">
          <div>
            <label>Discord-Name</label>
            <input type="text" name="discord_username" value="${escapeHtml(player.discord_username)}" required />
          </div>
          <div>
            <label>Discord User ID</label>
            <input type="text" value="${escapeHtml(player.discord_user_id)}" disabled />
          </div>
          <div>
            <label>Pokémon</label>
            <select name="pokemon_key">${optionsStarters}</select>
          </div>
          <div>
            <label>Gilde</label>
            <select name="guild_key">${optionsGuilds}</select>
          </div>
          <div>
            <label>Level</label>
            <input type="text" value="${player.level}" disabled />
          </div>
          <div>
            <label>XP</label>
            <input type="number" min="0" name="xp" value="${player.xp}" required />
            <div class="muted" style="margin-top:-6px; font-size:12px;">Level wird automatisch aus den XP berechnet. ${escapeHtml(getProgressLabel(player))}</div>
          </div>
          <div>
            <label>Holz</label>
            <input type="number" min="0" name="wood" value="${player.wood}" required />
          </div>
          <div>
            <label>Nahrung</label>
            <input type="number" min="0" name="food" value="${player.food}" required />
          </div>
          <div>
            <label>Stein</label>
            <input type="number" min="0" name="stone" value="${player.stone}" required />
          </div>
          <div>
            <label>Lagerbeitrag</label>
            <input type="number" min="0" name="contribution" value="${player.contribution}" required />
          </div>
          <div>
            <label>Sammeln-Cooldown bis</label>
            <input type="datetime-local" name="sammeln_cooldown_until" value="${escapeHtml(sammelnValue)}" />
          </div>
          <div>
            <label>Arbeiten-Cooldown bis</label>
            <input type="datetime-local" name="arbeiten_cooldown_until" value="${escapeHtml(arbeitenValue)}" />
          </div>
          <div>
            <label>Trainieren-Cooldown bis</label>
            <input type="datetime-local" name="trainieren_cooldown_until" value="${escapeHtml(trainierenValue)}" />
          </div>
          <div>
            <label>Busy bis</label>
            <input type="datetime-local" name="busy_until" value="${escapeHtml(busyUntilValue)}" />
          </div>
          <div>
            <label>Busy-Aktivität</label>
            <select name="busy_activity">
              <option value="" ${!player.busy_activity ? 'selected' : ''}>Keine</option>
              <option value="erkunden" ${player.busy_activity === 'erkunden' ? 'selected' : ''}>Erkunden</option>
              <option value="expedition" ${player.busy_activity === 'expedition' ? 'selected' : ''}>Expedition</option>
            </select>
          </div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" type="submit">Speichern</button>
        </div>
      </form>
    </div>
    <div class="spacer"></div>
    <div class="panel danger-zone">
      <div class="toolbar">
        <div>
          <div class="title" style="font-size:20px;">Test- und Resetaktionen</div>
          <div class="subtitle">Nützlich für Railway-Tests ohne lokale Doppelinstanz.</div>
        </div>
      </div>
      <div class="actions">
        <form class="inline" method="post" action="/admin/player/${player.id}/reset-cooldowns">
          <button class="btn btn-warning" type="submit">Cooldowns & Busy resetten</button>
        </form>
        <form class="inline" method="post" action="/admin/player/${player.id}/delete" onsubmit="return confirm('Spielstand wirklich löschen?');">
          <button class="btn btn-danger" type="submit">Spielstand löschen</button>
        </form>
      </div>
    </div>
    <script>
      const params = new URLSearchParams(window.location.search);
      const notice = params.get('notice');
      const message = params.get('message');
      if (notice && message) {
        const container = document.createElement('div');
        container.className = 'notice ' + notice;
        container.textContent = message;
        document.querySelector('.wrap').insertBefore(container, document.querySelector('.panel'));
      }
    </script>
  `;
}

function renderGuildListPage(guilds, players, notice, message) {
  const rows = guilds.map(guild => {
    const count = players.filter(player => player.guild_key === guild.key).length;

    return `
      <tr>
        <td><strong>${escapeHtml(guild.name)}</strong><br /><span class="muted">${escapeHtml(guild.key)}</span></td>
        <td>${escapeHtml(guild.emoji)}</td>
        <td>${escapeHtml(guild.roleName)}</td>
        <td>${escapeHtml(guild.description || '—')}</td>
        <td>${count}</td>
        <td>
          <div class="actions">
            <a class="btn btn-primary" href="/admin/guild/${encodeURIComponent(guild.key)}">Bearbeiten</a>
            <form class="inline" method="post" action="/admin/guild/${encodeURIComponent(guild.key)}/delete" onsubmit="return confirm('Gilde ${escapeHtmlJs(guild.name)} wirklich löschen?');">
              <button class="btn btn-danger" type="submit">Löschen</button>
            </form>
          </div>
        </td>
      </tr>
    `;
  }).join('') || `
    <tr><td colspan="6" class="muted">Keine Gilden vorhanden.</td></tr>
  `;

  return `
    ${renderTopbar('Gilden verwalten', 'Gilden-Definitionen direkt im Adminpanel pflegen.', 'guilds')}
    ${renderNotice(notice, message)}
    <div class="panel">
      <div class="toolbar">
        <div>
          <div class="title" style="font-size:20px;">Gildenliste</div>
          <div class="subtitle">Neue Gilden anlegen oder bestehende bearbeiten.</div>
        </div>
        <div class="actions">
          <a class="btn btn-success" href="/admin/guild/new">Neue Gilde</a>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Emoji</th>
            <th>Rollenname</th>
            <th>Beschreibung</th>
            <th>Spieler</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderGuildEditor(guild) {
  const isNew = !guild;
  const current = guild || {
    key: '',
    name: '',
    emoji: '🏳️',
    description: '',
    color: 0x5865f2,
    roleName: ''
  };

  const action = isNew ? '/admin/guilds' : `/admin/guild/${encodeURIComponent(current.key)}`;
  const colorValue = '#' + normalizeColor(current.color).toString(16).padStart(6, '0');

  return `
    ${renderTopbar(isNew ? 'Neue Gilde' : `Gilde bearbeiten – ${current.name}`, isNew ? 'Neue Gildenkonfiguration anlegen.' : `Key: ${current.key}`, 'guilds')}
    ${renderNoticeFromLocation()}
    <div class="panel">
      <form method="post" action="${action}">
        <div class="form-grid">
          <div>
            <label>Key</label>
            <input type="text" name="key" value="${escapeHtml(current.key)}" ${isNew ? 'required' : 'disabled'} />
            <div class="muted" style="margin-top:-6px;font-size:12px;">${isNew ? 'Wird intern für Spielerzuordnung verwendet.' : 'Key bleibt stabil, damit bestehende Spieler weiter korrekt zugeordnet bleiben.'}</div>
          </div>
          <div>
            <label>Name</label>
            <input type="text" name="name" value="${escapeHtml(current.name)}" required />
          </div>
          <div>
            <label>Emoji</label>
            <input type="text" name="emoji" value="${escapeHtml(current.emoji)}" required />
          </div>
          <div>
            <label>Discord-Rollenname</label>
            <input type="text" name="role_name" value="${escapeHtml(current.roleName)}" required />
          </div>
          <div>
            <label>Farbe</label>
            <input type="text" name="color" value="${escapeHtml(colorValue)}" required />
          </div>
          <div style="display:flex;align-items:flex-end;">
            <div class="pill">Vorschau: <span style="margin-left:8px;">${escapeHtml(current.emoji)} ${escapeHtml(current.name || 'Neue Gilde')}</span></div>
          </div>
        </div>
        <div>
          <label>Beschreibung</label>
          <textarea name="description" required>${escapeHtml(current.description)}</textarea>
        </div>
        <div class="actions">
          <button class="btn btn-primary" type="submit">Speichern</button>
          <a class="btn" href="/admin/guilds">Zurück</a>
        </div>
      </form>
    </div>
  `;
}

function renderDashboardPollingScript(livePollMs) {
  if (!livePollMs) return '';

  return `
    <script>
      (function () {
        if (window.location.pathname !== '/admin') return;

        const playersTableBody = document.getElementById('players-table-body');
        const statsGrid = document.getElementById('stats-grid');
        const campProgressText = document.getElementById('camp-progress-text');
        const lastSync = document.getElementById('last-sync');
        const liveStatus = document.getElementById('live-status');

        function escapeHtml(value) {
          return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
        }

        function escapeHtmlJs(value) {
          return String(value ?? '').replaceAll('"', '\\"').replaceAll("'", "\\'");
        }

        function renderStats(totals) {
          return [
            '<div class="stat"><div class="label">Spieler</div><div class="value">' + totals.players + '</div></div>',
            '<div class="stat"><div class="label">Gesamt-XP</div><div class="value">' + totals.xp + '</div></div>',
            '<div class="stat"><div class="label">Lagerbeitrag</div><div class="value">' + totals.contribution + '</div></div>',
            '<div class="stat"><div class="label">Holz</div><div class="value">' + totals.wood + '</div></div>',
            '<div class="stat"><div class="label">Nahrung</div><div class="value">' + totals.food + '</div></div>',
            '<div class="stat"><div class="label">Stein</div><div class="value">' + totals.stone + '</div></div>'
          ].join('');
        }

        function renderRows(players) {
          if (!players.length) {
            return '<tr><td colspan="9" class="muted">Noch keine Spieler vorhanden.</td></tr>';
          }

          return players.map(function (player) {
            return [
              '<tr>',
              '<td><strong>' + escapeHtml(player.discord_username) + '</strong><br /><span class="muted">' + escapeHtml(player.discord_user_id) + '</span></td>',
              '<td>' + escapeHtml(player.starter_label) + '</td>',
              '<td>' + escapeHtml(player.guild_label) + '</td>',
              '<td><strong>' + escapeHtml(player.level_label) + '</strong><br /><span class="muted">' + escapeHtml(player.progress_label) + '</span></td>',
              '<td>🪵 ' + player.wood + ' · 🍖 ' + player.food + ' · 🪨 ' + player.stone + '</td>',
              '<td>' + player.contribution + '</td>',
              '<td>' +
                '<div class="muted">' + escapeHtml(player.sammeln_label) + '</div>' +
                '<div class="muted">' + escapeHtml(player.arbeiten_label) + '</div>' +
                '<div class="muted">' + escapeHtml(player.trainieren_label) + '</div>' +
                '<div class="muted">' + escapeHtml(player.busy_label) + '</div>' +
              '</td>',
              '<td><span class="muted">' + escapeHtml(player.updated_at_label) + '</span></td>',
              '<td><div class="actions">' +
                '<a class="btn btn-primary" href="/admin/player/' + player.id + '">Bearbeiten</a>' +
                '<form class="inline" method="post" action="/admin/player/' + player.id + '/reset-cooldowns"><button class="btn btn-warning" type="submit">Reset</button></form>' +
                '<form class="inline" method="post" action="/admin/player/' + player.id + '/delete" onsubmit="return confirm(\'Spielstand von ' + escapeHtmlJs(player.discord_username) + ' wirklich löschen?\');"><button class="btn btn-danger" type="submit">Löschen</button></form>' +
              '</div></td>',
              '</tr>'
            ].join('');
          }).join('');
        }

        async function poll() {
          try {
            const response = await fetch('/admin/dashboard-data.json', { credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();
            statsGrid.innerHTML = renderStats(data.totals);
            playersTableBody.innerHTML = renderRows(data.players);
            campProgressText.textContent = data.camp.progressText;
            lastSync.textContent = 'Letzte Aktualisierung: ' + new Date(data.generatedAt).toLocaleTimeString('de-DE');
            liveStatus.textContent = 'Live-Update aktiv';
          } catch (error) {
            console.error(error);
            liveStatus.textContent = 'Live-Update unterbrochen';
          }
        }

        poll();
        setInterval(poll, ${livePollMs});
      })();
    </script>
  `;
}

function renderNotice(notice, message) {
  if (!notice || !message) return '';
  return `<div class="notice ${escapeHtml(notice)}">${escapeHtml(message)}</div>`;
}

function renderNoticeFromLocation() {
  return '';
}

function getStarterByKey(key) {
  return starters.find(starter => starter.key === key) || null;
}

function getStarterLabel(player) {
  const starter = getStarterByKey(player.pokemon_key);
  return starter ? `${starter.name} ${starter.emoji}` : player.pokemon_key;
}

function getGuildLabel(player) {
  const guild = getGuildByKey(player.guild_key);
  return guild ? `${guild.name} ${guild.emoji}` : player.guild_key;
}

function getProgressLabel(player) {
  const progress = getXpProgress(player.xp);
  if (progress.isMaxLevel) {
    return 'Max-Level erreicht';
  }
  return `${progress.currentXpInLevel}/${progress.neededForNextLevel} XP bis Level ${progress.nextLevel}`;
}

function getCampProgressLabel(contribution) {
  const progress = getCampProgress(contribution);
  if (progress.isMaxLevel) {
    return `Camp Stufe ${progress.level} · Max-Stufe erreicht`;
  }
  return `Camp Stufe ${progress.level} · ${progress.currentInLevel}/${progress.neededForNextLevel} Beitrag bis Stufe ${progress.nextLevel}`;
}

function getRemainingLabel(value, label) {
  if (!value) {
    return `${label}: bereit`;
  }

  const remaining = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return `${label}: bereit`;
  }

  return `${label}: ${formatDuration(remaining)}`;
}

function getBusyLabel(player) {
  if (!player.busy_activity || !player.busy_until) {
    return 'Busy: frei';
  }

  const remaining = new Date(player.busy_until).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return `Busy: ${player.busy_activity} beendet`;
  }

  return `Busy: ${player.busy_activity} · ${formatDuration(remaining)}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('de-DE');
}

function toDatetimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlJs(value) {
  return String(value ?? '').replaceAll('"', '\\"').replaceAll("'", "\\'");
}

module.exports = { startAdminServer };
