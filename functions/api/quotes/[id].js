import { need, hasRole } from "../../../lib/auth.js";
import { json, body, now, err } from "../../../lib/util.js";

// POST /api/quotes/:id {action: "vote"} (toggle) | {action: "delete"} (staff, or whoever saved it / said it)
export async function onRequestPost({ env, request, params }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const q = await env.DB.prepare("SELECT * FROM quotes WHERE id = ?").bind(params.id).first();
  if (!q) return err(404, "Not found");
  if (b.action === "vote") {
    const del = await env.DB.prepare("DELETE FROM quote_votes WHERE quote_id = ? AND user_id = ?").bind(q.id, me.id).run();
    if (!del.meta.changes) await env.DB.prepare("INSERT INTO quote_votes (quote_id, user_id, created_at) VALUES (?, ?, ?)").bind(q.id, me.id, now()).run();
  } else if (b.action === "delete") {
    if (!(hasRole(me, "staff") || me.id === q.saved_by || me.id === q.author_id)) return err(403, "Not allowed");
    await env.DB.prepare("DELETE FROM quotes WHERE id = ?").bind(q.id).run();
  } else return err(400, "Bad action");
  return json({ ok: true });
}
