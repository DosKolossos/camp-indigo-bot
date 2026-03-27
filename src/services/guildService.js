const defaultGuilds = require('../config/guilds');
const { getState, setState } = require('./stateService');

const GUILDS_STATE_KEY = 'guilds_config_json';

function normalizeColor(value, fallback = 0x5865f2) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  const raw = String(value ?? '').trim();
  if (!raw) return fallback;

  const normalized = raw.startsWith('#')
    ? raw.slice(1)
    : raw.startsWith('0x')
      ? raw.slice(2)
      : raw;

  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function normalizeGuild(input, fallback = {}) {
  const key = String(input?.key ?? fallback.key ?? '').trim().toLowerCase();
  const name = String(input?.name ?? fallback.name ?? '').trim();
  const emoji = String(input?.emoji ?? fallback.emoji ?? '🏳️').trim() || '🏳️';
  const description = String(input?.description ?? fallback.description ?? '').trim();
  const roleName = String(input?.roleName ?? input?.role_name ?? fallback.roleName ?? name).trim() || name;

  return {
    key,
    name,
    emoji,
    description,
    color: normalizeColor(input?.color, normalizeColor(fallback.color, 0x5865f2)),
    roleName,
    chatChannelId: input?.chatChannelId ?? input?.chat_channel_id ?? fallback.chatChannelId ?? null,
    progressChannelId: input?.progressChannelId ?? input?.progress_channel_id ?? fallback.progressChannelId ?? null
  };
}

function normalizeGuildList(items) {
  const seen = new Set();
  const normalized = [];

  for (const item of Array.isArray(items) ? items : []) {
    const guild = normalizeGuild(item);
    if (!guild.key || !guild.name || seen.has(guild.key)) continue;
    seen.add(guild.key);
    normalized.push(guild);
  }

  if (normalized.length === 0) {
    return defaultGuilds.map(item => normalizeGuild(item, item));
  }

  return normalized;
}

function getGuilds() {
  const raw = getState(GUILDS_STATE_KEY);

  if (!raw) {
    return defaultGuilds.map(item => normalizeGuild(item, item));
  }

  try {
    return normalizeGuildList(JSON.parse(raw));
  } catch (error) {
    console.warn('Gilden-Konfiguration konnte nicht geparst werden, Default wird verwendet.', error);
    return defaultGuilds.map(item => normalizeGuild(item, item));
  }
}

function saveGuilds(guilds) {
  const normalized = normalizeGuildList(guilds);
  setState(GUILDS_STATE_KEY, JSON.stringify(normalized));
  return normalized;
}

function getGuildByKey(key) {
  return getGuilds().find(guild => guild.key === key) || null;
}

function upsertGuild(input) {
  const existing = getGuilds();
  const nextGuild = normalizeGuild(input);

  if (!nextGuild.key || !nextGuild.name) {
    throw new Error('Gilde braucht mindestens key und name.');
  }

  const index = existing.findIndex(item => item.key === nextGuild.key);
  if (index >= 0) {
    existing[index] = {
      ...existing[index],
      ...nextGuild
    };
  } else {
    existing.push(nextGuild);
  }

  return saveGuilds(existing);
}

function deleteGuildByKey(key) {
  const guilds = getGuilds().filter(item => item.key !== key);
  return saveGuilds(guilds);
}

module.exports = {
  getGuilds,
  getGuildByKey,
  saveGuilds,
  upsertGuild,
  deleteGuildByKey,
  normalizeColor
};
