// Store items live in the `store_items` table (managed from Admin → Store).
// Coins come only from level-ups (coins_base + coins_per_level × level, for each level reached) and quests.
import { HttpError, str, int } from "./util.js";

export const XP_FACTOR = 30; // must match public/js/levels.js
export const levelOf = (xp) => Math.floor(Math.sqrt(Math.max(0, xp || 0) / XP_FACTOR));
export const TYPES = ["frame", "hat", "color", "font", "textstyle", "sticker", "banner", "wallpaper"];
export const SLOTS = { frame: "eq_frame", hat: "eq_hat", color: "eq_color", font: "eq_font", textstyle: "eq_text", banner: "eq_banner", wallpaper: "eq_wallpaper" };
// Self-hosted fonts in public/fonts (must match FONTS in public/app/cosmetics.js) and text effects.
export const FONTS = ["default", "marker", "spray", "graffiti", "bubbles", "bungee", "shade", "bangers", "pixel", "arcade", "creepy", "script", "neon", "glitch"];
export const EFFECTS = ["none", "solid", "gradient", "rainbow", "glow", "graffiti", "3d"];
export const STICKER_RE = /^\[\[sticker:([a-z0-9_]{1,40})\]\]$/;

export async function getSettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all().catch(() => ({ results: [] }));
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { coins_base: Number(s.coins_base ?? 20), coins_per_level: Number(s.coins_per_level ?? 5) };
}

// Total coins from reaching `level` (sum of each level's reward).
export const levelCoins = (level, s) => level <= 0 ? 0 : s.coins_base * level + s.coins_per_level * (level * (level + 1)) / 2;
export const rewardForLevel = (level, s) => s.coins_base + s.coins_per_level * level;

export const coinsOf = (u) => Math.max(0, (u.coins_earned || 0) - (u.coins_spent || 0));

export function parseItem(r) {
  let visual = {};
  try { visual = JSON.parse(r.visual || "{}"); } catch { /* bad json → empty */ }
  return { ...r, visual, price: r.price ?? null, reward_level: r.reward_level ?? null };
}

export async function loadItems(env, { includeInactive = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM store_items ${includeInactive ? "" : "WHERE active = 1"} ORDER BY type, sort_order, COALESCE(price, 0), id`
  ).all();
  return results.map(parseItem);
}

export async function getItem(env, id) {
  const r = await env.DB.prepare("SELECT * FROM store_items WHERE id = ?").bind(id).first();
  return r ? parseItem(r) : null;
}

export async function ownedSet(env, userId) {
  const { results } = await env.DB.prepare("SELECT item_id FROM user_items WHERE user_id = ?").bind(userId).all();
  return new Set(results.map((r) => r.item_id));
}

// Owned if bought, or if it's a level reward and you've reached that level.
export function owns(item, bought, xp) {
  if (!item) return false;
  if (bought.has(item.id)) return true;
  return item.reward_level !== null && levelOf(xp) >= item.reward_level;
}

export const forSale = (item) => item.active && item.price !== null && item.price > 0;

// ---- collections (themed packs) ----
// A collection is available when active and inside its optional start/end window.
export const collectionOpen = (c, t = Date.now()) => !!c && c.active && (!c.starts_at || t >= c.starts_at) && (!c.ends_at || t < c.ends_at);

export async function loadCollections(env, { includeHidden = false } = {}) {
  const { results } = await env.DB.prepare("SELECT * FROM collections ORDER BY featured DESC, sort_order, created_at DESC").all().catch(() => ({ results: [] }));
  const t = Date.now();
  return includeHidden ? results : results.filter((c) => collectionOpen(c, t));
}

// Bundle price for what you're missing: full price × missing / total (rounded up, minimum 1).
export function bundlePrice(c, items, owned) {
  if (!c.price || !items.length) return null;
  const missing = items.filter((i) => !owned.has(i.id)).length;
  if (!missing) return 0;
  return Math.max(1, Math.ceil((c.price * missing) / items.length));
}

export function collectionFields(b, { creating = false } = {}) {
  const out = {};
  if (creating) {
    out.id = str(b.id, 40, "id");
    if (!out.id || !/^[a-z0-9_-]{2,40}$/.test(out.id)) throw new HttpError(400, "Collection id: 2–40 lowercase letters, numbers, - or _");
  }
  out.name = str(b.name, 60, "name");
  if (!out.name) throw new HttpError(400, "Name is required");
  out.name_es = str(b.name_es, 60, "name_es");
  out.description = str(b.description, 400, "description");
  out.description_es = str(b.description_es, 400, "description_es");
  out.icon = str(b.icon, 16, "icon");
  out.color = str(b.color, 7, "color");
  if (out.color && !HEX.test(out.color)) throw new HttpError(400, "Color must look like #ff8800");
  out.price = int(b.price, "price", { min: 1, max: 1e7 });
  out.featured = b.featured ? 1 : 0;
  out.active = b.active === false || b.active === 0 ? 0 : 1;
  const ts = (v, f) => { if (v === null || v === undefined || v === "") return null; const n = typeof v === "number" ? v : Date.parse(v); if (!Number.isFinite(n)) throw new HttpError(400, `${f} is not a valid date`); return n; };
  out.starts_at = ts(b.starts_at, "starts_at");
  out.ends_at = ts(b.ends_at, "ends_at");
  if (out.starts_at && out.ends_at && out.ends_at <= out.starts_at) throw new HttpError(400, "End must be after start");
  out.sort_order = int(b.sort_order, "sort_order") ?? 0;
  return out;
}

// ---- admin editing ----
const HEX = /^#[0-9a-f]{6}$/i;
const FRAME_STYLES = ["solid", "glow", "pulse", "rainbow", "shimmer"];

export function itemFields(b, { creating = false } = {}) {
  const out = {};
  if (creating) {
    out.id = str(b.id, 40, "id");
    if (!out.id || !/^[a-z0-9_]{2,40}$/.test(out.id)) throw new HttpError(400, "Item id: 2–40 lowercase letters, numbers or _");
    if (!TYPES.includes(b.type)) throw new HttpError(400, "Invalid type");
    out.type = b.type;
  }
  out.name = str(b.name, 60, "name");
  if (!out.name) throw new HttpError(400, "Name is required");
  out.name_es = str(b.name_es, 60, "name_es");
  out.price = int(b.price, "price", { min: 1, max: 1e7 });          // null = not for sale
  out.level = 0; // no level gate on buying anymore; levels unlock items through reward_level
  out.reward_level = int(b.reward_level, "reward_level", { min: 0, max: 1000 }); // null = not a reward
  out.active = b.active === false || b.active === 0 ? 0 : 1;
  out.sort_order = int(b.sort_order, "sort_order") ?? 0;
  out.collection_id = str(b.collection_id, 40, "collection_id");
  return out;
}

// Validates the look of an item for its type.
export function visualFields(type, v = {}) {
  const out = {};
  const emoji = str(v.emoji, 16, "emoji");
  const text = str(v.text, 8, "text");
  const image = str(v.image, 400, "image");
  const color = str(v.color, 7, "color");
  if (image && !/^https:\/\/[^\s"'<>]+$/i.test(image)) throw new HttpError(400, "Image must be an https:// link");
  if (color && !HEX.test(color)) throw new HttpError(400, "Color must look like #ff8800");

  if (type === "frame") {
    out.style = FRAME_STYLES.includes(v.style) ? v.style : "solid";
    if (out.style !== "rainbow") { if (!color) throw new HttpError(400, "Pick a color"); out.color = color; }
  } else if (type === "color") {
    out.style = v.style === "rainbow" ? "rainbow" : v.style === "glow" ? "glow" : "solid";
    if (out.style !== "rainbow") { if (!color) throw new HttpError(400, "Pick a color"); out.color = color; }
  } else if (type === "hat") {
    if (v.halo) out.halo = true;
    else if (image) out.image = image;
    else if (emoji) out.emoji = emoji;
    else throw new HttpError(400, "Add an emoji or image");
  } else if (type === "banner" || type === "wallpaper") {
    // gradient (color → color2), a pattern, or an image; optionally animated
    const color2 = str(v.color2, 7, "color2");
    if (color2 && !HEX.test(color2)) throw new HttpError(400, "Color must look like #ff8800");
    if (image) out.image = image;
    if (!color && !image) throw new HttpError(400, "Pick a color or add an image");
    if (color) out.color = color;
    if (color2) out.color2 = color2;
    out.pattern = ["none", "dots", "grid", "stripes", "blocks", "bricks"].includes(v.pattern) ? v.pattern : "none";
    if (v.animate) out.animate = true;
  } else if (type === "font" || type === "textstyle") {
    // a font, plus an optional effect: solid color, gradient, rainbow, neon glow, graffiti (outlined + drop shadow), 3D
    out.font = FONTS.includes(v.font) ? v.font : "default";
    out.effect = EFFECTS.includes(v.effect) ? v.effect : "none";
    const color2 = str(v.color2, 7, "color2");
    if (color2 && !HEX.test(color2)) throw new HttpError(400, "Color must look like #ff8800");
    if (!["none", "rainbow"].includes(out.effect)) {
      if (!color) throw new HttpError(400, "Pick a color");
      out.color = color;
      if (color2) out.color2 = color2;
    }
    if (v.animate && ["gradient", "rainbow", "graffiti"].includes(out.effect)) out.animate = true;
    if (out.font === "default" && out.effect === "none") throw new HttpError(400, "Pick a font or an effect");
  } else if (type === "sticker") {
    if (image) out.image = image;
    else if (text) out.text = text.toUpperCase();
    else if (emoji) out.emoji = emoji;
    else throw new HttpError(400, "Add an emoji, short text, or image");
  }
  return out;
}
