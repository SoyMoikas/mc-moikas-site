import { json, err, now } from "../../../lib/util.js";
import { syncAuthorized } from "../../../lib/sync-auth.js";

// From the Discord bot on the NAS: who's playing what right now.
// Body: { playing: [{ discord_id, game, kind, since }] } — the full current list; anyone missing stopped playing.
export async function onRequestPost({ request, env }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  let p;
  try { p = JSON.parse(await request.text()); } catch { return err(400, "Invalid JSON"); }
  const t = now();
  const list = (Array.isArray(p.playing) ? p.playing : []).slice(0, 500)
    .filter((x) => /^\d{5,25}$/.test(String(x?.discord_id || "")) && typeof x.game === "string" && x.game.trim());
  const users = list.length ? (await env.DB.prepare(
    `SELECT id, discord_id FROM users WHERE role != 'pending' AND discord_id IN (${list.map(() => "?").join(",")})`
  ).bind(...list.map((x) => String(x.discord_id))).all()).results : [];
  const byDiscord = new Map(users.map((u) => [u.discord_id, u.id]));
  const stmts = [env.DB.prepare("DELETE FROM presence")];
  for (const x of list) {
    const uid = byDiscord.get(String(x.discord_id));
    if (!uid) continue; // only people with an account on the site
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO presence (user_id, game, kind, since, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(uid, x.game.trim().slice(0, 80), ["playing", "streaming", "competing"].includes(x.kind) ? x.kind : "playing",
        Number.isInteger(x.since) ? x.since : null, t));
  }
  await env.DB.batch(stmts);
  const shown = stmts.length - 1;

  // Spotify (from Discord) and Jellyfin (what people are watching on your server)
  const music = (Array.isArray(p.listening) ? p.listening : []).slice(0, 200)
    .filter((x) => /^\d{5,25}$/.test(String(x?.discord_id || "")) && typeof x.title === "string");
  const watch = (Array.isArray(p.watching) ? p.watching : []).slice(0, 200).filter((x) => typeof x?.jellyfin_user === "string" && typeof x.title === "string");
  const mUsers = music.length ? new Map((await env.DB.prepare(`SELECT id, discord_id FROM users WHERE role != 'pending' AND discord_id IN (${music.map(() => "?").join(",")})`)
    .bind(...music.map((x) => String(x.discord_id))).all()).results.map((u) => [u.discord_id, u.id])) : new Map();
  const wUsers = watch.length ? new Map((await env.DB.prepare(`SELECT id, lower(jellyfin_name) AS j FROM users WHERE role != 'pending' AND lower(jellyfin_name) IN (${watch.map(() => "?").join(",")})`)
    .bind(...watch.map((x) => x.jellyfin_user.toLowerCase())).all()).results.map((u) => [u.j, u.id])) : new Map();
  const rows = [
    ...music.map((x) => ({ uid: mUsers.get(String(x.discord_id)), kind: "music", title: x.title, artist: x.artist, cover: x.cover, url: x.url })),
    ...watch.map((x) => ({ uid: wUsers.get(x.jellyfin_user.toLowerCase()), kind: "watch", title: x.title, artist: x.series || null, cover: null, url: null })),
  ].filter((r) => r.uid);
  const prev = new Map((await env.DB.prepare("SELECT user_id, title, kind FROM listening").all()).results.map((r) => [r.user_id, r]));
  const ls = [env.DB.prepare("DELETE FROM listening")];
  for (const r of rows) {
    const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
    ls.push(env.DB.prepare("INSERT OR REPLACE INTO listening (user_id, title, artist, cover, url, kind, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(r.uid, clip(r.title, 120), clip(r.artist, 120), /^https:\/\//.test(r.cover || "") ? clip(r.cover, 300) : null, /^https:\/\/open\.spotify\.com\//.test(r.url || "") ? clip(r.url, 200) : null, r.kind, t));
    const p0 = prev.get(r.uid);
    if (!p0 || p0.title !== clip(r.title, 120) || p0.kind !== r.kind) // a new song / show → history (for "top artists this week")
      ls.push(env.DB.prepare("INSERT INTO listen_log (user_id, kind, title, artist, created_at) VALUES (?, ?, ?, ?, ?)").bind(r.uid, r.kind, clip(r.title, 120), clip(r.artist, 120), t));
  }
  if (Math.random() < 0.01) ls.push(env.DB.prepare("DELETE FROM listen_log WHERE created_at < ?").bind(t - 90 * 86400000));
  await env.DB.batch(ls);
  return json({ ok: true, shown, music: rows.filter((r) => r.kind === "music").length, watching: rows.filter((r) => r.kind === "watch").length });
}
