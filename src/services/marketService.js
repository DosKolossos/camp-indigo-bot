const db = require('../db/database');
const { getItemDefinition } = require('../config/items');
const {
  RESOURCE_KEYS,
  addPlayerItem,
  removePlayerItem,
  canAffordResources,
  applyResourceDeltaToPlayer,
  getPlayerInventory
} = require('./inventoryService');

function parseStoredPrice(priceJson) {
  let parsed = {};

  try {
    parsed = JSON.parse(priceJson || '{}');
  } catch {
    parsed = {};
  }

  const normalized = {};
  for (const key of RESOURCE_KEYS) {
    const value = Number(parsed?.[key]) || 0;
    if (value > 0) {
      normalized[key] = value;
    }
  }

  return normalized;
}

function normalizePriceInput(price = {}) {
  const normalized = {};
  for (const key of RESOURCE_KEYS) {
    const value = Number(price?.[key]) || 0;
    if (value < 0) {
      throw new Error('Preise dürfen nicht negativ sein.');
    }
    if (value > 0) {
      normalized[key] = Math.floor(value);
    }
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error('Ein Angebot braucht mindestens einen Preisbestandteil.');
  }

  return normalized;
}

function hydrateListing(row) {
  if (!row) return null;

  return {
    ...row,
    item: getItemDefinition(row.item_key),
    price: parseStoredPrice(row.price_json)
  };
}

function getActiveListings({ viewerPlayerId = null, limit = 10 } = {}) {
  const rows = db.prepare(`
    SELECT
      ml.id,
      ml.seller_player_id,
      ml.item_key,
      ml.quantity,
      ml.price_json,
      ml.status,
      ml.buyer_player_id,
      ml.created_at,
      ml.updated_at,
      ml.sold_at,
      ml.cancelled_at,
      p.discord_username AS seller_name
    FROM market_listings ml
    JOIN players p ON p.id = ml.seller_player_id
    WHERE ml.status = 'active'
      ${viewerPlayerId ? 'AND ml.seller_player_id != ?' : ''}
    ORDER BY ml.created_at DESC
    LIMIT ?
  `).all(...(viewerPlayerId ? [viewerPlayerId, limit] : [limit]));

  return rows.map(hydrateListing);
}

function getPlayerListings(playerId, status = 'active', limit = 10) {
  const rows = db.prepare(`
    SELECT
      ml.id,
      ml.seller_player_id,
      ml.item_key,
      ml.quantity,
      ml.price_json,
      ml.status,
      ml.buyer_player_id,
      ml.created_at,
      ml.updated_at,
      ml.sold_at,
      ml.cancelled_at,
      p.discord_username AS seller_name
    FROM market_listings ml
    JOIN players p ON p.id = ml.seller_player_id
    WHERE ml.seller_player_id = ?
      AND ml.status = ?
    ORDER BY ml.created_at DESC
    LIMIT ?
  `).all(playerId, status, limit);

  return rows.map(hydrateListing);
}

function getListingById(listingId) {
  const row = db.prepare(`
    SELECT
      ml.id,
      ml.seller_player_id,
      ml.item_key,
      ml.quantity,
      ml.price_json,
      ml.status,
      ml.buyer_player_id,
      ml.created_at,
      ml.updated_at,
      ml.sold_at,
      ml.cancelled_at,
      p.discord_username AS seller_name,
      b.discord_username AS buyer_name
    FROM market_listings ml
    JOIN players p ON p.id = ml.seller_player_id
    LEFT JOIN players b ON b.id = ml.buyer_player_id
    WHERE ml.id = ?
  `).get(listingId);

  return hydrateListing(row);
}

const createListing = db.transaction(({ sellerPlayerId, itemKey, quantity, price }) => {
  const item = getItemDefinition(itemKey);
  if (!item) {
    throw new Error('Unbekanntes Markt-Item.');
  }

  const safeQuantity = Math.floor(Number(quantity) || 0);
  if (safeQuantity <= 0) {
    throw new Error('Die Angebotsmenge muss mindestens 1 sein.');
  }

  const normalizedPrice = normalizePriceInput(price);
  removePlayerItem(sellerPlayerId, itemKey, safeQuantity);

  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO market_listings (
      seller_player_id,
      item_key,
      quantity,
      price_json,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(
    sellerPlayerId,
    itemKey,
    safeQuantity,
    JSON.stringify(normalizedPrice),
    now,
    now
  );

  return getListingById(result.lastInsertRowid);
});

const cancelListing = db.transaction(({ listingId, sellerPlayerId }) => {
  const listing = getListingById(listingId);
  if (!listing || listing.status !== 'active') {
    throw new Error('Dieses Angebot ist nicht mehr aktiv.');
  }

  if (Number(listing.seller_player_id) !== Number(sellerPlayerId)) {
    throw new Error('Du kannst nur deine eigenen Angebote zurückziehen.');
  }

  addPlayerItem(sellerPlayerId, listing.item_key, listing.quantity);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE market_listings
    SET status = 'cancelled', cancelled_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, listingId);

  return getListingById(listingId);
});

const purchaseListing = db.transaction(({ listingId, buyerPlayerId }) => {
  const listing = getListingById(listingId);
  if (!listing || listing.status !== 'active') {
    throw new Error('Dieses Angebot wurde bereits gekauft oder entfernt.');
  }

  if (Number(listing.seller_player_id) === Number(buyerPlayerId)) {
    throw new Error('Du kannst dein eigenes Angebot nicht kaufen.');
  }

  const buyer = db.prepare(`SELECT * FROM players WHERE id = ?`).get(buyerPlayerId);
  const seller = db.prepare(`SELECT * FROM players WHERE id = ?`).get(listing.seller_player_id);

  if (!buyer || !seller) {
    throw new Error('Käufer oder Verkäufer wurde nicht gefunden.');
  }

  if (!canAffordResources(buyer, listing.price)) {
    throw new Error('Dir fehlen Ressourcen für diesen Kauf.');
  }

  const buyerDelta = Object.fromEntries(RESOURCE_KEYS.map(key => [key, -(Number(listing.price?.[key]) || 0)]));
  const sellerDelta = Object.fromEntries(RESOURCE_KEYS.map(key => [key, Number(listing.price?.[key]) || 0]));

  applyResourceDeltaToPlayer(buyerPlayerId, buyerDelta);
  applyResourceDeltaToPlayer(listing.seller_player_id, sellerDelta);
  addPlayerItem(buyerPlayerId, listing.item_key, listing.quantity);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE market_listings
    SET status = 'sold', buyer_player_id = ?, sold_at = ?, updated_at = ?
    WHERE id = ?
  `).run(buyerPlayerId, now, now, listingId);

  return getListingById(listingId);
});

function getMarketOverview(playerId) {
  return {
    activeListings: getActiveListings({ viewerPlayerId: playerId, limit: 10 }),
    ownListings: getPlayerListings(playerId, 'active', 10),
    inventory: getPlayerInventory(playerId)
  };
}

module.exports = {
  parseStoredPrice,
  normalizePriceInput,
  getActiveListings,
  getPlayerListings,
  getListingById,
  createListing,
  cancelListing,
  purchaseListing,
  getMarketOverview
};
