import { need } from "../../lib/auth.js";
import { json, now, err } from "../../lib/util.js";
import { dailyState, rewardFor } from "../../lib/daily.js";
import { recomputeXP } from "../../lib/xp.js";

// GET  /api/daily → today's state (streak, whether it's claimed, the reward)
// POST /api/daily → claim today's coins
export async function onRequestGet({ env, request }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  return json(await dailyState(env, user.id));
}

export async function onRequestPost({ env, request }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  const st = await dailyState(env, user.id);
  if (st.claimed) return err(409, "Already claimed today");
  const streak = st.streak + 1;
  const coins = rewardFor(streak);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO daily_claims (user_id, day, streak, coins, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(user.id, st.today, streak, coins, now()).run();
  if (!r.meta.changes) return err(409, "Already claimed today");
  await recomputeXP(env, user.id);
  return json({ ...(await dailyState(env, user.id)), gained: coins });
}
