import { awardActivity } from "../../../../lib/activity.js";
import { json, err, now } from "../../../../lib/util.js";
import { need } from "../../../../lib/auth.js";

// Toggle your like. Returns the new state and count.
export async function onRequestPost({ request, env, params, waitUntil }) {
  const viewer = await need(env, request, "member");
  if (viewer instanceof Response) return viewer;
  const post = await env.DB.prepare("SELECT p.user_id, u.role FROM social_posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.deleted = 0").bind(params.id).first();
  if (!post) return err(404, "Post not found");
  const del = await env.DB.prepare("DELETE FROM social_likes WHERE post_id = ? AND user_id = ?").bind(params.id, viewer.id).run();
  let liked = false;
  if (!del.meta.changes) {
    await env.DB.prepare("INSERT OR IGNORE INTO social_likes (post_id, user_id, created_at) VALUES (?, ?, ?)").bind(params.id, viewer.id, now()).run();
    liked = true;
    // the author earns XP for likes from other people (capped per day, so like/unlike spam doesn't farm)
    if (post.user_id !== viewer.id) waitUntil(awardActivity(env, { id: post.user_id, role: post.role }, "like"));
  }
  const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_likes WHERE post_id = ?").bind(params.id).first();
  return json({ liked, likes: c.n });
}
