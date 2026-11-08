import { json, err, body, now, str, HttpError } from "../../../../lib/util.js";
import { need, hasPerm } from "../../../../lib/auth.js";

// Approved members and up can comment.
export async function onRequestPost({ request, env, params }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  const b = await body(request, 16 * 1024);
  if (b instanceof Response) return b;
  const text = str(b.body, 2000, "comment");
  if (!text) throw new HttpError(400, "Comment can't be empty");

  const task = await env.DB.prepare("SELECT t.id FROM tasks t JOIN servers s ON s.id = t.server_id WHERE t.id = ? AND (s.hidden = 0 OR ? = 1)")
    .bind(params.id, hasPerm(user, "servers") ? 1 : 0).first();
  if (!task) return err(404, "Task not found");

  // Basic flood control: max 10 comments per user per minute.
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > ?")
    .bind(user.id, now() - 60_000).first();
  if (recent.n >= 10) return err(429, "Slow down a little");

  const t = now();
  const res = await env.DB.batch([
    env.DB.prepare("INSERT INTO comments (task_id, user_id, body, created_at) VALUES (?, ?, ?, ?)").bind(params.id, user.id, text, t),
    env.DB.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").bind(t, params.id),
  ]);
  return json({ id: res[0].meta.last_row_id }, 201);
}
