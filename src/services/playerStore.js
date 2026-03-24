const fs = require('fs');
const path = require('path');

const dataDir = path.join(process.cwd(), 'data');
const filePath = path.join(dataDir, 'players.json');

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ players: [] }, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getPlayer(discordUserId) {
  const store = readStore();
  return store.players.find(player => player.discordUserId === discordUserId) || null;
}

function upsertPlayer(playerData) {
  const store = readStore();
  const index = store.players.findIndex(player => player.discordUserId === playerData.discordUserId);

  if (index >= 0) {
    store.players[index] = { ...store.players[index], ...playerData };
  } else {
    store.players.push(playerData);
  }

  writeStore(store);
}

module.exports = {
  getPlayer,
  upsertPlayer
};