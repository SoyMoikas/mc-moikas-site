import { json, err, now } from "../../../../lib/util.js";
import { need } from "../../../../lib/auth.js";

// Toggle your like. Returns the new state and count.
export async function onRequestPost({ request, env, params }) {
  const viewer = await need(env, request, "member");
  if (viewer instanceof Response) return viewer;
  if (!(await env.DB.prepare("SELECT 1 FROM social_posts WHERE id = ? AND deleted = 0").bind(params.id).first())) return err(404, "Post not found");
  const del = await env.DB.prepare("DELETE FROM social_likes WHERE post_id = ? AND user_id = ?").bind(params.id, viewer.id).run();
  let liked = false;
  if (!del.meta.changes) {
    await env.DB.prepare("INSERT OR IGNORE INTO social_likes (post_id, user_id, created_at) VALUES (?, ?, ?)").bind(params.id, viewer.id, now()).run();
    liked = true;
  }
  const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_likes WHERE post_id = ?").bind(params.id).first();
  return json({ liked, likes: c.n });
}
