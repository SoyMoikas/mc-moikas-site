import { json, err } from "../../../lib/util.js";
import { need, hasRole } from "../../../lib/auth.js";

export async function onRequestDelete({ request, env, params }) {
  const viewer = await need(env, request, "member");
  if (viewer instanceof Response) return viewer;
  const c = await env.DB.prepare("SELECT user_id FROM social_comments WHERE id = ?").bind(params.id).first();
  if (!c) return err(404, "Comment not found");
  if (c.user_id !== viewer.id && !hasRole(viewer, "staff")) return err(403, "Not allowed");
  await env.DB.prepare("DELETE FROM social_comments WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
