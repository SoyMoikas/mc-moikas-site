import { json, err, now } from "../../../../lib/util.js";
import { need } from "../../../../lib/auth.js";
import { mergeServer, SERVER_SELECT, splitRow } from "../../../../lib/servers.js";

const USER_COOLDOWN_MS = 5 * 60 * 1000;

// POST /api/servers/<id>/start → ask the NAS to start this server. Approved members only, and only on
// servers where an admin ticked "members can start it". It can never stop or restart anything.
// The NAS script picks the request up on its next run (every 2 minutes) and does the actual start.
export async function onRequestPost({ request, env, params }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  const r = await env.DB.prepare(`${SERVER_SELECT} WHERE s.id = ?`).bind(params.id).first();
  if (!r || r.hidden) return err(404, "Server not found");
  const s = mergeServer(...splitRow(r), env);
  if (!s.can_start) return err(403, "This server can't be started from the site");
  if (s.status !== "offline") return err(409, s.status === "unknown" ? "The NAS isn't reporting right now. Try again in a few minutes." : "The server is already on or starting");

  const t = now();
  const [pending, mine] = await env.DB.batch([
    env.DB.prepare("SELECT 1 FROM server_starts WHERE ptero_uuid = ? AND done_at IS NULL AND created_at > ? LIMIT 1").bind(r.ptero_uuid, t - 10 * 60 * 1000),
    env.DB.prepare("SELECT 1 FROM server_starts WHERE user_id = ? AND created_at > ? LIMIT 1").bind(user.id, t - USER_COOLDOWN_MS),
  ]);
  if (pending.results.length) return json({ ok: true, already: true });
  if (mine.results.length) return err(429, "You just started a server. Wait a few minutes.");
  await env.DB.prepare("INSERT INTO server_starts (ptero_uuid, user_id, created_at) VALUES (?, ?, ?)").bind(r.ptero_uuid, user.id, t).run();
  return json({ ok: true });
}
