import { awardActivity } from "../../../../lib/activity.js";
import { json, err, body, now, str } from "../../../../lib/util.js";
import { need, hasRole } from "../../../../lib/auth.js";

export async function onRequestGet({ request, env, params }) {
  const viewer = await need(env, request, "member");
  if (viewer instanceof Response) return viewer;
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, c.user_id, u.username, u.avatar, u.role, u.xp, u.eq_frame, u.eq_hat, u.hat_fit, u.avatar_build, u.acc_extra, u.eq_color
       FROM social_comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? ORDER BY c.id ASC LIMIT 300`
  ).bind(params.id).all();
  const staff = hasRole(viewer, "staff");
  return json({ comments: results.map(({ user_id, ...c }) => ({ ...c, can_delete: staff || user_id === viewer.id })) });
}

export async function onRequestPost({ request, env, params, waitUntil }) {
  const viewer = await need(env, request, "member");
  if (viewer instanceof Response) return viewer;
  const b = await body(request, 8 * 1024);
  if (b instanceof Response) return b;
  const text = str(b.body, 1000, "comment");
  if (!text) return err(400, "Comment can't be empty");
  const post = await env.DB.prepare("SELECT user_id FROM social_posts WHERE id = ? AND deleted = 0").bind(params.id).first();
  if (!post) return err(404, "Post not found");
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_comments WHERE user_id = ? AND created_at > ?").bind(viewer.id, now() - 60_000).first();
  if (recent.n >= 10) return err(429, "Slow down a little");
  const res = await env.DB.prepare("INSERT INTO social_comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)")
    .bind(params.id, viewer.id, text, now()).run();
  if (post.user_id !== viewer.id) waitUntil(awardActivity(env, viewer, "comment")); // commenting on others' posts
  return json({ id: res.meta.last_row_id }, 201);
}
