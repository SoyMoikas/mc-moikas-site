import { getUser, need } from "../../../lib/auth.js";
import { json, body, str, int, now, err } from "../../../lib/util.js";
import { loadNight, publicNight, postVoting } from "../../../lib/nights.js";

// GET /api/nights → open and upcoming game nights (+ the last few finished ones)
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ nights: [] });
  const ids = (await env.DB.prepare(
    `SELECT id FROM game_nights WHERE status IN ('voting','locked') OR (status = 'done' AND starts_at > ?)
      ORDER BY CASE status WHEN 'locked' THEN 0 WHEN 'voting' THEN 1 ELSE 2 END, COALESCE(starts_at, vote_until) LIMIT 12`
  ).bind(now() - 7 * 86400000).all()).results;
  const nights = [];
  for (const { id } of ids) nights.push(publicNight(await loadNight(env, id, me), me));
  return json({ nights });
}

// POST /api/nights {title, note, games: [..], times: [ms..], vote_until: ms}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now();
  const title = str(b.title, 80, "title") || "Noche de juego";
  const games = [...new Set((Array.isArray(b.games) ? b.games : []).map((g) => String(g).trim().slice(0, 60)).filter(Boolean))].slice(0, 8);
  const times = [...new Set((Array.isArray(b.times) ? b.times : []).map(Number).filter((x) => Number.isInteger(x) && x > t && x < t + 60 * 86400000))].slice(0, 8);
  if (!games.length) return err(400, "Add at least one game");
  if (!times.length) return err(400, "Add at least one future time");
  let voteUntil = Number.isInteger(b.vote_until) ? b.vote_until : Math.min(...times) - 2 * 3600000;
  voteUntil = Math.max(t + 10 * 60000, Math.min(voteUntil, Math.min(...times)));
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM game_nights WHERE user_id = ? AND status IN ('voting','locked')").bind(me.id).first();
  if (open.n >= 3) return err(429, "You already have 3 game nights going");
  const r = await env.DB.prepare("INSERT INTO game_nights (user_id, title, note, vote_until, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(me.id, title, b.note ? str(b.note, 300, "note") : null, voteUntil, t).run();
  const id = r.meta.last_row_id;
  await env.DB.batch([
    ...games.map((g) => env.DB.prepare("INSERT INTO game_night_options (night_id, kind, label) VALUES (?, 'game', ?)").bind(id, g)),
    ...times.map((x) => env.DB.prepare("INSERT INTO game_night_options (night_id, kind, label, value) VALUES (?, 'time', ?, ?)").bind(id, new Date(x).toISOString(), x)),
  ]);
  const n = await loadNight(env, id, me);
  await postVoting(env, n);
  return json({ night: publicNight(n, me) });
}
