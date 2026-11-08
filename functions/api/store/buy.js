import { json, err, now } from "../../../../../lib/util.js";
import { need } from "../../../../../lib/auth.js";
import { coinsOf, ownedSet, owns, collectionOpen, bundlePrice, parseItem } from "../../../../../lib/catalog.js";

// Buy every item in a collection you don't own yet, at the bundle price for what's missing.
export async function onRequestPost({ request, env, params }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  const c = await env.DB.prepare("SELECT * FROM collections WHERE id = ?").bind(params.id).first();
  if (!c || !collectionOpen(c)) return err(404, "Collection not found");
  if (!c.price) return err(400, "This collection isn't sold as a bundle");

  const items = (await env.DB.prepare("SELECT * FROM store_items WHERE collection_id = ? AND active = 1").bind(c.id).all()).results.map(parseItem);
  const bought = await ownedSet(env, user.id);
  const ownedIds = new Set(items.filter((i) => owns(i, bought, user.xp)).map((i) => i.id));
  const price = bundlePrice(c, items, ownedIds);
  if (price === 0) return err(409, "Already owned");
  if (coinsOf(user) < price) return err(402, "Not enough coins");

  const res = await env.DB.prepare(
    "UPDATE users SET coins_spent = coins_spent + ?1 WHERE id = ?2 AND coins_earned - coins_spent >= ?1"
  ).bind(price, user.id).run();
  if (!res.meta.changes) return err(402, "Not enough coins");
  const t = now();
  const missing = items.filter((i) => !ownedIds.has(i.id));
  await env.DB.batch(missing.map((i) =>
    env.DB.prepare("INSERT OR IGNORE INTO user_items (user_id, item_id, created_at) VALUES (?, ?, ?)").bind(user.id, i.id, t)));
  return json({ ok: true, paid: price, items: missing.map((i) => i.id), coins: coinsOf(user) - price });
}
