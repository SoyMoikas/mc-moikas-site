import { json, err, body, str } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";
import { SLOTS, getItem, ownedSet, owns } from "../../../lib/catalog.js";

// { slot: "frame"|"hat"|"color", item: id | null } — null takes it off.
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "pending");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const col = SLOTS[b.slot];
  if (!col) return err(400, "Invalid slot");
  if (b.item) {
    const item = await getItem(env, str(b.item, 40, "item"));
    if (!item || item.type !== b.slot) return err(400, "Item doesn't fit that slot");
    if (!owns(item, await ownedSet(env, user.id), user.xp)) return err(403, "You don't own that");
  }
  // A new hat starts from its default placement (your adjusted fit belonged to the old one).
  const extra = b.slot === "hat" && (b.item || null) !== user.eq_hat ? ", hat_fit = NULL" : "";
  await env.DB.prepare(`UPDATE users SET ${col} = ?${extra} WHERE id = ?`).bind(b.item || null, user.id).run();
  if (b.slot === "hat" && b.item && user.acc_extra) await dropExtra(env, user, b.item); // can't wear the same one twice
  return json({ ok: true });
}

// Remove an accessory from the extra-accessories list (users.acc_extra).
export async function dropExtra(env, user, id) {
  let list = [];
  try { list = JSON.parse(user.acc_extra || "[]"); } catch { /* bad json */ }
  const next = list.filter((a) => a?.id !== id);
  if (next.length !== list.length)
    await env.DB.prepare("UPDATE users SET acc_extra = ? WHERE id = ?").bind(next.length ? JSON.stringify(next) : null, user.id).run();
}
