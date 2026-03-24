const db = require('../db/database');

function getState(key) {
  const row = db.prepare(`SELECT value FROM app_state WHERE key = ?`).get(key);
  return row?.value ?? null;
}

function setState(key, value) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, String(value), now);
}

module.exports = { getState, setState };
