import { json, err, body, now, str } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";
import { taskFields } from "../../../lib/fields.js";

// Staff: create a task on a server.
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;

  const serverId = str(b.server_id, 40, "server_id");
  if (!serverId || !(await env.DB.prepare("SELECT 1 FROM servers WHERE id = ?").bind(serverId).first())) {
    return err(404, "Server not found");
  }
  const f = taskFields(b);
  const t = now();
  const res = await env.DB.prepare(
    `INSERT INTO tasks (server_id, title, body, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(serverId, f.title, f.body, f.status, user.id, t, t).run();
  return json({ id: res.meta.last_row_id }, 201);
}
