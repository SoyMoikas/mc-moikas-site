import { getUser, need } from "../../../lib/auth.js";
import { json, now, err } from "../../../lib/util.js";
import { refreshSteam, fillMultiplayer, steamHeader } from "../../../lib/steam.js";

// GET /api/steam → everyone linked + what they've been playing
//     /api/steam?common=1,2,3  → games every one of those people owns (ids of site users; "all" = everyone linked)
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return err(401, "Log in first");
  const q = new URL(request.url).searchParams;
  const people = (await env.DB.prepare(
    `SELECT s.user_id, s.persona, s.avatar AS steam_avatar, s.public, s.game_count, s.updated_at, u.username, u.avatar
       FROM steam_links s JOIN users u ON u.id = s.user_id ORDER BY u.username COLLATE NOCASE`).all()).results;

  if (q.has("common")) {
    let ids = q.get("common") === "all" ? people.filter((p) => p.public).map((p) => p.user_id)
      : q.get("common").split(",").map(Number).filter((n) => people.some((p) => p.user_id === n && p.public));
    ids = [...new Set(ids)].slice(0, 20);
    if (ids.length < 2) return json({ games: [], people: ids });
    const inList = ids.map(() => "?").join(",");
    const rows = (await env.DB.prepare(
      `SELECT g.appid, a.name, a.multiplayer, SUM(g.playtime) AS total, SUM(g.playtime_2w) AS recent
         FROM steam_games g LEFT JOIN steam_apps a ON a.appid = g.appid
        WHERE g.user_id IN (${inList}) GROUP BY g.appid HAVING COUNT(DISTINCT g.user_id) = ?
        ORDER BY recent DESC, total DESC LIMIT 150`).bind(...ids, ids.length).all()).results;
    await fillMultiplayer(env, rows.slice(0, 60).map((r) => r.appid));
    const mp = new Map((await env.DB.prepare(
      `SELECT appid, multiplayer FROM steam_apps WHERE appid IN (${rows.map(() => "?").join(",") || "NULL"})`
    ).bind(...rows.map((r) => r.appid)).all()).results.map((r) => [r.appid, r.multiplayer]));
    return json({ people: ids, games: rows.map((r) => ({ ...r, multiplayer: mp.get(r.appid) ?? r.multiplayer, img: steamHeader(r.appid) })) });
  }

  // recent games per person (top 3 by the last 2 weeks)
  const recent = (await env.DB.prepare(
    `SELECT g.user_id, g.appid, a.name, g.playtime_2w, g.playtime FROM steam_games g LEFT JOIN steam_apps a ON a.appid = g.appid
      WHERE g.playtime_2w > 0 ORDER BY g.playtime_2w DESC`).all()).results;
  return json({
    configured: !!env.STEAM_API_KEY,
    me: people.find((p) => p.user_id === me.id) || null,
    people: people.map((p) => ({ ...p, recent: recent.filter((r) => r.user_id === p.user_id).slice(0, 3).map((r) => ({ ...r, img: steamHeader(r.appid) })) })),
  });
}

// POST /api/steam {action: "refresh" | "unlink"}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const { action } = await request.json().catch(() => ({}));
  if (action === "unlink") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM steam_games WHERE user_id = ?").bind(me.id),
      env.DB.prepare("DELETE FROM steam_links WHERE user_id = ?").bind(me.id),
    ]);
    return json({ ok: true });
  }
  if (action === "refresh") {
    const l = await env.DB.prepare("SELECT updated_at FROM steam_links WHERE user_id = ?").bind(me.id).first();
    if (!l) return err(404, "Steam isn't linked");
    if (l.updated_at > now() - 60000) return err(429, "Wait a minute before refreshing again");
    try { await refreshSteam(env, me.id); } catch (e) { return err(502, e.message); }
    return json({ ok: true });
  }
  return err(400, "Bad action");
}
