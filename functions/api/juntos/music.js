import { getUser, need, hasRole } from "../../../lib/auth.js";
import { json, body, now, err } from "../../../lib/util.js";

// GET → who's listening/watching right now, top artists this week, the group playlist link. POST {playlist} (staff)
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ now: [], top: [], playlist: null });
  const t = now();
  const nowRows = (await env.DB.prepare(
    `SELECT l.*, u.username, u.avatar FROM listening l JOIN users u ON u.id = l.user_id WHERE l.updated_at > ? ORDER BY l.kind, u.username`).bind(t - 5 * 60000).all()).results;
  const top = (await env.DB.prepare(
    `SELECT artist, COUNT(*) AS plays, COUNT(DISTINCT user_id) AS people FROM listen_log WHERE kind = 'music' AND artist IS NOT NULL AND created_at > ?
      GROUP BY artist ORDER BY plays DESC LIMIT 10`).bind(t - 7 * 86400000).all()).results;
  const songs = (await env.DB.prepare(
    `SELECT l.title, l.artist, u.username, l.created_at FROM listen_log l JOIN users u ON u.id = l.user_id WHERE l.kind = 'music' ORDER BY l.id DESC LIMIT 15`).all()).results;
  const pl = await env.DB.prepare("SELECT value FROM kv_cache WHERE key = 'group_playlist'").first();
  return json({ now: nowRows, top, recent: songs, playlist: pl ? JSON.parse(pl.value) : null, jellyfin: env.JELLYFIN_PUBLIC_URL || null });
}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "staff");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const url = String(b.playlist || "").trim();
  if (url && !/^https:\/\/(open\.spotify\.com|music\.youtube\.com|www\.youtube\.com|youtube\.com)\//.test(url)) return err(400, "Use a Spotify or YouTube Music link");
  await env.DB.prepare("INSERT OR REPLACE INTO kv_cache (key, value, updated_at) VALUES ('group_playlist', ?, ?)").bind(JSON.stringify(url || null), now()).run();
  void hasRole;
  return json({ ok: true });
}
