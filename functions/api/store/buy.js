import { json, err, body, now, str } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";
import { getItem, coinsOf, levelOf, ownedSet, owns, forSale, collectionOpen } from "../../../lib/catalog.js";

// { item } — spend coins on an item. Approved members and up.
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const item = await getItem(env, str(b.item, 40, "item") || "");
  if (!item || !item.active) return err(404, "Item not found");
  if (owns(item, await ownedSet(env, user.id), user.xp)) return err(409, "Already owned");
  if (!forSale(item)) return err(400, "Not for sale");
  if (item.collection_id) {
    const c = await env.DB.prepare("SELECT * FROM collections WHERE id = ?").bind(item.collection_id).first();
    if (c && !collectionOpen(c)) return err(400, "This collection isn't available right now");
  }
  if (levelOf(user.xp) < item.level) return err(403, "Level too low");
  if (coinsOf(user) < item.price) return err(402, "Not enough coins");

  // Charge only if the balance still covers it at write time (guards against double clicks).
  const res = await env.DB.prepare(
    `UPDATE users SET coins_spent = coins_spent + ?1
      WHERE id = ?2 AND coins_earned - coins_spent >= ?1
        AND NOT EXISTS (SELECT 1 FROM user_items WHERE user_id = ?2 AND item_id = ?3)`
  ).bind(item.price, user.id, item.id).run();
  if (!res.meta.changes) return err(402, "Not enough coins");
  await env.DB.prepare("INSERT OR IGNORE INTO user_items (user_id, item_id, created_at) VALUES (?, ?, ?)")
    .bind(user.id, item.id, now()).run();
  return json({ ok: true, coins: coinsOf(user) - item.price });
}
