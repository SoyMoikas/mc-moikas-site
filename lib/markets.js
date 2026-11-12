// Coin predictions ("Apuestas"): parimutuel pools. Everyone's stake goes in one pot; the people who picked the
// winner split it in proportion to what they put in. No winner bets → everyone gets their coins back.
import { now } from "./util.js";
import { spend, award } from "./coins.js";
import { notify } from "./notify.js";

export const MIN_BET = 5, MAX_BET = 500;

export async function loadMarket(env, id, me) {
  const m = await env.DB.prepare("SELECT * FROM markets WHERE id = ?").bind(id).first();
  if (!m) return null;
  const [opts, bets] = await Promise.all([
    env.DB.prepare("SELECT * FROM market_options WHERE market_id = ? ORDER BY id").bind(id).all(),
    env.DB.prepare(`SELECT b.option_id, b.coins, b.user_id, u.username, u.avatar FROM market_bets b JOIN users u ON u.id = b.user_id WHERE b.market_id = ?`).bind(id).all(),
  ]);
  const pot = bets.results.reduce((n, b) => n + b.coins, 0);
  m.pot = pot;
  m.options = opts.results.map((o) => {
    const bs = bets.results.filter((b) => b.option_id === o.id);
    const stake = bs.reduce((n, b) => n + b.coins, 0);
    return { ...o, stake, bettors: bs.map(({ user_id, username, avatar, coins }) => ({ id: user_id, username, avatar, coins })),
      payout: stake ? Math.round((pot / stake) * 100) / 100 : null };
  });
  m.my_bet = me ? bets.results.find((b) => b.user_id === me.id) || null : null;
  if (m.my_bet) m.my_bet = { option_id: m.my_bet.option_id, coins: m.my_bet.coins };
  m.open = m.status === "open" && (!m.closes_at || m.closes_at > now());
  return m;
}

export async function ensureMarket(env, { kind, ref, title, options, closes_at = null, created_by = null }) {
  const ex = await env.DB.prepare("SELECT id FROM markets WHERE kind = ? AND ref = ?").bind(kind, String(ref)).first();
  if (ex) return ex.id;
  const r = await env.DB.prepare("INSERT OR IGNORE INTO markets (kind, ref, title, closes_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(kind, String(ref), title.slice(0, 120), closes_at, created_by, now()).run();
  const id = r.meta.last_row_id || (await env.DB.prepare("SELECT id FROM markets WHERE kind = ? AND ref = ?").bind(kind, String(ref)).first()).id;
  if (r.meta.changes) {
    await env.DB.batch(options.slice(0, 12).map((o) => env.DB.prepare("INSERT INTO market_options (market_id, label, ref) VALUES (?, ?, ?)")
      .bind(id, String(o.label).slice(0, 60), o.ref != null ? String(o.ref) : null)));
  }
  return id;
}

export async function placeBet(env, m, userId, optionId, coins) {
  if (!m.open) return "closed";
  if (m.my_bet) return "already";
  if (!m.options.some((o) => o.id === optionId)) return "bad_option";
  if (!Number.isInteger(coins) || coins < MIN_BET || coins > MAX_BET) return "bad_amount";
  if (!(await spend(env, userId, coins))) return "no_coins";
  const r = await env.DB.prepare("INSERT OR IGNORE INTO market_bets (market_id, user_id, option_id, coins, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(m.id, userId, optionId, coins, now()).run();
  if (!r.meta.changes) { await env.DB.prepare("UPDATE users SET coins_spent = coins_spent - ? WHERE id = ?").bind(coins, userId).run(); return "already"; }
  return "ok";
}

/** Settle by the winning option's ref (e.g. the winning team id or game name). */
export async function settleByRef(env, kind, ref, winnerRef) {
  const row = await env.DB.prepare("SELECT id FROM markets WHERE kind = ? AND ref = ? AND status IN ('open','closed')").bind(kind, String(ref)).first();
  if (!row) return;
  const m = await loadMarket(env, row.id);
  const win = m.options.find((o) => o.ref === String(winnerRef) || o.label === String(winnerRef));
  await settle(env, m, win ? win.id : null);
}

export async function settle(env, m, winnerId) {
  const claimed = await env.DB.prepare("UPDATE markets SET status = ?, winner_option = ? WHERE id = ? AND status IN ('open','closed')")
    .bind(winnerId ? "settled" : "void", winnerId, m.id).run();
  if (!claimed.meta.changes) return;
  const all = m.options.flatMap((o) => o.bettors.map((b) => ({ ...b, option_id: o.id })));
  const winners = all.filter((b) => b.option_id === winnerId);
  const winStake = winners.reduce((n, b) => n + b.coins, 0);
  const label = m.options.find((o) => o.id === winnerId)?.label;
  if (!winnerId || !winStake) { // nobody picked it (or cancelled): refunds
    for (const b of all) await award(env, b.id, "bet_refund", m.id, b.coins);
    if (all.length) await notify(env, all.map((b) => b.id), "fun", { title: `🪙 Apuesta devuelta: ${m.title}`, body: "Nadie le atinó, te regresamos tus monedas.", url: "/casino#apuestas" });
    return;
  }
  for (const b of winners) {
    const pay = Math.floor((m.pot * b.coins) / winStake);
    await award(env, b.id, "bet_win", m.id, pay);
    await notify(env, [b.id], "fun", { title: `🤑 ¡Ganaste ${pay} monedas!`, body: `${m.title}: ${label}`, url: "/casino#apuestas" });
  }
  const losers = all.filter((b) => b.option_id !== winnerId).map((b) => b.id);
  if (losers.length) await notify(env, losers, "fun", { title: `💸 Perdiste la apuesta: ${m.title}`, body: `Ganó ${label}.`, url: "/casino#apuestas" });
}

export async function closeDue(env) {
  await env.DB.prepare("UPDATE markets SET status = 'closed' WHERE status = 'open' AND closes_at IS NOT NULL AND closes_at <= ?").bind(now()).run();
}

/** Bets whose tournament / match / game night was deleted: void them and refund everyone. */
export async function voidOrphans(env) {
  const { results } = await env.DB.prepare(
    `SELECT m.id FROM markets m WHERE m.status IN ('open','closed') AND (
       (m.kind = 'match' AND NOT EXISTS (SELECT 1 FROM tournament_matches x JOIN tournaments tt ON tt.id = x.tournament_id WHERE x.id = CAST(m.ref AS INTEGER)))
    OR (m.kind = 'tourney' AND NOT EXISTS (SELECT 1 FROM tournaments x WHERE x.id = CAST(m.ref AS INTEGER)))
    OR (m.kind = 'night' AND NOT EXISTS (SELECT 1 FROM game_nights x WHERE x.id = CAST(m.ref AS INTEGER))))`).all();
  for (const { id } of results) { const m = await loadMarket(env, id); if (m) await settle(env, m, null); }
  return results.length;
}
