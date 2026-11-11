import { json, err, now } from "../../../lib/util.js";
import { syncAuthorized } from "../../../lib/sync-auth.js";
import { tickNights } from "../../../lib/nights.js";
import { announceFreeGames } from "../../../lib/freegames.js";
import { refreshSteam } from "../../../lib/steam.js";
import { refreshApex } from "../../../lib/apex.js";
import { recomputeXP } from "../../../lib/xp.js";
import { closeDue } from "../../../lib/markets.js";
import { checkAchievements } from "../../../lib/achievements.js";
import { expireBounties } from "../../../lib/bounties.js";
import { weeklyRecap, snapshotWeek, birthdays, steamSales, quoteOfMonth } from "../../../lib/recap.js";

// POST /api/sync/tick — the NAS bot calls this every ~30 s. Does the site's background chores:
// game-night locking/reminders/attendance coins, free-game announcements, and slowly refreshing Steam + Apex.
export async function onRequestPost({ request, env }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  const t = now();
  const done = {};
  const step = async (name, fn) => { try { done[name] = await fn(); } catch (e) { done[name] = `error: ${e.message}`; } };

  await step("nights", async () => {
    const paid = await tickNights(env);
    for (const uid of new Set(paid)) await recomputeXP(env, uid);
    return paid.length;
  });
  await step("free", () => announceFreeGames(env).then(() => "ok"));
  await step("recap", () => weeklyRecap(env));        // must run before the Steam/Apex refresh below
  await step("week", () => snapshotWeek(env));
  await step("bets", () => closeDue(env).then(() => "ok"));
  await step("bounties", () => expireBounties(env).then(() => "ok"));
  await step("birthdays", () => birthdays(env));
  await step("quote", () => quoteOfMonth(env));
  if (env.STEAM_API_KEY) await step("sales", () => steamSales(env));
  // achievements every ~10 min (ticks are ~30 s apart)
  if (Math.floor(t / 60000) % 10 === 0) await step("achievements", () => checkAchievements(env));
  if (env.STEAM_API_KEY) await step("steam", async () => {
    const s = await env.DB.prepare("SELECT user_id FROM steam_links WHERE updated_at < ? ORDER BY updated_at LIMIT 1").bind(t - 6 * 3600000).first();
    if (s) await refreshSteam(env, s.user_id);
    return s?.user_id ?? null;
  });
  if (env.APEX_API_KEY) await step("apex", async () => {
    const a = await env.DB.prepare("SELECT user_id FROM apex_links WHERE updated_at < ? ORDER BY updated_at LIMIT 1").bind(t - 15 * 60000).first();
    if (a) await refreshApex(env, a.user_id);
    return a?.user_id ?? null;
  });
  return json({ ok: true, ...done });
}
