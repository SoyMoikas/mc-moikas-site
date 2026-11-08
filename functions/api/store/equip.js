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
  await env.DB.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(b.item || null, user.id).run();
  return json({ ok: true });
}
