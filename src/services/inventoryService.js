const db = require('../db/database');
const { getItemDefinition, getAllItemDefinitions } = require('../config/items');
const { EQUIPMENT_LABELS } = require('../config/crafting');

const RESOURCE_KEYS = ['wood', 'food', 'stone', 'ore', 'fiber', 'scrap'];

function getPlayerInventory(playerId) {
  return db.prepare(`
    SELECT item_key, quantity, created_at, updated_at
    FROM player_items
    WHERE player_id = ? AND quantity > 0
    ORDER BY item_key ASC
  `).all(playerId).map(row => ({
    ...row,
    item: getItemDefinition(row.item_key)
  }));
}

function getInventoryQuantity(playerId, itemKey) {
  const row = db.prepare(`
    SELECT quantity
    FROM player_items
    WHERE player_id = ? AND item_key = ?
  `).get(playerId, itemKey);

  return Number(row?.quantity) || 0;
}

function addPlayerItem(playerId, itemKey, quantity = 1) {
  const safeQuantity = Number(quantity) || 0;
  if (safeQuantity <= 0) {
    throw new Error('Ungültige Item-Menge.');
  }

  const item = getItemDefinition(itemKey);
  if (!item) {
    throw new Error(`Unbekanntes Item: ${itemKey}`);
  }

  const now = new Date().toISOString();
  const existing = db.prepare(`
    SELECT id, quantity
    FROM player_items
    WHERE player_id = ? AND item_key = ?
  `).get(playerId, itemKey);

  if (existing) {
    db.prepare(`
      UPDATE player_items
      SET quantity = quantity + ?, updated_at = ?
      WHERE id = ?
    `).run(safeQuantity, now, existing.id);
    return;
  }

  db.prepare(`
    INSERT INTO player_items (
      player_id,
      item_key,
      quantity,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(playerId, itemKey, safeQuantity, now, now);
}

function removePlayerItem(playerId, itemKey, quantity = 1) {
  const safeQuantity = Number(quantity) || 0;
  if (safeQuantity <= 0) {
    throw new Error('Ungültige Item-Menge.');
  }

  const currentQuantity = getInventoryQuantity(playerId, itemKey);
  if (currentQuantity < safeQuantity) {
    throw new Error('Nicht genug Items im Inventar.');
  }

  const now = new Date().toISOString();
  const remaining = currentQuantity - safeQuantity;

  if (remaining <= 0) {
    db.prepare(`
      DELETE FROM player_items
      WHERE player_id = ? AND item_key = ?
    `).run(playerId, itemKey);
    return;
  }

  db.prepare(`
    UPDATE player_items
    SET quantity = ?, updated_at = ?
    WHERE player_id = ? AND item_key = ?
  `).run(remaining, now, playerId, itemKey);
}

function canAffordResources(player, costs = {}) {
  return RESOURCE_KEYS.every(key => (Number(player?.[key]) || 0) >= (Number(costs?.[key]) || 0));
}

function applyResourceDeltaToPlayer(playerId, changes = {}) {
  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);
  if (!player) {
    throw new Error('Spieler nicht gefunden.');
  }

  for (const key of RESOURCE_KEYS) {
    const nextValue = (Number(player[key]) || 0) + (Number(changes[key]) || 0);
    if (nextValue < 0) {
      throw new Error(`Nicht genug ${key}.`);
    }
  }

  const nextValues = RESOURCE_KEYS.map(key => (Number(player[key]) || 0) + (Number(changes[key]) || 0));
  db.prepare(`
    UPDATE players
    SET wood = ?,
        food = ?,
        stone = ?,
        ore = ?,
        fiber = ?,
        scrap = ?,
        updated_at = ?
    WHERE id = ?
  `).run(...nextValues, new Date().toISOString(), playerId);
}

const craftMarketItem = db.transaction(({ playerId, itemKey }) => {
  const item = getItemDefinition(itemKey);
  if (!item) {
    throw new Error('Unbekanntes Item.');
  }

  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);
  if (!player) {
    throw new Error('Spieler nicht gefunden.');
  }

  if (!canAffordResources(player, item.recipe)) {
    throw new Error('Nicht genug Materialien für dieses Kit.');
  }

  const negativeChanges = Object.fromEntries(
    RESOURCE_KEYS.map(key => [key, -(Number(item.recipe?.[key]) || 0)])
  );

  applyResourceDeltaToPlayer(playerId, negativeChanges);
  addPlayerItem(playerId, itemKey, 1);

  return {
    item,
    player: db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId)
  };
});

const useInventoryItem = db.transaction(({ playerId, itemKey }) => {
  const item = getItemDefinition(itemKey);
  if (!item) {
    throw new Error('Unbekanntes Item.');
  }

  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);
  if (!player) {
    throw new Error('Spieler nicht gefunden.');
  }

  const currentTier = Number(player[item.targetField]) || 0;
  if (currentTier >= item.targetTier) {
    throw new Error('Dieses Kit bringt dir aktuell keinen Fortschritt.');
  }

  if (currentTier !== item.targetTier - 1) {
    throw new Error(
      `Du kannst ${item.label} erst nutzen, wenn deine ${EQUIPMENT_LABELS[item.targetField] || item.targetField} auf Stufe ${item.targetTier - 1} ist.`
    );
  }

  removePlayerItem(playerId, itemKey, 1);

  db.prepare(`
    UPDATE players
    SET ${item.targetField} = ?, updated_at = ?
    WHERE id = ?
  `).run(item.targetTier, new Date().toISOString(), playerId);

  return {
    item,
    player: db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId)
  };
});

function getCraftableMarketItems() {
  return getAllItemDefinitions();
}

function getUsableInventoryItems(playerId) {
  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);
  if (!player) {
    return [];
  }

  return getPlayerInventory(playerId).filter(entry => {
    const item = entry.item;
    if (!item) return false;
    const currentTier = Number(player[item.targetField]) || 0;
    return currentTier === item.targetTier - 1;
  });
}

module.exports = {
  RESOURCE_KEYS,
  getPlayerInventory,
  getInventoryQuantity,
  addPlayerItem,
  removePlayerItem,
  canAffordResources,
  applyResourceDeltaToPlayer,
  craftMarketItem,
  useInventoryItem,
  getCraftableMarketItems,
  getUsableInventoryItems
};