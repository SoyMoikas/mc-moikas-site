import { getUser } from "../../../lib/auth.js";
import { json, err } from "../../../lib/util.js";
import { jfLink, jfPoster } from "../../../lib/media.js";

// GET /api/juntos/nuevo → the latest movies and shows added to Jellyfin (posters come straight from your public Jellyfin).
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return err(401, "Log in first");
  if (!env.JELLYFIN_PUBLIC_URL) return json({ items: [] });
  let rows = [];
  try {
    rows = (await env.DB.prepare("SELECT jf_id, type, title, year, added_at FROM jellyfin_library WHERE added_at IS NOT NULL ORDER BY added_at DESC LIMIT 14").all()).results;
  } catch { /* before migration 034 */ }
  return json({ items: rows.map((r) => ({ id: r.jf_id, type: r.type, title: r.title, year: r.year, added_at: r.added_at, poster: jfPoster(env, r.jf_id), url: jfLink(env, r.jf_id) })) });
}
