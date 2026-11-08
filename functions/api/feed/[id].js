import { json, err, body, now } from "../../../lib/util.js";
import { need, hasRole } from "../../../lib/auth.js";
import { postInput, postLook } from "../../../lib/feed.js";

// Edit your own post.
export async function onRequestPatch({ request, env, params }) {
  const viewer = await need(env, request, "member");
  if (viewer instanceof Response) return viewer;
  const p = await env.DB.prepare("SELECT user_id FROM social_posts WHERE id = ? AND deleted = 0").bind(params.id).first();
  if (!p) return err(404, "Post not found");
  if (p.user_id !== viewer.id) return err(403, "Not allowed");
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = postInput(b);
  if (f.game_id && !(await env.DB.prepare("SELECT 1 FROM games WHERE id = ?").bind(f.game_id).first())) return err(404, "Game not found");
  const look = await postLook(env, viewer, b);
  await env.DB.prepare("UPDATE social_posts SET body = ?, image = ?, game_id = ?, style = ?, bg = ?, edited_at = ? WHERE id = ?")
    .bind(f.body, f.image, f.game_id, look.style, look.bg, now(), params.id).run();
  return json({ ok: true });
}

// Delete: author or staff.
export async function onRequestDelete({ request, env, params }) {
  const viewer = await need(env, request, "member");
  if (viewer instanceof Response) return viewer;
  const p = await env.DB.prepare("SELECT user_id FROM social_posts WHERE id = ? AND deleted = 0").bind(params.id).first();
  if (!p) return err(404, "Post not found");
  if (p.user_id !== viewer.id && !hasRole(viewer, "staff")) return err(403, "Not allowed");
  await env.DB.batch([
    env.DB.prepare("UPDATE social_posts SET deleted = 1, body = NULL, image = NULL WHERE id = ?").bind(params.id),
    env.DB.prepare("DELETE FROM social_likes WHERE post_id = ?").bind(params.id),
    env.DB.prepare("DELETE FROM social_comments WHERE post_id = ?").bind(params.id),
  ]);
  return json({ ok: true });
}
