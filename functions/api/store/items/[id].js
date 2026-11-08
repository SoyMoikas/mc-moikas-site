import { json, err, body, now } from "../../../../lib/util.js";
import { need } from "../../../../lib/auth.js";
import { getItem, itemFields, visualFields, SLOTS } from "../../../../lib/catalog.js";

// Admin: edit an item (type and id can't change).
export async function onRequestPatch({ request, env, params }) {
  const user = await need(env, request, "admin");
  if (user instanceof Response) return user;
  const item = await getItem(env, params.id);
  if (!item) return err(404, "Item not found");
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = itemFields(b);
  const visual = JSON.stringify(visualFields(item.type, b.visual || {}));
  await env.DB.prepare(
    `UPDATE store_items SET name = ?, name_es = ?, visual = ?, price = ?, level = ?, reward_level = ?, active = ?, sort_order = ?, updated_at = ?
      WHERE id = ?`
  ).bind(f.name, f.name_es, visual, f.price, f.level, f.reward_level, f.active, f.sort_order, now(), params.id).run();
  return json({ ok: true });
}

// Admin: delete an item. Owners lose it and it's taken off anyone wearing it. Coins aren't refunded.
export async function onRequestDelete({ request, env, params }) {
  const user = await need(env, request, "admin");
  if (user instanceof Response) return user;
  const item = await getItem(env, params.id);
  if (!item) return err(404, "Item not found");
  const stmts = [
    env.DB.prepare("DELETE FROM store_items WHERE id = ?").bind(params.id),
    env.DB.prepare("DELETE FROM user_items WHERE item_id = ?").bind(params.id),
  ];
  const col = SLOTS[item.type];
  if (col) stmts.push(env.DB.prepare(`UPDATE users SET ${col} = NULL WHERE ${col} = ?`).bind(params.id));
  await env.DB.batch(stmts);
  return json({ ok: true });
}
