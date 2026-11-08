import { json, err, body, now, str } from "../../../../lib/util.js";
import { need } from "../../../../lib/auth.js";

// Member submits a manual quest for staff review: { proof } (text or link).
export async function onRequestPost({ request, env, params }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const proof = str(b.proof, 1000, "proof");

  const q = await env.DB.prepare("SELECT kind, active FROM quests WHERE id = ?").bind(params.id).first();
  if (!q || !q.active) return err(404, "Quest not found");
  if (q.kind !== "manual") return err(400, "This quest completes automatically");

  const existing = await env.DB.prepare("SELECT status FROM quest_completions WHERE quest_id = ? AND user_id = ?").bind(params.id, user.id).first();
  if (existing?.status === "approved") return err(409, "Already completed");
  if (existing?.status === "pending") return err(409, "Already submitted");

  // New submission, or resubmission after a rejection.
  await env.DB.prepare(
    `INSERT INTO quest_completions (quest_id, user_id, status, proof, created_at) VALUES (?, ?, 'pending', ?, ?)
     ON CONFLICT(quest_id, user_id) DO UPDATE SET status = 'pending', proof = excluded.proof, review_note = NULL,
       reviewed_by = NULL, reviewed_at = NULL, created_at = excluded.created_at`
  ).bind(params.id, user.id, proof, now()).run();
  return json({ ok: true }, 201);
}
