// Tournaments: single-elimination brackets and Apex-style points tables.
import { now } from "./util.js";
import { recomputeXP } from "./xp.js";
import { discord } from "./lfg.js";

// Default points for Apex-style lobbies: placement 1..20, plus 1 per kill.
export const DEFAULT_POINTS = { placement: [12, 9, 7, 5, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], kill: 1 };

export async function loadTournament(env, id) {
  const tr = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(id).first();
  if (!tr) return null;
  const [teams, members, matches, results] = await Promise.all([
    env.DB.prepare("SELECT * FROM tournament_teams WHERE tournament_id = ? ORDER BY created_at").bind(id).all(),
    env.DB.prepare(`SELECT m.team_id, u.id, u.username, u.avatar FROM tournament_members m JOIN users u ON u.id = m.user_id
                     WHERE m.tournament_id = ?`).bind(id).all(),
    env.DB.prepare("SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round, slot").bind(id).all(),
    env.DB.prepare("SELECT * FROM tournament_results WHERE tournament_id = ? ORDER BY game_no, placement").bind(id).all(),
  ]);
  tr.points = tr.points_config ? JSON.parse(tr.points_config) : DEFAULT_POINTS;
  tr.teams = teams.results.map((t) => ({ ...t, members: members.results.filter((m) => m.team_id === t.id) }));
  tr.matches = matches.results;
  tr.results = results.results;
  return tr;
}

export function standings(tr) {
  const rows = new Map(tr.teams.map((t) => [t.id, { team_id: t.id, name: t.name, points: 0, kills: 0, games: 0, wins: 0, best: 99 }]));
  for (const r of tr.results) {
    const row = rows.get(r.team_id);
    if (!row) continue;
    row.points += (tr.points.placement[r.placement - 1] || 0) + r.kills * (tr.points.kill || 0);
    row.kills += r.kills; row.games++; row.best = Math.min(row.best, r.placement);
    if (r.placement === 1) row.wins++;
  }
  // tie-breaks: points, then wins, then kills, then best placement
  return [...rows.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || b.kills - a.kills || a.best - b.best);
}

// Single elimination: shuffle, pad with byes to a power of two, byes advance automatically.
export async function startBracket(env, tr) {
  const ids = tr.teams.map((t) => t.id).sort(() => Math.random() - 0.5);
  let size = 2; while (size < ids.length) size *= 2;
  const rounds = Math.log2(size);
  // spread byes so two byes never meet: seed order a,b with nulls on the b side
  const slots = [];
  const byes = size - ids.length;
  let k = 0;
  for (let i = 0; i < size / 2; i++) {
    const a = ids[k++] ?? null;
    const b = i < size / 2 - byes ? ids[k++] ?? null : null;
    slots.push([a, b]);
  }
  const stmts = [];
  for (let r = 1; r <= rounds; r++) {
    const n = size / 2 ** r;
    for (let s = 0; s < n; s++) {
      const [a, b] = r === 1 ? slots[s] : [null, null];
      stmts.push(env.DB.prepare("INSERT INTO tournament_matches (tournament_id, round, slot, team_a, team_b) VALUES (?, ?, ?, ?, ?)")
        .bind(tr.id, r, s, a, b));
    }
  }
  await env.DB.batch(stmts);
  // auto-advance byes
  const fresh = await loadTournament(env, tr.id);
  for (const m of fresh.matches.filter((m) => m.round === 1 && (m.team_a === null) !== (m.team_b === null))) {
    await setMatchWinner(env, fresh, m, m.team_a ?? m.team_b, null, null);
  }
}

export async function setMatchWinner(env, tr, m, winner, scoreA, scoreB) {
  await env.DB.prepare("UPDATE tournament_matches SET winner = ?, score_a = ?, score_b = ? WHERE id = ?")
    .bind(winner, scoreA, scoreB, m.id).run();
  const rounds = Math.max(...tr.matches.map((x) => x.round));
  if (m.round === rounds) {
    const second = winner === m.team_a ? m.team_b : m.team_a;
    return finish(env, tr, [winner, second]);
  }
  const col = m.slot % 2 === 0 ? "team_a" : "team_b";
  await env.DB.prepare(`UPDATE tournament_matches SET ${col} = ?, winner = NULL, score_a = NULL, score_b = NULL WHERE tournament_id = ? AND round = ? AND slot = ?`)
    .bind(winner, tr.id, m.round + 1, Math.floor(m.slot / 2)).run();
}

// Pay out: 1st place gets the prize, 2nd gets half — each player on the team.
export async function finish(env, tr, [first, second]) {
  const t = now();
  await env.DB.prepare("UPDATE tournaments SET status = 'done', winner_team_id = ?, finished_at = ? WHERE id = ?").bind(first, t, tr.id).run();
  await env.DB.prepare("DELETE FROM tournament_prizes WHERE tournament_id = ?").bind(tr.id).run();
  const team = (id) => tr.teams.find((x) => x.id === id);
  const paid = [];
  for (const [place, id, coins] of [[1, first, tr.prize_coins], [2, second, Math.floor(tr.prize_coins / 2)]]) {
    const tm = team(id);
    if (!tm) continue;
    for (const m of tm.members) {
      await env.DB.prepare("INSERT OR REPLACE INTO tournament_prizes (tournament_id, user_id, place, coins) VALUES (?, ?, ?, ?)")
        .bind(tr.id, m.id, place, coins).run();
      paid.push(m.id);
    }
  }
  for (const uid of new Set(paid)) await recomputeXP(env, uid);
  const w = team(first);
  await announce(env, `🏆 **${tr.title}** (${tr.game}) terminó — ¡campeones: **${w?.name || "?"}**!` +
    (w ? ` ${w.members.map((m) => m.username).join(", ")}` : "") + (tr.prize_coins ? ` · +🪙 ${tr.prize_coins} c/u` : ""), tr.id);
}

export async function announce(env, content, id) {
  const ch = env.DISCORD_TOURNEY_CHANNEL || env.DISCORD_LFG_CHANNEL;
  if (!env.DISCORD_BOT_TOKEN || !ch) return;
  await discord(env, "POST", `/channels/${ch}/messages`, {
    content: content + `\nhttps://${env.PUBLIC_HOST || "play.moikas.cc"}/tournaments?id=${id}`,
    allowed_mentions: { parse: [] },
  });
}

export function publicTournament(tr, me) {
  const mine = me ? tr.teams.find((t) => t.members.some((m) => m.id === me.id)) : null;
  return {
    id: tr.id, title: tr.title, game: tr.game, format: tr.format, team_size: tr.team_size, max_teams: tr.max_teams,
    starts_at: tr.starts_at, rules: tr.rules, prize_coins: tr.prize_coins, status: tr.status, winner_team_id: tr.winner_team_id,
    points: tr.points, finished_at: tr.finished_at,
    teams: tr.teams.map((t) => ({ id: t.id, name: t.name, captain_id: t.captain_id, members: t.members.map(({ id, username, avatar }) => ({ id, username, avatar })) })),
    matches: tr.matches, results: tr.results, standings: tr.format === "points" ? standings(tr) : null,
    my_team_id: mine ? mine.id : null,
    games_played: tr.format === "points" ? new Set(tr.results.map((r) => r.game_no)).size : null,
  };
}
