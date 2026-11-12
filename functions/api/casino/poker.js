import { getUser, need, hasRole } from "../../../lib/auth.js";
import { json, body, str, int, now, err } from "../../../lib/util.js";
import { spend, award } from "../../../lib/coins.js";
import { loadTable, mutate, advance, act, leave, view, emptyState } from "../../../lib/poker.js";

const ERR = { not_your_turn: "It's not your turn", cant_check: "You can't check — there's a bet", nothing_to_call: "Nothing to call",
  too_small: "Raise must be higher than the current bet", min_raise: "That raise is too small", not_enough: "You don't have that many chips", bad_action: "Bad action", busy: "The table is busy, try again" };

// GET /api/casino/poker → tables · ?id=N → that table as you see it (also moves it along: timeouts, next deal)
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ tables: [] });
  const id = int(new URL(request.url).searchParams.get("id"), "id");
  if (!id) {
    const { results } = await env.DB.prepare("SELECT id, name, sb, bb, min_buyin, max_buyin, seats, status, state FROM poker_tables WHERE status = 'open' ORDER BY id").all();
    return json({ staff: hasRole(me, "staff"), tables: results.map(({ state, ...r }) => {
      let st = {}; try { st = JSON.parse(state || "{}"); } catch { /* empty */ }
      const seated = (st.seats || []).filter(Boolean);
      return { ...r, seated: seated.length, players: seated.map((s) => ({ name: s.name, avatar: s.avatar })), playing: !!st.hand, mine: seated.some((s) => s.uid === me.id) };
    }) });
  }
  const r = await mutate(env, id, (st, table) => advance(st, table));
  if (r.error) return err(r.error === "not_found" ? 404 : 503, ERR[r.error] || r.error);
  return json({ ...view(r.st, r.table, me.id), staff: hasRole(me, "staff") });
}

// POST /api/casino/poker {id, action}
//   sit {seat, buyin} · leave · rebuy {amount} · back (stop sitting out) · act {move: fold|check|call|raise|allin, amount}
//   staff: create {name, sb, bb, min_buyin, max_buyin, seats} · close {id}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const staff = hasRole(me, "staff");
  const t = now();

  if (b.action === "create") {
    if (!staff) return err(403, "Staff only");
    const name = str(b.name, 40, "name") || "Mesa";
    const bb = Math.max(2, int(b.bb, "bb") || 10), sb = Math.max(1, Math.min(bb, int(b.sb, "sb") || Math.floor(bb / 2)));
    const min = Math.max(bb * 10, int(b.min_buyin, "min_buyin") || bb * 10), max = Math.max(min, int(b.max_buyin, "max_buyin") || bb * 100);
    const seats = Math.min(9, Math.max(2, int(b.seats, "seats") || 6));
    const r = await env.DB.prepare("INSERT INTO poker_tables (name, sb, bb, min_buyin, max_buyin, seats, state, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(name, sb, bb, min, max, seats, JSON.stringify(emptyState(seats)), me.id, t, t).run();
    return json({ id: r.meta.last_row_id });
  }

  const id = int(b.id, "id");
  const loaded = id && await loadTable(env, id);
  if (!loaded) return err(404, "Table not found");
  if (loaded.table.status !== "open") return err(409, "This table is closed");

  if (b.action === "close") {
    if (!staff) return err(403, "Staff only");
    const r = await mutate(env, id, (st) => {
      // cancel any hand in progress: everyone gets back their stack plus what they had put in the pot
      const back = {};
      if (st.hand) for (const [s, p] of Object.entries(st.hand.players)) { const u = st.seats[s]?.uid; if (u) back[u] = (back[u] || 0) + p.total; }
      st.hand = null;
      const cashouts = st.seats.filter(Boolean).map((s) => ({ uid: s.uid, chips: s.chips + (back[s.uid] || 0) }));
      st.seats = st.seats.map(() => null);
      return { cashouts };
    });
    if (r.error) return err(503, ERR[r.error] || r.error);
    await env.DB.prepare("UPDATE poker_tables SET status = 'closed' WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  if (b.action === "sit") {
    const { table, st } = loaded;
    if (st.seats.some((s) => s?.uid === me.id)) return err(409, "You're already at this table");
    const buyin = int(b.buyin, "buyin");
    if (!buyin || buyin < table.min_buyin || buyin > table.max_buyin) return err(400, `Buy-in must be ${table.min_buyin}–${table.max_buyin}`);
    if (!(await spend(env, me.id, buyin))) return err(402, "Not enough coins");
    const seat = int(b.seat, "seat");
    const r = await mutate(env, id, (st2, table2) => {
      if (st2.seats.some((s) => s?.uid === me.id)) return { error: "already" };
      let i = seat != null && seat >= 0 && seat < st2.seats.length && !st2.seats[seat] ? seat : st2.seats.findIndex((s) => !s);
      if (i < 0) return { error: "full" };
      st2.seats[i] = { uid: me.id, name: me.username, avatar: me.avatar || null, chips: buyin, joined: t, timeouts: 0 };
      (st2.log ||= []).push(`${me.username} se sentó con ${buyin}`);
      const a = advance(st2, table2, t);
      return { cashouts: a.cashouts };
    });
    if (r.error) { // give the coins back
      await award(env, me.id, "poker_refund", `sit-${id}-${t}`, buyin);
      return err(409, r.error === "full" ? "The table is full" : r.error === "already" ? "You're already at this table" : ERR[r.error] || r.error);
    }
    return json(view(r.st, r.table, me.id));
  }

  if (b.action === "rebuy") {
    const amount = int(b.amount, "amount");
    const s = loaded.st.seats.find((x) => x?.uid === me.id);
    if (!s) return err(409, "Sit down first");
    const inHand = loaded.st.hand?.players[loaded.st.seats.indexOf(s)] && !loaded.st.hand.players[loaded.st.seats.indexOf(s)].folded;
    if (inHand) return err(409, "Wait until this hand is over");
    if (!amount || amount < 1 || s.chips + amount > loaded.table.max_buyin) return err(400, `You can have at most ${loaded.table.max_buyin} chips here`);
    if (!(await spend(env, me.id, amount))) return err(402, "Not enough coins");
    const r = await mutate(env, id, (st2) => {
      const x = st2.seats.find((q) => q?.uid === me.id);
      if (!x || x.chips + amount > loaded.table.max_buyin) return { error: "gone" };
      x.chips += amount; x.sitOut = false; x.timeouts = 0;
      return {};
    });
    if (r.error) { await award(env, me.id, "poker_refund", `rebuy-${id}-${t}`, amount); return err(409, "Couldn't add chips, try again"); }
    return json(view(r.st, r.table, me.id));
  }

  const r = await mutate(env, id, (st, table) => {
    const seat = st.seats.findIndex((s) => s?.uid === me.id);
    if (seat < 0) return { error: "not_seated" };
    const cashouts = [];
    if (b.action === "leave") cashouts.push(leave(st, table, seat));
    else if (b.action === "back") { st.seats[seat].sitOut = false; st.seats[seat].timeouts = 0; }
    else if (b.action === "away") { st.seats[seat].sitOut = true; st.seats[seat].sitSince = t; }
    else if (b.action === "act") {
      const e = act(st, table, seat, String(b.move || ""), b.amount, t);
      if (e) return { error: e };
    } else return { error: "bad_action" };
    const a = advance(st, table, t);
    return { cashouts: [...cashouts, ...a.cashouts] };
  });
  if (r.error) return err(r.error === "not_seated" ? 409 : 400, r.error === "not_seated" ? "You're not at this table" : ERR[r.error] || r.error);
  return json(view(r.st, r.table, me.id));
}
