import { json, err, body, now } from "../../../lib/util.js";
import { getUser, hasPerm, needPerm } from "../../../lib/auth.js";
import { gameFields } from "../../../lib/games.js";
import { setClause } from "../../../lib/fields.js";
import { mergeServer, SERVER_SELECT, splitRow } from "../../../lib/servers.js";

// Game page: game info, its servers, and its announcements.
export async function onRequestGet({ request, env, params }) {
  const user = await getUser(env, request);
  const manage = hasPerm(user, "servers");
  const game = await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(params.id).first();
  if (!game || (!game.active && !manage)) return err(404, "Game not found");

  const { results: rows } = await env.DB.prepare(
    `${SERVER_SELECT} WHERE s.game_id = ? ${manage ? "" : "AND s.hidden = 0"} ORDER BY s.sort_order, s.name, s.id`
  ).bind(params.id).all();
  const servers = rows.map((r) => mergeServer(...splitRow(r), env));

  const { results: posts } = await env.DB.prepare(
    `SELECT p.id, p.server_id, p.game_id, p.title, p.body, p.tag, p.event_at, p.pinned, p.created_at, p.updated_at,
            u.username AS author, u.avatar AS author_avatar, u.xp AS author_xp, u.eq_frame AS author_frame, u.eq_hat AS author_hat, u.eq_color AS author_color, u.eq_font AS author_font,
            COALESCE(s.name, s.id) AS server_name
       FROM posts p LEFT JOIN users u ON u.id = p.author_id LEFT JOIN servers s ON s.id = p.server_id
      WHERE (p.game_id = ?1 OR s.game_id = ?1) AND (p.server_id IS NULL OR s.hidden = 0 OR ?2 = 1)
      ORDER BY p.pinned DESC, p.created_at DESC LIMIT 30`
  ).bind(params.id, manage ? 1 : 0).all();

  return json({ game, servers, posts });
}

export async function onRequestPatch({ request, env, params }) {
  const user = await needPerm(env, request, "servers");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = gameFields(b);
  f.updated_at = now();
  const { sql, values } = setClause(f);
  const res = await env.DB.prepare(`UPDATE games SET ${sql} WHERE id = ?`).bind(...values, params.id).run();
  if (!res.meta.changes) return err(404, "Game not found");
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const user = await needPerm(env, request, "servers");
  if (user instanceof Response) return user;
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM servers WHERE game_id = ?").bind(params.id).first();
  if (used.n) return err(409, "Move or delete this game's servers first");
  const res = await env.DB.batch([
    env.DB.prepare("DELETE FROM games WHERE id = ?").bind(params.id),
    env.DB.prepare("UPDATE posts SET game_id = NULL WHERE game_id = ?").bind(params.id),
    env.DB.prepare("UPDATE social_posts SET game_id = NULL WHERE game_id = ?").bind(params.id),
    env.DB.prepare("DELETE FROM chat_messages WHERE channel = ?").bind(`game:${params.id}`),
  ]);
  if (!res[0].meta.changes) return err(404, "Game not found");
  return json({ ok: true });
}
