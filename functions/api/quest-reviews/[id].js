import { notify } from "../../../lib/notify.js";
import { json, err, body, now, str } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";
import { recomputeXP } from "../../../lib/xp.js";

// Staff: { approve: true|false, note? }
export async function onRequestPost({ request, env, params }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const c = await env.DB.prepare(
    "SELECT c.user_id, COALESCE(q.title_es, q.title) AS title, q.xp, q.coins FROM quest_completions c JOIN quests q ON q.id = c.quest_id WHERE c.id = ? AND c.status = 'pending'"
  ).bind(params.id).first();
  if (!c) return err(404, "Submission not found");
  if (c.user_id === user.id && user.role !== "admin") return err(403, "You can't approve your own submission");

  await env.DB.prepare(
    "UPDATE quest_completions SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?"
  ).bind(b.approve ? "approved" : "rejected", str(b.note, 300, "note"), user.id, now(), params.id).run();
  await recomputeXP(env, c.user_id);
  await notify(env, [c.user_id], "quest", b.approve
    ? { title: `🎯 Misión completada: ${c.title}`, body: `+${c.xp || 0} XP${c.coins ? ` · +🪙 ${c.coins}` : ""}`, url: "/quests" }
    : { title: `↩️ Misión rechazada: ${c.title}`, body: str(b.note, 300, "note") || "Revisa la nota del staff e inténtalo otra vez.", url: "/quests" });
  return json({ ok: true });
}
