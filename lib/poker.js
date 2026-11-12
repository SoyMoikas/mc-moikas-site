// Texas Hold'em (no-limit) for the Casino. The whole table lives in poker_tables.state as JSON and every change is
// written with an optimistic version check, so two clicks at once can't corrupt a hand. Clients poll GET every few
// seconds; any request (or the NAS bot's tick) moves the game along: timeouts, starting the next hand, cash-outs.
// Chips are coins: buying in spends coins, leaving pays the stack back with award() (unique ref per cash-out).
import { now } from "./util.js";
import { spend, award } from "./coins.js";

export const TURN_MS = 30_000;      // time to act before you're auto-checked / folded
export const NEXT_HAND_MS = 6_000;  // pause to see the result before the next deal
export const SITOUT_KICK_MS = 15 * 60_000; // sitting out this long → cashed out and removed
const RANKS = "23456789TJQKA", SUITS = "shdc";

// ---------------- cards & hand ranking ----------------
function shuffledDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  const rnd = new Uint32Array(deck.length);
  crypto.getRandomValues(rnd);
  for (let i = deck.length - 1; i > 0; i--) { const j = rnd[i] % (i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
const rv = (c) => RANKS.indexOf(c[0]) + 2;

// Score of exactly 5 cards: [category, ...tiebreakers]; compare arrays left to right.
function score5(cards) {
  const v = cards.map(rv).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const uniq = [...new Set(v)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (v[0] - v[4] === 4) straightHigh = v[0];
    else if (v.join() === "14,5,4,3,2") straightHigh = 5; // wheel
  }
  const counts = {};
  for (const x of v) counts[x] = (counts[x] || 0) + 1;
  const groups = Object.entries(counts).map(([k, n]) => [n, +k]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const byGroup = groups.map((g) => g[1]);
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][0] === 4) return [7, ...byGroup];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...byGroup];
  if (flush) return [5, ...v];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, ...byGroup];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...byGroup];
  if (groups[0][0] === 2) return [1, ...byGroup];
  return [0, ...v];
}
export const cmpScore = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
/** Best 5 of 5–7 cards → { score, cards }. */
export function bestHand(cards) {
  let best = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
    const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
    const s = score5(five);
    if (!best || cmpScore(s, best.score) > 0) best = { score: s, cards: five };
  }
  return best;
}
export const HAND_NAMES = ["high", "pair", "twopair", "trips", "straight", "flush", "full", "quads", "sflush"];

// ---------------- table state ----------------
export function emptyState(seats) { return { seats: Array(seats).fill(null), hand: null, last: null, handNo: 0, dealer: -1, lastEnd: 0, log: [] }; }
const log = (st, msg) => { st.log = [...(st.log || []), msg].slice(-14); };
const nextSeat = (st, from, ok) => { const n = st.seats.length; for (let i = 1; i <= n; i++) { const s = (from + i + n) % n; if (ok(s)) return s; } return -1; };
const ready = (st, table) => (s) => { const p = st.seats[s]; return p && !p.sitOut && p.chips > 0; };

function startHand(st, table, t) {
  const can = ready(st, table);
  const seated = st.seats.map((_, i) => i).filter(can);
  if (seated.length < 2) return false;
  const dealer = nextSeat(st, st.dealer, can);
  const heads = seated.length === 2;
  const sbSeat = heads ? dealer : nextSeat(st, dealer, can);
  const bbSeat = nextSeat(st, sbSeat, can);
  const deck = shuffledDeck();
  const players = {};
  for (const s of seated) players[s] = { cards: [deck.pop(), deck.pop()], bet: 0, total: 0, folded: false, allin: false, acted: false };
  const h = { no: (st.handNo || 0) + 1, dealer, sbSeat, bbSeat, deck, board: [], street: "preflop", players, currentBet: 0, minRaise: table.bb, toAct: -1, turnStarted: t };
  st.hand = h; st.handNo = h.no; st.dealer = dealer; st.last = null;
  const post = (s, amt) => { const p = players[s], seat = st.seats[s]; const x = Math.min(amt, seat.chips); seat.chips -= x; p.bet += x; p.total += x; if (!seat.chips) p.allin = true; };
  post(sbSeat, table.sb); post(bbSeat, table.bb);
  h.currentBet = table.bb;
  h.toAct = nextActor(st, bbSeat);
  log(st, `#${h.no} · ${st.seats[dealer].name} reparte`);
  if (h.toAct === -1) runOut(st, table, t);
  return true;
}

const live = (h) => Object.entries(h.players).filter(([, p]) => !p.folded).map(([s]) => +s);
const canAct = (h) => Object.entries(h.players).filter(([, p]) => !p.folded && !p.allin).map(([s]) => +s);
function nextActor(st, from) {
  const h = st.hand;
  return nextSeat(st, from, (s) => { const p = h.players[s]; return p && !p.folded && !p.allin && (!p.acted || p.bet < h.currentBet); });
}

function endStreet(st, table, t) {
  const h = st.hand;
  for (const p of Object.values(h.players)) { p.bet = 0; p.acted = false; }
  h.currentBet = 0; h.minRaise = table.bb;
  if (h.street === "river") return showdown(st, table, t);
  const deal = (n) => { h.deck.pop(); for (let i = 0; i < n; i++) h.board.push(h.deck.pop()); }; // burn + deal
  if (h.street === "preflop") { deal(3); h.street = "flop"; } else if (h.street === "flop") { deal(1); h.street = "turn"; } else { deal(1); h.street = "river"; }
  if (canAct(h).length <= 1) return endStreet(st, table, t); // everyone (but one) all-in: run the board out
  h.toAct = nextActor(st, h.dealer);
  h.turnStarted = t;
}
function runOut(st, table, t) { while (st.hand && st.hand.street !== "showdown") endStreet(st, table, t); }

// Pots (with side pots) → winners. Returns nothing; pays chips onto seats and records st.last.
function showdown(st, table, t, onlyWinner = null) {
  const h = st.hand;
  const entries = Object.entries(h.players).map(([s, p]) => ({ seat: +s, ...p }));
  const total = entries.reduce((n, e) => n + e.total, 0);
  const won = {};
  const shown = {};
  const names = {};
  const pay = (seat, amt) => { won[seat] = (won[seat] || 0) + amt; if (st.seats[seat]) st.seats[seat].chips += amt; };
  if (onlyWinner !== null) pay(onlyWinner, total);
  else {
    const contenders = entries.filter((e) => !e.folded);
    const scores = {};
    for (const e of contenders) { const b = bestHand([...e.cards, ...h.board]); scores[e.seat] = b.score; shown[e.seat] = e.cards; names[e.seat] = HAND_NAMES[b.score[0]]; }
    const levels = [...new Set(entries.map((e) => e.total).filter((x) => x > 0))].sort((a, b) => a - b);
    let prev = 0;
    for (const lv of levels) {
      const portion = entries.reduce((n, e) => n + Math.max(0, Math.min(e.total, lv) - prev), 0);
      let elig = contenders.filter((e) => e.total >= lv);
      if (!elig.length) elig = contenders;
      const best = elig.reduce((b, e) => (!b || cmpScore(scores[e.seat], scores[b[0].seat]) > 0 ? [e] : cmpScore(scores[e.seat], scores[b[0].seat]) === 0 ? [...b, e] : b), null);
      const share = Math.floor(portion / best.length);
      let rest = portion - share * best.length;
      // odd chips go to the first winner left of the dealer
      const order = [...best].sort((a, b) => ((a.seat - h.dealer + 100) % st.seats.length) - ((b.seat - h.dealer + 100) % st.seats.length));
      for (const w of order) { pay(w.seat, share + (rest > 0 ? 1 : 0)); rest--; }
      prev = lv;
    }
  }
  const winners = Object.entries(won).map(([s, amount]) => ({ seat: +s, name: st.seats[+s]?.name || h.names?.[s] || "?", amount, hand: names[s] || null }));
  st.last = { no: h.no, board: h.board, winners, shown, pot: total, endedAt: t };
  log(st, winners.map((w) => `${w.name} gana ${w.amount}${w.hand ? ` (${w.hand})` : ""}`).join(" · "));
  st.hand = null; st.lastEnd = t;
}

function afterAction(st, table, t, seat) {
  const h = st.hand;
  const alive = live(h);
  if (alive.length === 1) return showdown(st, table, t, alive[0]);
  const acting = canAct(h);
  const done = acting.length === 0 || acting.every((s) => h.players[s].acted && h.players[s].bet === h.currentBet)
    || (acting.length === 1 && h.players[acting[0]].bet >= h.currentBet);
  if (done) return endStreet(st, table, t);
  h.toAct = nextActor(st, seat);
  h.turnStarted = t;
  if (h.toAct === -1) { endStreet(st, table, t); }
}

/** A player's move. Returns an error string, or null when applied. */
export function act(st, table, seat, action, amount, t = now()) {
  const h = st.hand;
  if (!h || h.toAct !== seat) return "not_your_turn";
  const p = h.players[seat], s = st.seats[seat];
  const toCall = h.currentBet - p.bet;
  const put = (x) => { x = Math.min(x, s.chips); s.chips -= x; p.bet += x; p.total += x; if (!s.chips) p.allin = true; };
  if (action === "fold") { p.folded = true; log(st, `${s.name} se retira`); }
  else if (action === "check") { if (toCall > 0) return "cant_check"; log(st, `${s.name} pasa`); }
  else if (action === "call") { if (toCall <= 0) return "nothing_to_call"; put(toCall); log(st, `${s.name} iguala ${p.bet}`); }
  else if (action === "allin" && p.bet + s.chips <= h.currentBet) { put(s.chips); log(st, `${s.name} va all-in (${p.bet})`); } // all-in that's only a call
  else if (action === "raise" || action === "allin") {
    const to = action === "allin" ? p.bet + s.chips : Math.floor(Number(amount));
    if (!Number.isFinite(to) || to <= h.currentBet) return "too_small";
    if (to > p.bet + s.chips) return "not_enough";
    const allIn = to === p.bet + s.chips;
    if (!allIn && to - h.currentBet < h.minRaise) return "min_raise";
    const inc = to - h.currentBet;
    put(to - p.bet);
    if (inc >= h.minRaise) h.minRaise = inc;
    h.currentBet = Math.max(h.currentBet, p.bet);
    for (const [k, q] of Object.entries(h.players)) if (+k !== seat && !q.folded && !q.allin) q.acted = false;
    log(st, allIn ? `${s.name} va all-in (${p.bet})` : `${s.name} sube a ${p.bet}`);
  } else return "bad_action";
  p.acted = true;
  s.timeouts = 0;
  afterAction(st, table, t, seat);
  return null;
}

/** Moves the table along without anyone clicking: turn timeouts, the next deal, kicking long sit-outs.
 *  Returns { changed, cashouts: [{ uid, chips }] } — the caller pays cash-outs AFTER saving. */
export function advance(st, table, t = now()) {
  let changed = false;
  const cashouts = [];
  for (let guard = 0; guard < 4; guard++) {
    const h = st.hand;
    if (h && h.toAct >= 0 && t - h.turnStarted > TURN_MS) {
      const seat = h.toAct, s = st.seats[seat];
      const toCall = h.currentBet - h.players[seat].bet;
      const strikes = (s?.timeouts || 0) + 1;
      act(st, table, seat, toCall > 0 || !s ? "fold" : "check", 0, t);
      if (s) { s.timeouts = strikes; if (strikes >= 2) { s.sitOut = true; s.sitSince = t; } } // act() resets it; keep the strike
      changed = true;
      continue;
    }
    if (!h && t - (st.lastEnd || 0) > NEXT_HAND_MS && startHand(st, table, t)) { changed = true; continue; }
    break;
  }
  st.seats.forEach((s, i) => {
    if (s && s.sitOut && !(st.hand?.players[i] && !st.hand.players[i].folded) && t - (s.sitSince || t) > SITOUT_KICK_MS) {
      cashouts.push({ uid: s.uid, chips: s.chips }); st.seats[i] = null; changed = true; log(st, `${s.name} se levantó (ausente)`);
    }
  });
  return { changed, cashouts };
}

/** Stand up: fold if you're in the hand, take your stack (minus what's already in the pot). */
export function leave(st, table, seat) {
  const s = st.seats[seat];
  if (!s) return null;
  const h = st.hand;
  if (h?.players[seat] && !h.players[seat].folded) {
    if (h.toAct === seat) act(st, table, seat, "fold");
    else { h.players[seat].folded = true; const alive = live(h); if (alive.length === 1) showdown(st, table, now(), alive[0]); }
  }
  if (h?.players[seat]) (h.names ||= {})[seat] = s.name;
  st.seats[seat] = null;
  log(st, `${s.name} se levantó`);
  return { uid: s.uid, chips: s.chips };
}

/** What one viewer may see: no deck, no other players' cards (except the last showdown). */
export function view(st, table, uid, t = now()) {
  const h = st.hand;
  const mySeat = st.seats.findIndex((s) => s?.uid === uid);
  const seats = st.seats.map((s, i) => {
    if (!s) return null;
    const p = h?.players[i];
    return { seat: i, uid: s.uid, name: s.name, avatar: s.avatar, chips: s.chips, sitOut: !!s.sitOut,
      inHand: !!p, folded: !!p?.folded, allin: !!p?.allin, bet: p?.bet || 0, cards: p ? (i === mySeat ? p.cards : ["??", "??"]) : null,
      shown: st.last?.shown?.[i] || null, dealer: h ? h.dealer === i : st.dealer === i, sb: h?.sbSeat === i, bb: h?.bbSeat === i };
  });
  let me = null;
  if (mySeat >= 0) {
    const p = h?.players[mySeat], s = st.seats[mySeat];
    const toCall = h && p ? Math.max(0, h.currentBet - p.bet) : 0;
    me = { seat: mySeat, chips: s.chips, sitOut: !!s.sitOut, turn: !!h && h.toAct === mySeat, toCall: Math.min(toCall, s.chips),
      minRaiseTo: h ? Math.min(h.currentBet + h.minRaise, p ? p.bet + s.chips : 0) : 0, maxRaiseTo: p ? p.bet + s.chips : 0,
      canCheck: !!h && toCall === 0, best: p && h.board.length ? HAND_NAMES[bestHand([...p.cards, ...h.board]).score[0]] : null };
  }
  return {
    id: table.id, name: table.name, sb: table.sb, bb: table.bb, min_buyin: table.min_buyin, max_buyin: table.max_buyin, status: table.status,
    seats, me, version: table.version,
    hand: h ? { no: h.no, street: h.street, board: h.board, pot: Object.values(h.players).reduce((n, p) => n + p.total, 0), currentBet: h.currentBet,
      toAct: h.toAct, turnLeft: Math.max(0, TURN_MS - (t - h.turnStarted)) } : null,
    last: st.last, nextIn: !h ? Math.max(0, NEXT_HAND_MS - (t - (st.lastEnd || 0))) : null, log: st.log || [],
  };
}

// ---------------- DB plumbing ----------------
export async function loadTable(env, id) {
  const r = await env.DB.prepare("SELECT * FROM poker_tables WHERE id = ?").bind(id).first();
  if (!r) return null;
  let st; try { st = JSON.parse(r.state || "{}"); } catch { st = {}; }
  if (!Array.isArray(st.seats)) st = emptyState(r.seats);
  return { table: r, st };
}
/** Load → fn(st, table) → save if the version didn't move; retries a few times. fn returns { result, changed, cashouts }. */
export async function mutate(env, id, fn) {
  for (let i = 0; i < 4; i++) {
    const loaded = await loadTable(env, id);
    if (!loaded) return { error: "not_found" };
    const { table, st } = loaded;
    const out = (await fn(st, table)) || {};
    if (out.error) return out;
    if (out.changed === false) return { ...out, st, table };
    const t = now();
    const r = await env.DB.prepare("UPDATE poker_tables SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .bind(JSON.stringify(st), t, id, table.version).run();
    if (r.meta.changes) {
      for (const c of out.cashouts || []) await cashOut(env, table.id, c);
      table.version += 1;
      return { ...out, st, table };
    }
  }
  return { error: "busy" };
}
export async function cashOut(env, tableId, c) {
  if (c?.uid && c.chips > 0) await award(env, c.uid, "poker", `t${tableId}-${now()}-${Math.random().toString(36).slice(2, 8)}`, c.chips);
}
export { spend };

/** NAS bot tick: keep idle tables moving (timeouts, kicks) even when nobody has the page open. */
export async function pokerTick(env) {
  const { results } = await env.DB.prepare("SELECT id FROM poker_tables WHERE status = 'open' AND state LIKE '%\"uid\"%'").all();
  let n = 0;
  for (const { id } of results) { const r = await mutate(env, id, (st, table) => advance(st, table)); if (r.changed) n++; }
  return n;
}
