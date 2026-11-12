import { notify, allMembers } from "../../../lib/notify.js";
import { getUser, need } from "../../../lib/auth.js";
import { json, body, str, int, now, err } from "../../../lib/util.js";
import { announce, DEFAULT_POINTS, FORMATS } from "../../../lib/tournaments.js";

// GET /api/tournaments → all tournaments (newest first) with team counts
//     ?user=<id> → tournaments that person placed in (for profile trophies)
export async function onRequestGet({ env, request }) {
  const q = new URL(request.url).searchParams;
  if (q.get("user")) {
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.title, t.game, p.place, p.coins, t.finished_at FROM tournament_prizes p JOIN tournaments t ON t.id = p.tournament_id
        WHERE p.user_id = ? ORDER BY t.finished_at DESC`).bind(parseInt(q.get("user")) || 0).all();
    return json({ trophies: results });
  }
  const me = await getUser(env, request);
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.title, t.game, t.format, t.team_size, t.max_teams, t.starts_at, t.prize_coins, t.status, t.finished_at,
            (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id) AS teams,
            (SELECT name FROM tournament_teams tt WHERE tt.id = t.winner_team_id) AS winner,
            ${me ? `(SELECT 1 FROM tournament_members m WHERE m.tournament_id = t.id AND m.user_id = ${Number(me.id)})` : "NULL"} AS joined
       FROM tournaments t ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'signup' THEN 1 ELSE 2 END, t.starts_at DESC LIMIT 60`).all();
  return json({ tournaments: results });
}

// POST /api/tournaments (staff) {title, game, format, team_size, max_teams, starts_at, rules, prize_coins, points}
export async function onRequestPost({ env, request, waitUntil }) {
  const me = await need(env, request, "staff");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const format = FORMATS.includes(b.format) ? b.format : "bracket";
  const c = b.config || {};
  const config = JSON.stringify({ best_of: [1, 3, 5, 7].includes(+c.best_of) ? +c.best_of : 1,
    swiss_rounds: format === "swiss" && +c.swiss_rounds >= 1 ? Math.min(10, Math.floor(+c.swiss_rounds)) : null,
    playoff: ["roundrobin", "swiss"].includes(format) && [2, 4, 8].includes(+c.playoff) ? +c.playoff : 0 });
  const title = str(b.title, 80, "title"), game = str(b.game, 60, "game");
  if (!title || !game) return err(400, "Title and game are required");
  let points = null;
  if (format === "points" && b.points) {
    const placement = String(b.points.placement || "").split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 40);
    const kill = Number(b.points.kill);
    points = JSON.stringify({ placement: placement.length ? placement : DEFAULT_POINTS.placement, kill: Number.isFinite(kill) && kill >= 0 ? kill : 1 });
  }
  const t = now();
  const startsAt = int(b.starts_at, "starts_at", { min: t - 86400000, max: t + 120 * 86400000 });
  const r = await env.DB.prepare(
    `INSERT INTO tournaments (title, game, format, team_size, max_teams, starts_at, rules, prize_coins, points_config, config, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    title, game, format, int(b.team_size, "team_size", { min: 1, max: 10 }), int(b.max_teams, "max_teams", { min: 2, max: 64 }),
    startsAt, b.rules ? str(b.rules, 3000, "rules") : null,
    int(b.prize_coins || 0, "prize_coins", { min: 0, max: 100000 }), points, config, me.id, t).run();
  const id = r.meta.last_row_id;
  const ts = Math.floor(startsAt / 1000);
  await announce(env, `🏆 **Nuevo torneo: ${title}** — ${game}, <t:${ts}:F>. ¡Inscríbanse!`, id);
  waitUntil(allMembers(env, me.id).then((ids) => notify(env, ids, "game", {
    title: `🏆 Nuevo torneo: ${title}`, body: `${game}${b.prize_coins ? ` · premio 🪙 ${b.prize_coins}` : ""} · ¡inscríbete!`, url: `/tournaments?id=${id}` })));
  return json({ id });
}
