import { json, err, body, now, str } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";
import { postFields } from "../../../lib/fields.js";

// Latest official posts across the network (for the home page).
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 15, 50);
  const siteOnly = url.searchParams.get("scope") === "site"; // home page: only network-wide posts
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.server_id, p.title, p.body, p.tag, p.event_at, p.pinned, p.created_at, p.updated_at,
            u.username AS author, u.avatar AS author_avatar, u.xp AS author_xp, u.eq_frame AS author_frame, u.eq_hat AS author_hat, u.eq_color AS author_color, u.eq_font AS author_font,
            COALESCE(s.name, s.id) AS server_name, p.game_id, g.name AS game_name, g.name_es AS game_name_es, g.icon AS game_icon
       FROM posts p
       LEFT JOIN users u ON u.id = p.author_id
       LEFT JOIN servers s ON s.id = p.server_id
       LEFT JOIN games g ON g.id = p.game_id
      WHERE ${siteOnly ? "p.server_id IS NULL AND p.game_id IS NULL" : "(p.server_id IS NULL OR s.hidden = 0)"}
      ORDER BY (p.pinned AND p.server_id IS NULL) DESC, p.created_at DESC
      LIMIT ?`
  ).bind(limit).all();
  return json({ posts: results });
}

// Staff: create a post. server_id omitted/null = network-wide announcement.
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;

  const f = postFields(b);
  const serverId = str(b.server_id, 40, "server_id");
  if (serverId && !(await env.DB.prepare("SELECT 1 FROM servers WHERE id = ?").bind(serverId).first())) {
    return err(404, "Server not found");
  }
  const gameId = serverId ? null : str(b.game_id, 30, "game_id");
  if (gameId && !(await env.DB.prepare("SELECT 1 FROM games WHERE id = ?").bind(gameId).first())) return err(404, "Game not found");
  const t = now();
  const res = await env.DB.prepare(
    `INSERT INTO posts (server_id, game_id, title, body, tag, event_at, pinned, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(serverId, gameId, f.title, f.body, f.tag, f.event_at, f.pinned, user.id, t, t).run();
  return json({ id: res.meta.last_row_id }, 201);
}
