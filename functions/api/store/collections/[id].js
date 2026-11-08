import { json, err, body, now } from "../../../../lib/util.js";
import { needPerm } from "../../../../lib/auth.js";
import { collectionFields } from "../../../../lib/catalog.js";
import { setClause } from "../../../../lib/fields.js";

export async function onRequestPatch({ request, env, params }) {
  const user = await needPerm(env, request, "store");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = collectionFields(b);
  f.updated_at = now();
  const { sql, values } = setClause(f);
  const res = await env.DB.prepare(`UPDATE collections SET ${sql} WHERE id = ?`).bind(...values, params.id).run();
  if (!res.meta.changes) return err(404, "Collection not found");
  return json({ ok: true });
}

// Deleting a collection keeps its items (they just leave the pack).
export async function onRequestDelete({ request, env, params }) {
  const user = await needPerm(env, request, "store");
  if (user instanceof Response) return user;
  const res = await env.DB.batch([
    env.DB.prepare("DELETE FROM collections WHERE id = ?").bind(params.id),
    env.DB.prepare("UPDATE store_items SET collection_id = NULL WHERE collection_id = ?").bind(params.id),
  ]);
  if (!res[0].meta.changes) return err(404, "Collection not found");
  return json({ ok: true });
}
