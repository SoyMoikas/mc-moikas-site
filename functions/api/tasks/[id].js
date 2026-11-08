import { json, err, body, now } from "../../../lib/util.js";
import { getUser, hasRole, hasPerm, need } from "../../../lib/auth.js";
import { taskFields, setClause } from "../../../lib/fields.js";

// Task with its discussion thread.
export async function onRequestGet({ request, env, params }) {
  const user = await getUser(env, request);
  const task = await env.DB.prepare(
    `SELECT t.*, s.hidden AS server_hidden, u.username AS created_by_name
       FROM tasks t JOIN servers s ON s.id = t.server_id
       LEFT JOIN users u ON u.id = t.created_by
      WHERE t.id = ?`
  ).bind(params.id).first();
  if (!task || (task.server_hidden && !hasPerm(user, "servers"))) return err(404, "Task not found");
  delete task.server_hidden;

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, c.user_id, u.username, u.avatar, u.role, u.xp, u.eq_frame, u.eq_hat, u.eq_color
       FROM comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.task_id = ? ORDER BY c.created_at ASC LIMIT 500`
  ).bind(params.id).all();

  const isStaff = hasRole(user, "staff");
  const comments = results.map(({ user_id, ...c }) => ({
    ...c,
    can_delete: !!user && (isStaff || user_id === user.id),
  }));
  return json({ task, comments });
}

export async function onRequestPatch({ request, env, params }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = taskFields(b, { partial: true });
  if (!Object.keys(f).length) return err(400, "Nothing to update");
  f.updated_at = now();
  const { sql, values } = setClause(f);
  const res = await env.DB.prepare(`UPDATE tasks SET ${sql} WHERE id = ?`).bind(...values, params.id).run();
  if (!res.meta.changes) return err(404, "Task not found");
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const res = await env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(params.id).run();
  if (!res.meta.changes) return err(404, "Task not found");
  return json({ ok: true });
}
