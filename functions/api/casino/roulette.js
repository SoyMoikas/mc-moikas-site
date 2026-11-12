import { need } from "../../../lib/auth.js";
import { json, body, now, err } from "../../../lib/util.js";
import { spend, award, laDay } from "../../../lib/coins.js";
import { RL_MAX_BET, RL_CAP, validBets, spinNumber, payoutFor, rouletteToday } from "../../../lib/casino.js";

// GET → your day so far + the last spins at the table
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const recent = (await env.DB.prepare("SELECT s.result, s.bet, s.payout, s.created_at, u.username FROM roulette_spins s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 12").all()).results;
  return json({ today: await rouletteToday(env, me.id), max_bet: RL_MAX_BET, cap: RL_CAP, recent });
}

// POST {bets: [{kind, value?, coins}]} → spin
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const bets = validBets(b.bets);
  if (!bets) return err(400, "Place at least one chip");
  const total = bets.reduce((n, x) => n + x.coins, 0);
  if (total > RL_MAX_BET) return err(400, `Max ${RL_MAX_BET} coins per spin`);
  const today = await rouletteToday(env, me.id);
  if (today.net >= RL_CAP) return err(429, "You hit today's winning limit — come back tomorrow 🍀");
  if (-today.net + total > RL_CAP) return err(429, today.net <= -RL_CAP ? "You hit today's losing limit — come back tomorrow" : `You can only risk ${RL_CAP + today.net} more today`);
  if (!(await spend(env, me.id, total))) return err(402, "Not enough coins");
  const n = spinNumber();
  const payout = payoutFor(bets, n);
  const t = now();
  const r = await env.DB.prepare("INSERT INTO roulette_spins (user_id, day, bet, payout, result, bets, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(me.id, laDay(t), total, payout, n, JSON.stringify(bets), t).run();
  if (payout) await award(env, me.id, "roulette", r.meta.last_row_id, payout);
  return json({ result: n, payout, bet: total, today: { net: today.net + payout - total, spins: today.spins + 1 } });
}
