import { json, err } from "../../../lib/util.js";
import { need, hasRole } from "../../../lib/auth.js";

// Authors can delete their own comments; staff can delete any.
export async function onRequestDelete({ request, env, params }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  const c = await env.DB.prepare("SELECT user_id FROM comments WHERE id = ?").bind(params.id).first();
  if (!c) return err(404, "Comment not found");
  if (c.user_id !== user.id && !hasRole(user, "staff")) return err(403, "Not allowed");
  await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
