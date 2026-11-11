import { need, hasRole } from "../../../lib/auth.js";
import { json, body, now, err } from "../../../lib/util.js";
import { loadPost, publicPost, setMember, syncDiscord } from "../../../lib/lfg.js";

// POST /api/lfg/:id {action: "join" | "leave" | "close"}
export async function onRequestPost({ env, request, params }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const p = await loadPost(env, parseInt(params.id) || 0);
  if (!p) return err(404, "Not found");

  if (b.action === "close") {
    if (p.user_id !== me.id && !hasRole(me, "staff")) return err(403, "Only the host can close it");
    await env.DB.prepare("UPDATE lfg_posts SET closed_at = ? WHERE id = ?").bind(now(), p.id).run();
  } else if (b.action === "join" || b.action === "leave") {
    const r = await setMember(env, p, me.id, b.action === "join");
    if (r === "full") return err(409, "It's full");
    if (r === "closed") return err(409, "This post is closed");
    if (r === "host") return err(409, "You're the host — close it instead");
    if (r === "left") await env.DB.prepare("UPDATE lfg_posts SET pinged = 0 WHERE id = ?").bind(p.id).run();
  } else return err(400, "Bad action");

  const fresh = await loadPost(env, p.id);
  await syncDiscord(env, fresh);
  return json({ post: publicPost(fresh, me) });
}
