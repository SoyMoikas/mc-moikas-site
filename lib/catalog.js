// Store catalog. Prices are in coins (1 coin per 10 XP earned; spending never lowers your level).
// Price 0 = free for everyone who reaches `level`. Names/visuals live in public/js/cosmetics.js + i18n.js.
// To add an item: add it here AND in public/js/cosmetics.js (visual) AND i18n.js ("item.<id>").

export const COINS_PER_XP = 10; // 10 XP = 1 coin
export const XP_FACTOR = 30;    // must match public/js/levels.js
export const levelOf = (xp) => Math.floor(Math.sqrt(Math.max(0, xp || 0) / XP_FACTOR));

export const CATALOG = [
  // avatar frames
  { id: "frame_stone", type: "frame", price: 50, level: 0 },
  { id: "frame_gold", type: "frame", price: 250, level: 3 },
  { id: "frame_emerald", type: "frame", price: 400, level: 5 },
  { id: "frame_diamond", type: "frame", price: 600, level: 8 },
  { id: "frame_ember", type: "frame", price: 900, level: 12 },
  { id: "frame_rainbow", type: "frame", price: 1000, level: 15 },
  { id: "frame_legend", type: "frame", price: 0, level: 30 },
  // hats / accessories (shown on the avatar)
  { id: "hat_party", type: "hat", price: 80, level: 0 },
  { id: "hat_cap", type: "hat", price: 120, level: 0 },
  { id: "hat_flower", type: "hat", price: 120, level: 0 },
  { id: "hat_tophat", type: "hat", price: 250, level: 3 },
  { id: "hat_grad", type: "hat", price: 300, level: 5 },
  { id: "hat_star", type: "hat", price: 350, level: 5 },
  { id: "hat_fire", type: "hat", price: 500, level: 8 },
  { id: "hat_halo", type: "hat", price: 600, level: 10 },
  { id: "hat_crown", type: "hat", price: 1200, level: 15 },
  // name colors
  { id: "color_sky", type: "color", price: 100, level: 0 },
  { id: "color_lime", type: "color", price: 100, level: 0 },
  { id: "color_pink", type: "color", price: 150, level: 0 },
  { id: "color_orange", type: "color", price: 150, level: 0 },
  { id: "color_gold", type: "color", price: 400, level: 5 },
  { id: "color_purple", type: "color", price: 400, level: 5 },
  { id: "color_rainbow", type: "color", price: 1000, level: 15 },
  // chat stickers
  { id: "st_gg", type: "sticker", price: 0, level: 0 },
  { id: "st_heart", type: "sticker", price: 0, level: 0 },
  { id: "st_hi", type: "sticker", price: 0, level: 0 },
  { id: "st_brb", type: "sticker", price: 40, level: 0 },
  { id: "st_pick", type: "sticker", price: 40, level: 0 },
  { id: "st_lol", type: "sticker", price: 50, level: 0 },
  { id: "st_sad", type: "sticker", price: 50, level: 0 },
  { id: "st_sleep", type: "sticker", price: 50, level: 0 },
  { id: "st_gem", type: "sticker", price: 60, level: 0 },
  { id: "st_swords", type: "sticker", price: 60, level: 0 },
  { id: "st_fire", type: "sticker", price: 60, level: 0 },
  { id: "st_alv", type: "sticker", price: 60, level: 0 },
  { id: "st_skull", type: "sticker", price: 80, level: 2 },
  { id: "st_cake", type: "sticker", price: 80, level: 2 },
  { id: "st_party", type: "sticker", price: 80, level: 2 },
  { id: "st_rip", type: "sticker", price: 100, level: 3 },
  { id: "st_trophy", type: "sticker", price: 200, level: 5 },
];

export const ITEMS = Object.fromEntries(CATALOG.map((i) => [i.id, i]));
export const SLOTS = { frame: "eq_frame", hat: "eq_hat", color: "eq_color" };

export const coinsOf = (u) => Math.max(0, Math.floor((u.xp || 0) / COINS_PER_XP) - (u.coins_spent || 0));

// Owns it if bought, or if it's free and the level is reached.
export function owns(item, ownedIds, xp) {
  if (!item) return false;
  if (item.price === 0) return levelOf(xp) >= item.level;
  return ownedIds.has(item.id);
}

export async function ownedSet(env, userId) {
  const { results } = await env.DB.prepare("SELECT item_id FROM user_items WHERE user_id = ?").bind(userId).all();
  return new Set(results.map((r) => r.item_id));
}

export const STICKER_RE = /^\[\[sticker:([a-z0-9_]{1,40})\]\]$/;
