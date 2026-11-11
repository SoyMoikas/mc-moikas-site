// Daily login bonus. Days follow Los Angeles time so the reset is at local midnight.
export const TZ = "America/Los_Angeles";
export const dayOf = (ms = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
export const prevDay = (day) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

// Coins for the Nth day in a row: 10, 15, 20, 25, 30, 35, then 75 on day 7, and the cycle repeats.
export function rewardFor(streak) {
  const d = ((streak - 1) % 7) + 1;
  return d === 7 ? 75 : 5 + d * 5;
}

export async function dailyState(env, userId) {
  const today = dayOf();
  const last = await env.DB.prepare("SELECT day, streak FROM daily_claims WHERE user_id = ? ORDER BY day DESC LIMIT 1").bind(userId).first();
  const claimed = last?.day === today;
  const alive = last && (last.day === today || last.day === prevDay(today));
  const streak = alive ? last.streak : 0;
  // reward = what the next claim pays (today's if unclaimed, tomorrow's if already claimed)
  return { today, claimed, streak, reward: rewardFor(streak + 1), week: Array.from({ length: 7 }, (_, i) => rewardFor(i + 1)) };
}
