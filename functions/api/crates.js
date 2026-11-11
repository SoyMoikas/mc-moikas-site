import { need } from "../../lib/auth.js";
import { json, now, err } from "../../lib/util.js";
import { loadItems, ownedSet, owns, forSale, coinsOf } from "../../lib/catalog.js";
import { spend, award } from "../../lib/coins.js";

// Mystery crate: pay CRATE_PRICE, get a random store item you don't own yet.
// Rarity is by the item's store price; rarer tiers are less likely. Never a duplicate.
export const CRATE_PRICE = 120;
const TIERS = [
  { key: "common", max: 150, weight: 60 },
  { key: "rare", max: 400, weight: 28 },
  { key: "epic", max: 900, weight: 10 },
  { key: "legendary", max: Infinity, weight: 2 },
];
const tierOf = (price) => TIERS.find((t) => price <= t.max).key;
const SKIP = new Set(["part", "sticker"]); // avatar parts and stickers aren't fun crate prizes

async function pool(env, user) {
  const owned = await ownedSet(env, user.id);
  return (await loadItems(env)).filter((i) => forSale(i) && !SKIP.has(i.type) && !owns(i, owned, user.xp));
}

// GET /api/crates → price, odds, what's left to win, your last openings
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const left = await pool(env, me);
  const counts = Object.fromEntries(TIERS.map((t) => [t.key, left.filter((i) => tierOf(i.price) === t.key).length]));
  const recent = (await env.DB.prepare(
    `SELECT c.item_id, c.rarity, c.created_at, u.username FROM crate_opens c JOIN users u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 8`).all()).results;
  return json({ price: CRATE_PRICE, tiers: TIERS.map(({ key, weight }) => ({ key, weight, left: counts[key] })), left: left.length, coins: coinsOf(me), recent });
}

// POST /api/crates → open one
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const left = await pool(env, me);
  if (!left.length) return err(409, "You already own everything a crate could give you!");
  if (!(await spend(env, me.id, CRATE_PRICE))) return err(402, "Not enough coins");
  // pick a tier (only tiers that still have items), then an item in it
  const avail = TIERS.filter((t) => left.some((i) => tierOf(i.price) === t.key));
  let roll = Math.random() * avail.reduce((n, t) => n + t.weight, 0), tier = avail[0];
  for (const t of avail) { if ((roll -= t.weight) < 0) { tier = t; break; } }
  const choices = left.filter((i) => tierOf(i.price) === tier.key);
  const item = choices[Math.floor(Math.random() * choices.length)];
  const got = await env.DB.prepare("INSERT OR IGNORE INTO user_items (user_id, item_id, created_at) VALUES (?, ?, ?)").bind(me.id, item.id, now()).run();
  if (!got.meta.changes) { await award(env, me.id, "crate_refund", `${me.id}:${Date.now()}`, CRATE_PRICE); return err(409, "Something went wrong — coins refunded"); }
  await env.DB.prepare("INSERT INTO crate_opens (user_id, item_id, rarity, price, created_at) VALUES (?, ?, ?, ?, ?)").bind(me.id, item.id, tier.key, CRATE_PRICE, now()).run();
  return json({ item, rarity: tier.key, coins: coinsOf(me) - CRATE_PRICE });
}
