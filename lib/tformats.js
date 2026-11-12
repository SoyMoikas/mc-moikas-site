// Tournament formats as pure functions on plain match objects (no DB here, so they're easy to test).
// A match: { id?, round, slot, stage, team_a, team_b, score_a, score_b, winner, win_to, lose_to }
//   team ids > 0 · BYE (-1) = nobody will ever fill this side · null = waiting for an earlier match
//   win_to / lose_to: "M:<round>:<slot>:<a|b>" (where the winner / loser goes) · "FINISH" (this decides 1st/2nd) · "GF" (grand final)
// Stages: SE single elim · W/L double elim winners/losers · GF grand final (round 1, reset = round 2) · RR round robin ·
//         SW swiss · PO playoff after RR/SW · KH king of the hill.
// Round numbers are offset per stage so (round, slot) stays unique: W/SE/RR/SW 1.., L 101.., GF 201.., PO 301.., KH 1..
export const BYE = -1;
export const FORMATS = ["bracket", "double", "roundrobin", "swiss", "points", "koth"];
const ref = (round, slot, side) => `M:${round}:${slot}:${side}`;
const parseRef = (r) => { const [, round, slot, side] = r.split(":"); return { round: +round, slot: +slot, side }; };
const pow2 = (n) => { let s = 2; while (s < n) s *= 2; return s; };
export const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

// Classic seeding order for a bracket of `size`: 1 plays size, 2 plays size-1… arranged so top seeds meet last.
export function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) { const n = order.length * 2 + 1; order = order.flatMap((s) => [s, n - s]); }
  return order;
}

/** Single elimination (stage SE, or PO for playoffs). `ids` in seed order (best first) or already shuffled. */
export function singleElim(ids, { stage = "SE", base = 0 } = {}) {
  const size = pow2(ids.length), rounds = Math.log2(size), order = seedOrder(size);
  const seat = (seed) => ids[seed - 1] ?? BYE;
  const out = [];
  for (let r = 1; r <= rounds; r++) {
    const n = size / 2 ** r;
    for (let s = 0; s < n; s++) {
      const m = { round: base + r, slot: s, stage, team_a: null, team_b: null, win_to: r === rounds ? "FINISH" : ref(base + r + 1, Math.floor(s / 2), s % 2 ? "b" : "a"), lose_to: null };
      if (r === 1) { m.team_a = seat(order[2 * s]); m.team_b = seat(order[2 * s + 1]); }
      out.push(m);
    }
  }
  return out;
}

/** Double elimination: winners bracket (W), losers bracket (L), grand final (GF, with a reset if the losers-side team wins). */
export function doubleElim(ids) {
  if (ids.length < 3) return singleElim(ids);
  const size = pow2(ids.length), R = Math.log2(size), order = seedOrder(size);
  const seat = (seed) => ids[seed - 1] ?? BYE;
  const out = [];
  const Lr = (k) => 100 + k;
  // winners bracket
  for (let r = 1; r <= R; r++) {
    const n = size / 2 ** r;
    for (let s = 0; s < n; s++) {
      const m = { round: r, slot: s, stage: "W", team_a: null, team_b: null };
      if (r === 1) { m.team_a = seat(order[2 * s]); m.team_b = seat(order[2 * s + 1]); }
      m.win_to = r === R ? ref(201, 0, "a") : ref(r + 1, Math.floor(s / 2), s % 2 ? "b" : "a");
      // losers drop into the losers bracket: round 1 losers pair up in L1; later rounds drop into L(2(r-1)), order flipped to avoid rematches
      if (r === 1) m.lose_to = ref(Lr(1), Math.floor(s / 2), s % 2 ? "b" : "a");
      else { const cnt = size / 2 ** r; m.lose_to = ref(Lr(2 * (r - 1)), cnt - 1 - s, "b"); }
      out.push(m);
    }
  }
  // losers bracket: 2(R-1) rounds
  const LR = 2 * (R - 1);
  for (let k = 1; k <= LR; k++) {
    const cnt = k === 1 ? size / 4 : k % 2 === 0 ? size / 2 ** (k / 2 + 1) : size / 2 ** ((k - 1) / 2 + 2);
    for (let s = 0; s < cnt; s++) {
      let win_to;
      if (k === LR) win_to = ref(201, 0, "b");
      else if (k % 2 === 1) win_to = ref(Lr(k + 1), s, "a");            // into the drop-in round, side a
      else win_to = ref(Lr(k + 1), Math.floor(s / 2), s % 2 ? "b" : "a"); // consolidation round pairs up
      out.push({ round: Lr(k), slot: s, stage: "L", team_a: null, team_b: null, win_to, lose_to: null });
    }
  }
  out.push({ round: 201, slot: 0, stage: "GF", team_a: null, team_b: null, win_to: "GF", lose_to: null });
  return out;
}

/** Round robin (circle method). Everyone plays everyone once; odd counts sit out one round each. */
export function roundRobin(ids) {
  const list = [...ids];
  if (list.length % 2) list.push(BYE);
  const n = list.length, out = [];
  for (let r = 0; r < n - 1; r++) {
    let slot = 0;
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a !== BYE && b !== BYE) out.push({ round: r + 1, slot: slot++, stage: "RR", team_a: r % 2 ? b : a, team_b: r % 2 ? a : b, win_to: null, lose_to: null });
    }
    list.splice(1, 0, list.pop()); // rotate everyone but the first
  }
  return out;
}

/** Records from finished matches (byes count as wins). Buchholz = sum of opponents' wins (Swiss tie-break). */
export function records(teamIds, matches) {
  const rec = new Map(teamIds.map((id) => [id, { team_id: id, played: 0, wins: 0, losses: 0, pf: 0, pa: 0, byes: 0, opps: [], streak: 0, best: 0 }]));
  for (const m of matches.filter((x) => x.winner)) {
    for (const [me, op, sf, sa] of [[m.team_a, m.team_b, m.score_a, m.score_b], [m.team_b, m.team_a, m.score_b, m.score_a]]) {
      const r = rec.get(me);
      if (!r) continue;
      if (op === BYE) { r.wins++; r.byes++; continue; }
      r.played++; r.opps.push(op);
      if (m.winner === me) r.wins++; else r.losses++;
      r.pf += sf || 0; r.pa += sa || 0;
    }
  }
  for (const r of rec.values()) r.buchholz = r.opps.reduce((s, o) => s + (rec.get(o)?.wins || 0), 0);
  return rec;
}
export function rankRecords(rec, matches) {
  const h2h = (a, b) => { const m = matches.find((x) => x.winner && ((x.team_a === a && x.team_b === b) || (x.team_a === b && x.team_b === a))); return m ? (m.winner === a ? -1 : 1) : 0; };
  return [...rec.values()].sort((a, b) => b.wins - a.wins || b.buchholz - a.buchholz || (b.pf - b.pa) - (a.pf - a.pa) || h2h(a.team_id, b.team_id) || a.losses - b.losses);
}

/** Next Swiss round: pair people with the same record, never twice against the same opponent if avoidable. */
export function swissRound(teamIds, matches, round) {
  const rec = records(teamIds, matches);
  const ranked = rankRecords(rec, matches).map((r) => r.team_id);
  const played = (a, b) => rec.get(a).opps.includes(b);
  const out = [];
  let pool = [...ranked];
  if (pool.length % 2) { // lowest-ranked player who hasn't had a bye sits out (counts as a win)
    const sit = [...pool].reverse().find((id) => !rec.get(id).byes) ?? pool[pool.length - 1];
    pool = pool.filter((id) => id !== sit);
    out.push({ round, slot: 0, stage: "SW", team_a: sit, team_b: BYE, winner: sit, win_to: null, lose_to: null });
  }
  // backtracking: first look for pairings with no rematches (neighbours in the ranking first); give up after a budget
  let budget = 20000;
  const strict = (left) => {
    if (!left.length) return [];
    if (--budget < 0) return null;
    const [a, ...rest] = left;
    for (let i = 0; i < rest.length; i++) {
      if (played(a, rest[i])) continue;
      const sub = strict(rest.filter((_, j) => j !== i));
      if (sub) return [[a, rest[i]], ...sub];
    }
    return null;
  };
  const greedy = (left) => { const out2 = []; const l = [...left]; while (l.length) { const a = l.shift(); let i = l.findIndex((b) => !played(a, b)); if (i < 0) i = 0; out2.push([a, l.splice(i, 1)[0]]); } return out2; };
  const pair = (left) => strict(left) || greedy(left);
  for (const [a, b] of pair(pool) || []) out.push({ round, slot: out.length, stage: "SW", team_a: a, team_b: b, win_to: null, lose_to: null });
  return out;
}

/** King of the hill: the next challenger is whoever has waited longest (never the holder). */
export function kothNext(teamIds, matches, round) {
  const done = matches.filter((m) => m.stage === "KH" && m.winner);
  const last = done.at(-1);
  const holder = last ? last.winner : null;
  const lastPlayed = new Map(teamIds.map((id) => [id, -1]));
  done.forEach((m, i) => { lastPlayed.set(m.team_a, i); lastPlayed.set(m.team_b, i); });
  const queue = teamIds.filter((id) => id !== holder).sort((a, b) => lastPlayed.get(a) - lastPlayed.get(b) || teamIds.indexOf(a) - teamIds.indexOf(b));
  const a = holder ?? queue.shift(), b = queue.shift();
  if (!a || !b) return null;
  return { round, slot: 0, stage: "KH", team_a: a, team_b: b, win_to: null, lose_to: null };
}
export function kothStats(teamIds, matches) {
  const st = new Map(teamIds.map((id) => [id, { team_id: id, wins: 0, losses: 0, best: 0, cur: 0 }]));
  for (const m of matches.filter((x) => x.stage === "KH" && x.winner)) {
    const w = st.get(m.winner), l = st.get(m.winner === m.team_a ? m.team_b : m.team_a);
    if (w) { w.wins++; w.cur++; w.best = Math.max(w.best, w.cur); }
    if (l) { l.losses++; l.cur = 0; }
  }
  return [...st.values()].sort((a, b) => b.best - a.best || b.wins - a.wins || a.losses - b.losses);
}

/**
 * Record a result on a pointer-based bracket (SE/W/L/GF/PO) and move teams along, auto-advancing byes.
 * Mutates `matches`; returns { changed: Set<match>, finish: [first, second] | null, error? }.
 */
export function advanceBracket(matches, m, winner, scoreA = null, scoreB = null) {
  const changed = new Set();
  const at = (r) => { const p = parseRef(r); return matches.find((x) => x.round === p.round && x.slot === p.slot); };
  let finish = null;
  const place = (to, team) => {
    if (!to) return;
    if (to === "FINISH" || to === "GF") return;
    const p = parseRef(to), t = at(to);
    if (!t) return;
    t[p.side === "a" ? "team_a" : "team_b"] = team; changed.add(t);
    resolveByes(t);
  };
  const decide = (x, w, sa, sb) => {
    x.winner = w; x.score_a = sa; x.score_b = sb; changed.add(x);
    const loser = w === x.team_a ? x.team_b : x.team_a;
    if (x.stage === "GF") {
      if (x.round === 201 && w === x.team_b && w !== BYE && x.team_a !== BYE) { // losers-side team won: bracket reset
        let reset = matches.find((y) => y.stage === "GF" && y.round === 202);
        if (!reset) { reset = { round: 202, slot: 0, stage: "GF", win_to: "GF", lose_to: null }; matches.push(reset); }
        Object.assign(reset, { team_a: x.team_a, team_b: x.team_b, winner: null, score_a: null, score_b: null }); changed.add(reset);
      } else finish = [w, loser];
      return;
    }
    if (x.win_to === "FINISH") { finish = [w, loser === BYE ? null : loser]; return; }
    place(x.win_to, w);
    place(x.lose_to, loser);
  };
  const resolveByes = (x) => {
    if (x.winner || x.team_a == null || x.team_b == null) return;
    if (x.team_a === BYE || x.team_b === BYE) decide(x, x.team_a === BYE ? x.team_b : x.team_a, null, null);
  };
  // re-reporting: take the old result back out of the bracket first (fails if a later real match already has a result)
  if (m.winner) { const u = undoBracket(matches, m, changed); if (!u) return { changed, finish: null, error: "next_decided" }; }
  decide(m, winner, scoreA, scoreB);
  return { changed, finish };
}
/** Resolve every bye at the start (call once right after generating a bracket). */
export function settleInitialByes(matches) {
  const changed = new Set();
  let finish = null;
  for (let pass = 0; pass < 8; pass++) {
    const x = matches.find((y) => !y.winner && y.team_a != null && y.team_b != null && (y.team_a === BYE || y.team_b === BYE) && ["SE", "W", "L", "PO", "GF"].includes(y.stage));
    if (!x) break;
    const r = advanceBracket(matches, x, x.team_a === BYE ? x.team_b : x.team_a);
    r.changed.forEach((c) => changed.add(c));
    if (r.finish) finish = r.finish;
  }
  return { changed, finish };
}

/** Take a result back, clearing where its winner/loser went. Byes that were auto-decided downstream are undone too.
 *  Returns false (and changes nothing useful) if a later real match already has a result. */
export function undoBracket(matches, x, changed = new Set()) {
  const at = (r) => { const p = parseRef(r); return matches.find((y) => y.round === p.round && y.slot === p.slot); };
  const loser = x.winner === x.team_a ? x.team_b : x.team_a;
  if (x.stage === "GF" && x.round === 201) {
    const reset = matches.find((y) => y.stage === "GF" && y.round === 202);
    if (reset?.winner) return false;
    if (reset && reset.team_a != null) { Object.assign(reset, { team_a: null, team_b: null }); changed.add(reset); }
  }
  for (const [to, team] of [[x.win_to, x.winner], [x.lose_to, loser]]) {
    if (!to || to === "FINISH" || to === "GF") continue;
    const t = at(to);
    if (!t) continue;
    if (t.winner) {
      const auto = t.team_a === BYE || t.team_b === BYE;
      if (!auto || !undoBracket(matches, t, changed)) return false;
    }
    const side = parseRef(to).side === "a" ? "team_a" : "team_b";
    if (t[side] === team) { t[side] = null; changed.add(t); }
  }
  x.winner = null; x.score_a = null; x.score_b = null; changed.add(x);
  return true;
}
/** Can this result still be changed? (dry run on a copy) */
export function lockedBy(matches, m) {
  if (!m.winner || !["SE", "W", "L", "GF", "PO"].includes(m.stage)) return false;
  const copy = matches.map((x) => ({ ...x }));
  return !undoBracket(copy, copy.find((x) => x.round === m.round && x.slot === m.slot));
}
