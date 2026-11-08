import { json, err, body, now } from "../../../lib/util.js";
import { need, hasRole } from "../../../lib/auth.js";
import { POST_COLS, POST_FROM, postInput, score, decorate } from "../../../lib/feed.js";

// Private feed for approved members.
// GET ?mode=foryou|recent  &game=<id>  &user=<id>  &offset=N (foryou)  &before=<post id> (recent)
export async function onRequestGet({ request, env }) {
  const viewer = await need(env, request, "member");
  if (viewer instanceof Response) return viewer;
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "recent" ? "recent" : "foryou";
  const game = url.searchParams.get("game");
  const userId = Number(url.searchParams.get("user")) || null;
  const limit = 15;

  const where = ["p.deleted = 0"], binds = [];
  if (game) { where.push("p.game_id = ?"); binds.push(game); }
  if (userId) { where.push("p.user_id = ?"); binds.push(userId); }

  let rows, more;
  if (mode === "recent" || userId) {
    const before = Number(url.searchParams.get("before")) || 0;
    if (before) { where.push("p.id < ?"); binds.push(before); }
    rows = (await env.DB.prepare(`SELECT ${POST_COLS} ${POST_FROM} WHERE ${where.join(" AND ")} ORDER BY p.id DESC LIMIT ${limit + 1}`)
      .bind(...binds).all()).results;
    more = rows.length > limit;
    rows = rows.slice(0, limit);
  } else {
    // Rank the last ~300 posts from the past 30 days by engagement and freshness.
    where.push("p.created_at > ?"); binds.push(now() - 30 * 86400_000);
    const pool = (await env.DB.prepare(`SELECT ${POST_COLS} ${POST_FROM} WHERE ${where.join(" AND ")} ORDER BY p.id DESC LIMIT 300`)
      .bind(...binds).all()).results;
    const t = now();
    pool.sort((a, b) => score(b, t) - score(a, t));
    const offset = Number(url.searchParams.get("offset")) || 0;
    rows = pool.slice(offset, offset + limit);
    more = pool.length > offset + limit;
  }

  let liked = new Set();
  if (rows.length) {
    const r = await env.DB.prepare(`SELECT post_id FROM social_likes WHERE user_id = ? AND post_id IN (${rows.map(() => "?").join(",")})`)
      .bind(viewer.id, ...rows.map((p) => p.id)).all();
    liked = new Set(r.results.map((x) => x.post_id));
  }
  return json({ posts: decorate(rows, viewer, liked, hasRole(viewer, "staff")), more, mode });
}

export async function onRequestPost({ request, env }) {
  const viewer = await need(env, request, "member");
  if (viewer instanceof Response) return viewer;
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = postInput(b);
  if (f.game_id && !(await env.DB.prepare("SELECT 1 FROM games WHERE id = ? AND active = 1").bind(f.game_id).first())) return err(404, "Game not found");

  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_posts WHERE user_id = ? AND created_at > ?").bind(viewer.id, now() - 10 * 60_000).first();
  if (recent.n >= 8) return err(429, "Slow down a little");

  const res = await env.DB.prepare("INSERT INTO social_posts (user_id, body, image, game_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(viewer.id, f.body, f.image, f.game_id, now()).run();
  return json({ id: res.meta.last_row_id }, 201);
}
