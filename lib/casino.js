// Casino helpers: fair roulette (no zero → every bet pays exactly its odds, with a daily win/loss cap so nobody
// drains or floods the economy) and IRL prize raffles (coin tickets, capped per person, drawn at a set time).
import { now } from "./util.js";
import { award, laDay } from "./coins.js";
import { notify } from "./notify.js";
import { discord } from "./lfg.js";

export const RL_MAX_BET = 100, RL_CAP = 500; // per spin · max net win or loss per day (Los Angeles day)
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
// kind → [does number n win for this value?, multiplier incl. stake]. 36 numbers, so these are exactly fair.
export const RL_BETS = {
  red: [(n) => RED.has(n), 2], black: [(n) => !RED.has(n), 2],
  odd: [(n) => n % 2 === 1, 2], even: [(n) => n % 2 === 0, 2],
  low: [(n) => n <= 18, 2], high: [(n) => n >= 19, 2],
  dozen: [(n, v) => Math.ceil(n / 12) === v, 3], column: [(n, v) => ((n - 1) % 3) + 1 === v, 3],
  number: [(n, v) => n === v, 36],
};
export function validBets(list) {
  if (!Array.isArray(list) || !list.length || list.length > 12) return null;
  const out = [];
  for (const b of list) {
    const kind = String(b?.kind || ""), coins = Math.floor(Number(b?.coins)), value = b?.value == null ? null : Math.floor(Number(b.value));
    if (!RL_BETS[kind] || !Number.isFinite(coins) || coins < 1) return null;
    if (kind === "number" && !(value >= 1 && value <= 36)) return null;
    if ((kind === "dozen" || kind === "column") && !(value >= 1 && value <= 3)) return null;
    out.push({ kind, value: ["number", "dozen", "column"].includes(kind) ? value : null, coins });
  }
  return out;
}
export const spinNumber = () => { const a = new Uint32Array(1); do crypto.getRandomValues(a); while (a[0] >= 4294967292); return (a[0] % 36) + 1; }; // unbiased 1–36
export const payoutFor = (bets, n) => bets.reduce((sum, b) => sum + (RL_BETS[b.kind][0](n, b.value) ? b.coins * RL_BETS[b.kind][1] : 0), 0);
export async function rouletteToday(env, uid) {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(payout - bet), 0) AS net, COUNT(*) AS spins FROM roulette_spins WHERE user_id = ? AND day = ?").bind(uid, laDay()).first();
  return { net: r?.net || 0, spins: r?.spins || 0 };
}

// ---------- raffles ----------
export async function drawRaffle(env, r) {
  const claim = await env.DB.prepare("UPDATE raffles SET status = 'drawing' WHERE id = ? AND status = 'open'").bind(r.id).run();
  if (!claim.meta.changes) return null;
  const { results } = await env.DB.prepare("SELECT t.user_id, t.n, u.username FROM raffle_tickets t JOIN users u ON u.id = t.user_id WHERE t.raffle_id = ?").bind(r.id).all();
  const total = results.reduce((n, x) => n + x.n, 0);
  let winner = null;
  if (total) {
    const a = new Uint32Array(1); crypto.getRandomValues(a);
    let pick = a[0] % total;
    for (const x of results) { if (pick < x.n) { winner = x; break; } pick -= x.n; }
  }
  await env.DB.prepare("UPDATE raffles SET status = 'drawn', winner_id = ? WHERE id = ?").bind(winner?.user_id || null, r.id).run();
  if (winner) {
    await notify(env, [winner.user_id], "fun", { title: `🎉 ¡Ganaste la rifa: ${r.prize}!`, body: "Un admin te contactará para entregarte el premio.", url: "/casino#rifas" });
    const losers = results.filter((x) => x.user_id !== winner.user_id).map((x) => x.user_id);
    if (losers.length) await notify(env, losers, "fun", { title: `🎟️ Rifa: ${r.title}`, body: `Ganó ${winner.username}. ¡Suerte para la próxima!`, url: "/casino#rifas" });
    const staff = (await env.DB.prepare("SELECT id FROM users WHERE role IN ('staff','subadmin','admin')").all()).results.map((x) => x.id);
    if (staff.length) await notify(env, staff, "status", { title: `🎟️ Entregar premio: ${r.prize}`, body: `Ganó ${winner.username}`, url: "/casino#rifas" });
    if (env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL) await discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, {
      content: `🎟️ **Rifa: ${r.title}** — ¡ganó **${winner.username}**! Premio: ${r.prize} (${total} boletos vendidos)`, allowed_mentions: { parse: [] } }).catch(() => {});
  }
  return winner;
}
export async function refundRaffle(env, id) {
  const { results } = await env.DB.prepare("SELECT user_id, coins FROM raffle_tickets WHERE raffle_id = ?").bind(id).all();
  for (const x of results) await award(env, x.user_id, "raffle_refund", `r${id}`, x.coins);
  return results.length;
}
export async function drawDueRaffles(env) {
  const { results } = await env.DB.prepare("SELECT * FROM raffles WHERE status = 'open' AND draws_at <= ?").bind(now()).all();
  for (const r of results) await drawRaffle(env, r);
  return results.length;
}
