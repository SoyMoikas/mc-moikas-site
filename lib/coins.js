// Coins that come and go outside the level system.
//   spend(): takes coins now (only if the balance covers it) — stored in users.coins_spent.
//   award(): gives coins once per (source, ref, user) — stored in coin_awards, added into coins_earned by recomputeXP.
import { now } from "./util.js";
import { recomputeXP } from "./xp.js";

export async function spend(env, userId, coins) {
  const r = await env.DB.prepare(
    "UPDATE users SET coins_spent = coins_spent + ?1 WHERE id = ?2 AND coins_earned - coins_spent >= ?1"
  ).bind(coins, userId).run();
  return r.meta.changes > 0;
}

/** Returns true if this award is new. */
export async function award(env, userId, source, ref, coins, { recompute = true } = {}) {
  if (!userId || !coins) return false;
  const r = await env.DB.prepare("INSERT OR IGNORE INTO coin_awards (user_id, source, ref, coins, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, source, String(ref), Math.round(coins), now()).run();
  if (r.meta.changes && recompute) await recomputeXP(env, userId);
  return r.meta.changes > 0;
}

// Los Angeles calendar helpers (resets at local midnight).
export const laDay = (ms = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
export const laHour = (ms = Date.now()) => +new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(new Date(ms));
export const laWeekday = (ms = Date.now()) => ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(new Date(ms))];
// Monday 00:00 LA of the week containing ms (approximate within an hour around DST changes, fine for weekly stats)
export function laWeekStart(ms = Date.now()) {
  const day = laDay(ms);
  const back = (laWeekday(ms) + 6) % 7;
  const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - back);
  const offH = laHour(Date.parse(d.toISOString().slice(0, 10) + "T12:00:00Z")) - 12; // LA offset from UTC that day (-8 or -7)
  return Date.parse(d.toISOString().slice(0, 10) + "T00:00:00Z") - offH * 3600000;
}

// Per-person time zone (falls back to Los Angeles). Bad zone names fall back too.
export const DEFAULT_TZ = "America/Los_Angeles";
export const validTz = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return !!tz; } catch { return false; } };
export const zoneOf = (u) => (u && validTz(u.tz) ? u.tz : DEFAULT_TZ);
export const dayIn = (tz, ms = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
export const hourIn = (tz, ms = Date.now()) => +new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(ms));
