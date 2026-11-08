import { json, err, body, str, int, now } from "../../../../lib/util.js";
import { need } from "../../../../lib/auth.js";
import { loadItems, ownedSet, owns, coinsOf, levelOf, SLOTS } from "../../../../lib/catalog.js";

// Admin-only tools for testing the store: see/give/take coins and items for any user (yourself included).
// Coins: balance = coins_earned − coins_spent, and level-ups only recompute coins_earned,
// so gifts and removals adjust coins_spent (it can go negative = gifted coins).

async function snapshot(env, id) {
  const u = await env.DB.prepare(
    `SELECT id, username, xp, coins_earned, coins_spent, ${Object.values(SLOTS).join(", ")} FROM users WHERE id = ?`
  ).bind(id).first();
  if (!u) return null;
  const bought = await ownedSet(env, u.id);
  const items = (await loadItems(env, { includeInactive: true })).map((i) => ({
    id: i.id, type: i.type, name: i.name, name_es: i.name_es, visual: i.visual, price: i.price, reward_level: i.reward_level, active: i.active,
    bought: bought.has(i.id),
    from_level: !bought.has(i.id) && owns(i, new Set(), u.xp), // unlocked by level; can't be taken away
  }));
  const equipped = Object.fromEntries(Object.entries(SLOTS).map(([slot, col]) => [slot, u[col] || null]));
  return { user: { id: u.id, username: u.username, level: levelOf(u.xp), coins: coinsOf(u) }, items, equipped };
}

export async function onRequestGet({ request, env, params }) {
  const admin = await need(env, request, "admin");
  if (admin instanceof Response) return admin;
  const s = await snapshot(env, params.id);
  return s ? json(s) : err(404, "User not found");
}

// Body: { coins: +N | −N } · { set_coins: N } · { give: itemId } · { take: itemId }
export async function onRequestPost({ request, env, params }) {
  const admin = await need(env, request, "admin");
  if (admin instanceof Response) return admin;
  const b = await body(request);
  if (b instanceof Response) return b;
  const u = await env.DB.prepare("SELECT id, xp, coins_earned, coins_spent FROM users WHERE id = ?").bind(params.id).first();
  if (!u) return err(404, "User not found");
  const balance = coinsOf(u);

  if (b.coins !== undefined || b.set_coins !== undefined) {
    let target;
    if (b.set_coins !== undefined) target = int(b.set_coins, "set_coins", { min: 0, max: 1e9 });
    else { const d = int(b.coins, "coins", { min: -1e9, max: 1e9 }); if (d === null) return err(400, "Enter an amount"); target = Math.max(0, balance + d); }
    if (target === null || target === undefined) return err(400, "Enter an amount");
    // new spent so that earned − spent = target
    await env.DB.prepare("UPDATE users SET coins_spent = coins_earned - ? WHERE id = ?").bind(target, u.id).run();
  } else if (b.give) {
    const id = str(b.give, 40, "give");
    const exists = await env.DB.prepare("SELECT id FROM store_items WHERE id = ?").bind(id).first();
    if (!exists) return err(404, "Item not found");
    await env.DB.prepare("INSERT OR IGNORE INTO user_items (user_id, item_id, created_at) VALUES (?, ?, ?)").bind(u.id, id, now()).run();
  } else if (b.take) {
    const id = str(b.take, 40, "take");
    await env.DB.prepare("DELETE FROM user_items WHERE user_id = ? AND item_id = ?").bind(u.id, id).run();
    // Unequip it unless they still own it through their level.
    const item = await env.DB.prepare("SELECT type, reward_level FROM store_items WHERE id = ?").bind(id).first();
    const col = item && SLOTS[item.type];
    if (col && !(item.reward_level !== null && levelOf(u.xp) >= item.reward_level)) {
      await env.DB.prepare(`UPDATE users SET ${col} = NULL WHERE id = ? AND ${col} = ?`).bind(u.id, id).run();
    }
  } else return err(400, "Nothing to do");

  return json(await snapshot(env, u.id));
}
