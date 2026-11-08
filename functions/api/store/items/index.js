import { json, err, body, now } from "../../../../lib/util.js";
import { needPerm } from "../../../../lib/auth.js";
import { itemFields, visualFields } from "../../../../lib/catalog.js";

// Admin: add a store item.
export async function onRequestPost({ request, env }) {
  const user = await needPerm(env, request, "store");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = itemFields(b, { creating: true });
  const visual = JSON.stringify(visualFields(f.type, b.visual || {}));
  if (await env.DB.prepare("SELECT 1 FROM store_items WHERE id = ?").bind(f.id).first()) return err(409, "An item with that id already exists");
  const t = now();
  await env.DB.prepare(
    `INSERT INTO store_items (id, type, name, name_es, visual, price, level, reward_level, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(f.id, f.type, f.name, f.name_es, visual, f.price, f.level, f.reward_level, f.active, f.sort_order, t, t).run();
  return json({ id: f.id }, 201);
}
