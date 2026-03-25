const express = require('express');
const starters = require('../config/starters');
const guilds = require('../config/guilds');
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
    const autoRefreshMs = Math.max(0, Number(process.env.ADMIN_WEB_REFRESH_MS || 5000));

    res.send(renderLayout({
      title: 'Camp Indigo Admin',
      body: renderDashboard(players, totals, notice, message),
      autoRefreshMs
    }));
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
      arbeiten_cooldown_until: req.body.arbeiten_cooldown_until
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
    return res.redirect('/admin/player/' + id + '?notice=success&message=' + encodeURIComponent('Cooldowns zurückgesetzt.'));
  });

  app.post('/admin/players/delete-all', (_req, res) => {
    deleteAllPlayers();
    return res.redirect('/admin?notice=success&message=' + encodeURIComponent('Alle Spielstände wurden gelöscht.'));
  });

  app.post('/admin/players/reset-cooldowns', (_req, res) => {
    resetAllCooldowns();
    return res.redirect('/admin?notice=success&message=' + encodeURIComponent('Alle Cooldowns wurden zurückgesetzt.'));
  });

  app.get('/admin/export.json', (_req, res) => {
    res.json({
      exportedAt: new Date().toISOString(),
      players: allPlayers(),
      totals: getCampTotals()
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

function renderLayout({ title, body, autoRefreshMs = 0 }) {
  const refreshScript = autoRefreshMs > 0
    ? `
    <script>
      (function () {
        const isDashboard = window.location.pathname === '/admin';
        if (!isDashboard) return;

        const formsDirty = () => {
          const active = document.activeElement;
          if (!active) return false;
          const tag = (active.tagName || '').toLowerCase();
          return tag === 'input' || tag === 'select' || tag === 'textarea';
        };

        setInterval(() => {
          if (document.hidden) return;
          if (formsDirty()) return;
          window.location.reload();
        }, ${autoRefreshMs});
      })();
    </script>`
    : '';

  const refreshHint = autoRefreshMs > 0
    ? `<div style="margin-top:6px;color:var(--muted);font-size:12px;">Auto-Refresh aktiv (${Math.round(autoRefreshMs / 1000)}s)</div>`
    : '';

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
    .wrap { max-width: 1200px; margin: 0 auto; }
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
    form.inline { display: inline; }
    .spacer { height: 16px; }
    label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
    input, select {
      width: 100%;
      background: #0b1220;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 12px;
      margin-bottom: 14px;
    }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    .toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .pill { display: inline-block; padding: 4px 8px; border-radius: 999px; background: rgba(96,165,250,.12); color: var(--blue); font-size: 12px; font-weight: 700; }
    .danger-zone { border: 1px solid rgba(239,68,68,.35); background: rgba(239,68,68,.08); }
  </style>
</head>
<body>
  <div class="wrap">
    ${body}
    ${refreshHint}
  </div>
  ${refreshScript}
</body>
</html>`;
}

function renderDashboard(players, totals, notice, message) {
  const noticeHtml = message
    ? `<div class="notice ${escapeHtml(notice || 'success')}">${escapeHtml(message)}</div>`
    : '';

  const rows = players.length
    ? players.map(player => renderPlayerRow(player)).join('')
    : '<tr><td colspan="9" class="muted">Noch keine Spielstände vorhanden.</td></tr>';

  return `
    <div class="topbar">
      <div>
        <div class="title">Camp Indigo – Admin</div>
        <div class="subtitle">Spielstände verwalten, Cooldowns zurücksetzen und Testdaten bereinigen.</div>
      </div>
      <div class="actions">
        <a class="btn btn-primary" href="/admin/export.json">Export JSON</a>
      </div>
    </div>
    ${noticeHtml}
    <div class="panel">
      <div class="grid grid-4">
        <div class="stat"><div class="label">Spieler</div><div class="value">${totals.players}</div></div>
        <div class="stat"><div class="label">Gesamt-XP</div><div class="value">${totals.xp}</div></div>
        <div class="stat"><div class="label">Gesamt-Ressourcen</div><div class="value">${totals.wood + totals.food + totals.stone}</div></div>
        <div class="stat"><div class="label">Lagerbeitrag</div><div class="value">${totals.contribution}</div></div>
      </div>
    </div>
    <div class="spacer"></div>
    <div class="panel">
      <div class="toolbar">
        <div>
          <div class="title" style="font-size:20px;">Spielstände</div>
          <div class="subtitle">Bearbeiten, löschen oder Cooldowns pro Spieler zurücksetzen.</div>
        </div>
        <div class="actions">
          <form class="inline" method="post" action="/admin/players/reset-cooldowns" onsubmit="return confirm('Wirklich alle Cooldowns zurücksetzen?');">
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
            <th>Cooldowns</th>
            <th>Letztes Update</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderPlayerRow(player) {
  const sammeln = renderCooldownTag(player.sammeln_cooldown_until, 'Sammeln');
  const arbeiten = renderCooldownTag(player.arbeiten_cooldown_until, 'Arbeiten');

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
      <td>${sammeln}<br />${arbeiten}</td>
      <td><span class="muted">${escapeHtml(formatDate(player.updated_at))}</span></td>
      <td>
        <div class="actions">
          <a class="btn btn-primary" href="/admin/player/${player.id}">Bearbeiten</a>
          <form class="inline" method="post" action="/admin/player/${player.id}/reset-cooldowns">
            <button class="btn btn-warning" type="submit">Cooldowns</button>
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
  const notice = '';
  const message = '';
  const query = new URLSearchParams('');
  void query;

  const sammelnValue = player.sammeln_cooldown_until ? toDatetimeLocal(player.sammeln_cooldown_until) : '';
  const arbeitenValue = player.arbeiten_cooldown_until ? toDatetimeLocal(player.arbeiten_cooldown_until) : '';

  const optionsStarters = starters.map(starter => `
    <option value="${escapeHtml(starter.key)}" ${starter.key === player.pokemon_key ? 'selected' : ''}>${escapeHtml(starter.name)} (${escapeHtml(starter.key)})</option>
  `).join('');

  const optionsGuilds = guilds.map(guild => `
    <option value="${escapeHtml(guild.key)}" ${guild.key === player.guild_key ? 'selected' : ''}>${escapeHtml(guild.name)} (${escapeHtml(guild.key)})</option>
  `).join('');

  return `
    <div class="topbar">
      <div>
        <div class="title">Spielstand bearbeiten</div>
        <div class="subtitle"><a href="/admin">← Zur Übersicht</a> · ${escapeHtml(getStarterLabel(player))} · ${escapeHtml(getGuildLabel(player))}</div>
      </div>
      <div class="pill">ID ${player.id}</div>
    </div>
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
          <div class="subtitle">Nützlich, wenn ihr häufig neue Durchläufe testet.</div>
        </div>
      </div>
      <div class="actions">
        <form class="inline" method="post" action="/admin/player/${player.id}/reset-cooldowns">
          <button class="btn btn-warning" type="submit">Cooldowns dieses Spielers zurücksetzen</button>
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

function renderNoticeFromLocation() {
  return '';
}

function getStarterByKey(key) {
  return starters.find(starter => starter.key === key) || null;
}

function getGuildByKey(key) {
  return guilds.find(guild => guild.key === key) || null;
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
  const xpInLevel = Math.max(0, Number(player.xp || 0) - Math.max(0, (player.level - 1) * 20));
  return `${xpInLevel}/20 XP bis Level ${player.level + 1}`;
}

function renderCooldownTag(value, label) {
  if (!value) {
    return `<span class="muted">${escapeHtml(label)}: bereit</span>`;
  }

  const remaining = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return `<span class="muted">${escapeHtml(label)}: bereit</span>`;
  }

  return `<span class="pill">${escapeHtml(label)}: ${escapeHtml(formatDuration(remaining))}</span>`;
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
