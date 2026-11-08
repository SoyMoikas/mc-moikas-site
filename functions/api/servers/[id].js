import { json, err, body, now } from "../../../lib/util.js";
import { getUser, hasPerm, needPerm } from "../../../lib/auth.js";
import { mergeServer, SERVER_SELECT, splitRow } from "../../../lib/servers.js";
import { serverFields, setClause } from "../../../lib/fields.js";

// Full server page: info + announcements + tasks.
export async function onRequestGet({ request, env, params }) {
  const user = await getUser(env, request);
  const admin = hasPerm(user, "servers");
  const r = await env.DB.prepare(`${SERVER_SELECT} WHERE s.id = ?`).bind(params.id).first();
  if (!r || (r.hidden && !admin)) return err(404, "Server not found");

  const [posts, tasks] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.title, p.body, p.tag, p.event_at, p.pinned, p.created_at, p.updated_at,
              u.username AS author, u.avatar AS author_avatar, u.xp AS author_xp, u.eq_frame AS author_frame, u.eq_hat AS author_hat, u.eq_color AS author_color
         FROM posts p LEFT JOIN users u ON u.id = p.author_id
        WHERE p.server_id = ? ORDER BY p.pinned DESC, p.created_at DESC LIMIT 50`
    ).bind(params.id),
    env.DB.prepare(
      `SELECT t.id, t.title, t.body, t.status, t.created_at, t.updated_at,
              u.username AS created_by_name,
              (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count
         FROM tasks t LEFT JOIN users u ON u.id = t.created_by
        WHERE t.server_id = ?
        ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, t.updated_at DESC`
    ).bind(params.id),
  ]);

  return json({
    server: mergeServer(...splitRow(r), env, { admin }),
    posts: posts.results,
    tasks: tasks.results,
  });
}

export async function onRequestPatch({ request, env, params }) {
  const user = await needPerm(env, request, "servers");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;

  const fields = serverFields(b);
  if (!Object.keys(fields).length) return err(400, "Nothing to update");
  if (fields.ptero_uuid) {
    const taken = await env.DB.prepare("SELECT id FROM servers WHERE ptero_uuid = ? AND id != ?")
      .bind(fields.ptero_uuid, params.id).first();
    if (taken) return err(409, `That Pterodactyl server is already linked to "${taken.id}"`);
  }
  fields.updated_at = now();
  const { sql, values } = setClause(fields);
  const res = await env.DB.prepare(`UPDATE servers SET ${sql} WHERE id = ?`).bind(...values, params.id).run();
  if (!res.meta.changes) return err(404, "Server not found");
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const user = await needPerm(env, request, "servers");
  if (user instanceof Response) return user;
  const [res] = await env.DB.batch([
    env.DB.prepare("DELETE FROM servers WHERE id = ?").bind(params.id),
    env.DB.prepare("DELETE FROM chat_messages WHERE channel = ?").bind(params.id),
  ]);
  if (!res.meta.changes) return err(404, "Server not found");
  return json({ ok: true });
}
