import { ensureMarket } from "../../../lib/markets.js";
import { notify, allMembers } from "../../../lib/notify.js";
import { getUser, need } from "../../../lib/auth.js";
import { json, body, str, int, now, err } from "../../../lib/util.js";
import { loadNight, publicNight, postVoting } from "../../../lib/nights.js";

// GET /api/nights → open and upcoming game nights (+ the last few finished ones)
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ nights: [] });
  const kind = new URL(request.url).searchParams.get("kind") === "watch" ? "watch" : "game";
  const ids = (await env.DB.prepare(
    `SELECT id FROM game_nights WHERE COALESCE(kind, 'game') = ? AND (status IN ('voting','locked') OR (status = 'done' AND starts_at > ?))
      ORDER BY CASE status WHEN 'locked' THEN 0 WHEN 'voting' THEN 1 ELSE 2 END, COALESCE(starts_at, vote_until) LIMIT 12`
  ).bind(kind, now() - 7 * 86400000).all()).results;
  const nights = [];
  for (const { id } of ids) nights.push(publicNight(await loadNight(env, id, me), me));
  return json({ nights });
}

// POST /api/nights {title, note, games: [..], times: [ms..], vote_until: ms}
export async function onRequestPost({ env, request, waitUntil }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now();
  const kind = b.kind === "watch" ? "watch" : "game";
  const title = str(b.title, 80, "title") || (kind === "watch" ? "Noche de cine" : "Noche de juego");
  const games = [...new Set((Array.isArray(b.games) ? b.games : []).map((g) => String(g).trim().slice(0, 60)).filter(Boolean))].slice(0, 8);
  const times = [...new Set((Array.isArray(b.times) ? b.times : []).map(Number).filter((x) => Number.isInteger(x) && x > t && x < t + 60 * 86400000))].slice(0, 8);
  if (!games.length) return err(400, "Add at least one game");
  if (!times.length) return err(400, "Add at least one future time");
  let voteUntil = Number.isInteger(b.vote_until) ? b.vote_until : Math.min(...times) - 2 * 3600000;
  voteUntil = Math.max(t + 10 * 60000, Math.min(voteUntil, Math.min(...times)));
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM game_nights WHERE user_id = ? AND status IN ('voting','locked')").bind(me.id).first();
  if (open.n >= 3) return err(429, "You already have 3 game nights going");
  const r = await env.DB.prepare("INSERT INTO game_nights (user_id, title, note, vote_until, created_at, kind) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(me.id, title, b.note ? str(b.note, 300, "note") : null, voteUntil, t, kind).run();
  const id = r.meta.last_row_id;
  await env.DB.batch([
    ...games.map((g) => env.DB.prepare("INSERT INTO game_night_options (night_id, kind, label) VALUES (?, 'game', ?)").bind(id, g)),
    ...times.map((x) => env.DB.prepare("INSERT INTO game_night_options (night_id, kind, label, value) VALUES (?, 'time', ?, ?)").bind(id, new Date(x).toISOString(), x)),
  ]);
  const n = await loadNight(env, id, me);
  await postVoting(env, n);
  if (games.length >= 2) await ensureMarket(env, { kind: "night", ref: id, title: `${title}: ¿qué ${kind === "watch" ? "película" : "juego"} gana la votación?`,
    options: games.map((g) => ({ label: g, ref: g })), closes_at: voteUntil });
  waitUntil(allMembers(env, me.id).then((ids) => notify(env, ids, "game", {
    title: `${kind === "watch" ? "🎬" : "🗳️"} ${me.username} armó: ${title}`, body: `Vota qué ${kind === "watch" ? "ver" : "jugar"}: ${games.join(", ")}`,
    url: kind === "watch" ? `/juntos?night=${id}#cine` : `/play?night=${id}#noches` })));
  return json({ night: publicNight(n, me) });
}
