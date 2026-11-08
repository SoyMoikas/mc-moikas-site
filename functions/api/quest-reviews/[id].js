import { json, err, body, now, str } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";
import { recomputeXP } from "../../../lib/xp.js";

// Staff: { approve: true|false, note? }
export async function onRequestPost({ request, env, params }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const c = await env.DB.prepare("SELECT user_id FROM quest_completions WHERE id = ? AND status = 'pending'").bind(params.id).first();
  if (!c) return err(404, "Submission not found");
  if (c.user_id === user.id && user.role !== "admin") return err(403, "You can't approve your own submission");

  await env.DB.prepare(
    "UPDATE quest_completions SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?"
  ).bind(b.approve ? "approved" : "rejected", str(b.note, 300, "note"), user.id, now(), params.id).run();
  await recomputeXP(env, c.user_id);
  return json({ ok: true });
}
