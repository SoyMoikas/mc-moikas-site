import { json, err, body, now } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";
import { postFields, setClause } from "../../../lib/fields.js";

export async function onRequestPatch({ request, env, params }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = postFields(b, { partial: true });
  if (!Object.keys(f).length) return err(400, "Nothing to update");
  f.updated_at = now();
  const { sql, values } = setClause(f);
  const res = await env.DB.prepare(`UPDATE posts SET ${sql} WHERE id = ?`).bind(...values, params.id).run();
  if (!res.meta.changes) return err(404, "Post not found");
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const res = await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(params.id).run();
  if (!res.meta.changes) return err(404, "Post not found");
  return json({ ok: true });
}
