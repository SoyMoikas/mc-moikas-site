import { ensureMarket, settleByRef } from "./markets.js";
// Tournaments: brackets (single / double elimination), round robin leagues, Swiss, king of the hill and Apex-style points.
// The format logic itself is pure and lives in tformats.js; this file loads/saves matches and pays out.
import { BYE, FORMATS, shuffle, singleElim, doubleElim, roundRobin, swissRound, kothNext, kothStats, records, rankRecords, advanceBracket, settleInitialByes, lockedBy } from "./tformats.js";
import { now } from "./util.js";
import { recomputeXP } from "./xp.js";
import { discord, site } from "./lfg.js";

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
  tr.config = { best_of: 1, swiss_rounds: null, playoff: 0, ...(tr.config ? JSON.parse(tr.config) : {}) };
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
  await matchMarkets(env, fresh);
  for (const m of fresh.matches.filter((m) => m.round === 1 && (m.team_a === null) !== (m.team_b === null))) {
    await setMatchWinner(env, fresh, m, m.team_a ?? m.team_b, null, null);
  }
}

export async function setMatchWinner(env, tr, m, winner, scoreA, scoreB) {
  await env.DB.prepare("UPDATE tournament_matches SET winner = ?, score_a = ?, score_b = ? WHERE id = ?")
    .bind(winner, scoreA, scoreB, m.id).run();
  if (m.team_a && m.team_b) await settleByRef(env, "match", m.id, winner);
  const rounds = Math.max(...tr.matches.map((x) => x.round));
  if (m.round === rounds) {
    const second = winner === m.team_a ? m.team_b : m.team_a;
    return finish(env, tr, [winner, second]);
  }
  const col = m.slot % 2 === 0 ? "team_a" : "team_b";
  await env.DB.prepare(`UPDATE tournament_matches SET ${col} = ?, winner = NULL, score_a = NULL, score_b = NULL WHERE tournament_id = ? AND round = ? AND slot = ?`)
    .bind(winner, tr.id, m.round + 1, Math.floor(m.slot / 2)).run();
  await matchMarkets(env, await loadTournament(env, tr.id));
}

// A prediction for every bracket match that has both teams, plus one for the whole tournament.
export async function matchMarkets(env, tr) {
  const name = (id) => tr.teams.find((t) => t.id === id)?.name || "?";
  for (const m of tr.matches.filter((x) => x.team_a > 0 && x.team_b > 0 && !x.winner)) {
    await ensureMarket(env, { kind: "match", ref: m.id, title: `${tr.title}: ${name(m.team_a)} vs ${name(m.team_b)}`,
      options: [{ label: name(m.team_a), ref: m.team_a }, { label: name(m.team_b), ref: m.team_b }] });
  }
}
export async function tourneyMarket(env, tr) {
  if (tr.teams.length < 2) return;
  await ensureMarket(env, { kind: "tourney", ref: tr.id, title: `¿Quién gana ${tr.title}?`, options: tr.teams.map((t) => ({ label: t.name, ref: t.id })) });
}

// Pay out: 1st place gets the prize, 2nd gets half — each player on the team.
export async function finish(env, tr, [first, second]) {
  const t = now();
  await env.DB.prepare("UPDATE tournaments SET status = 'done', winner_team_id = ?, finished_at = ? WHERE id = ?").bind(first, t, tr.id).run();
  await settleByRef(env, "tourney", tr.id, first);
  await env.DB.prepare("DELETE FROM tournament_prizes WHERE tournament_id = ?").bind(tr.id).run();
  const team = (id) => tr.teams.find((x) => x.id === id);
  const paid = [];
  for (const [place, id, coins] of [[1, first, tr.prize_coins], [2, second, Math.floor(tr.prize_coins / 2)]]) {
    const tm = id > 0 && team(id);
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
    content: content + `\n${site(env)}/tournaments?id=${id}`,
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
    matches: tr.matches.map((m) => ({ ...m, can_report: canReport(tr, m) })), results: tr.results,
    standings: tr.format === "points" ? standings(tr) : null, table: matchStandings(tr), config: tr.config,
    my_team_id: mine ? mine.id : null,
    games_played: tr.format === "points" ? new Set(tr.results.map((r) => r.game_no)).size : null,
  };
}

// ---------------- formats ----------------
async function saveMatches(env, tr, list) {
  const stmts = [];
  for (const m of list) {
    if (m.id) stmts.push(env.DB.prepare("UPDATE tournament_matches SET team_a = ?, team_b = ?, score_a = ?, score_b = ?, winner = ? WHERE id = ?")
      .bind(m.team_a ?? null, m.team_b ?? null, m.score_a ?? null, m.score_b ?? null, m.winner ?? null, m.id));
    else stmts.push(env.DB.prepare(`INSERT INTO tournament_matches (tournament_id, round, slot, stage, team_a, team_b, score_a, score_b, winner, win_to, lose_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tournament_id, round, slot) DO UPDATE SET team_a = excluded.team_a, team_b = excluded.team_b, winner = excluded.winner, score_a = excluded.score_a, score_b = excluded.score_b`)
      .bind(tr.id, m.round, m.slot, m.stage, m.team_a ?? null, m.team_b ?? null, m.score_a ?? null, m.score_b ?? null, m.winner ?? null, m.win_to ?? null, m.lose_to ?? null));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

/** Build the first matches for any format (replaces startBracket for new tournaments). */
export async function startFormat(env, tr) {
  const ids = tr.teams.map((t) => t.id);
  let ms = [];
  if (tr.format === "bracket") ms = singleElim(shuffle(ids));
  else if (tr.format === "double") ms = doubleElim(shuffle(ids));
  else if (tr.format === "roundrobin") ms = roundRobin(shuffle(ids));
  else if (tr.format === "swiss") {
    const rounds = Math.min(ids.length - 1, tr.config.swiss_rounds || Math.ceil(Math.log2(ids.length)));
    tr.config.swiss_rounds = rounds;
    await env.DB.prepare("UPDATE tournaments SET config = ? WHERE id = ?").bind(JSON.stringify(tr.config), tr.id).run();
    ms = swissRound(shuffle(ids), [], 1);
  } else if (tr.format === "koth") ms = [kothNext(shuffle(ids), [], 1)];
  if (!ms.length) return;
  await saveMatches(env, tr, ms);
  const fresh = await loadTournament(env, tr.id);
  const { changed, finish: fin } = settleInitialByes(fresh.matches);
  if (changed.size) await saveMatches(env, fresh, [...changed]);
  if (fin) return finish(env, fresh, fin);
  await matchMarkets(env, await loadTournament(env, tr.id));
}

const POINTER = ["SE", "W", "L", "GF", "PO"];
/** Can staff (re)report this match right now? */
export function canReport(tr, m) {
  if (tr.status !== "running" || !(m.team_a > 0 && m.team_b > 0)) return false;
  if (!m.stage) return true; // legacy bracket
  if (POINTER.includes(m.stage)) return !lockedBy(tr.matches, m);
  if (m.stage === "RR") return !tr.matches.some((x) => x.stage === "PO");
  if (m.stage === "SW") return m.round === Math.max(...tr.matches.filter((x) => x.stage === "SW").map((x) => x.round)) && !tr.matches.some((x) => x.stage === "PO");
  if (m.stage === "KH") return m === tr.matches.filter((x) => x.stage === "KH").at(-1);
  return false;
}

/** Record a match result for any format. Returns an error string or null. */
export async function reportResult(env, tr, m, winner, sa, sb) {
  if (!m.stage) { await setMatchWinner(env, tr, m, winner, sa, sb); return null; } // tournaments started before the new formats
  if (!canReport(tr, m)) return "locked";
  if (POINTER.includes(m.stage)) {
    const r = advanceBracket(tr.matches, m, winner, sa, sb);
    if (r.error) return r.error;
    await saveMatches(env, tr, [...r.changed]);
    await settleByRef(env, "match", m.id, winner);
    if (r.finish) return finish(env, tr, r.finish).then(() => null);
    await matchMarkets(env, await loadTournament(env, tr.id));
    return null;
  }
  Object.assign(m, { winner, score_a: sa, score_b: sb });
  await saveMatches(env, tr, [m]);
  await settleByRef(env, "match", m.id, winner);
  const ids = tr.teams.map((t) => t.id);
  if (m.stage === "RR" && tr.matches.filter((x) => x.stage === "RR").every((x) => x.winner)) await afterGroupStage(env, tr);
  if (m.stage === "SW") {
    const sw = tr.matches.filter((x) => x.stage === "SW");
    const round = Math.max(...sw.map((x) => x.round));
    if (sw.filter((x) => x.round === round).every((x) => x.winner)) {
      if (round < (tr.config.swiss_rounds || 3)) await saveMatches(env, tr, swissRound(ids, sw, round + 1));
      else await afterGroupStage(env, tr);
    }
  }
  if (m.stage === "KH") {
    const next = kothNext(ids, tr.matches, m.round + 1);
    if (next && !tr.matches.some((x) => x.stage === "KH" && x.round === m.round + 1)) await saveMatches(env, tr, [next]);
  }
  await matchMarkets(env, await loadTournament(env, tr.id));
  return null;
}

/** Round robin / Swiss done: playoff for the top N, or finish with the table. */
async function afterGroupStage(env, tr) {
  const group = tr.matches.filter((x) => x.stage === "RR" || x.stage === "SW");
  const ranked = rankRecords(records(tr.teams.map((t) => t.id), group), group).map((r) => r.team_id);
  const n = Math.min(tr.config.playoff || 0, ranked.length);
  if (n >= 2) {
    const po = singleElim(ranked.slice(0, n), { stage: "PO", base: 300 });
    await saveMatches(env, tr, po);
    const fresh = await loadTournament(env, tr.id);
    const r = settleInitialByes(fresh.matches);
    if (r.changed.size) await saveMatches(env, fresh, [...r.changed]);
    return;
  }
  await finish(env, tr, [ranked[0], ranked[1]]);
}

/** Standings for the match formats (round robin / Swiss / KOTH) with names. */
export function matchStandings(tr) {
  const name = (id) => tr.teams.find((t) => t.id === id)?.name || "?";
  if (tr.format === "koth") return kothStats(tr.teams.map((t) => t.id), tr.matches).map((r) => ({ ...r, name: name(r.team_id) }));
  if (tr.format === "roundrobin" || tr.format === "swiss") {
    const group = tr.matches.filter((x) => x.stage === "RR" || x.stage === "SW");
    return rankRecords(records(tr.teams.map((t) => t.id), group), group).map(({ opps, ...r }) => ({ ...r, name: name(r.team_id) }));
  }
  return null;
}
/** Staff ends KOTH / a league early: 1st and 2nd from the table. */
export function earlyPodium(tr) {
  const st = matchStandings(tr);
  return st && st.length ? [st[0].team_id, st[1]?.team_id] : null;
}
export { FORMATS, BYE };
