// Site activity XP: being active on the site counts, not just Minecraft playtime.
// Each kind gives `xp` per action, up to `cap` XP per day (UTC days). Values are editable in Admin → Site
// (settings keys act_<kind>_xp / act_<kind>_cap). Totals live in activity_xp and are added in recomputeXP.
import { recomputeXP } from "./xp.js";

export const ACTIVITY = {
  visit: { xp: 10, cap: 10 },   // once a day for visiting while logged in
  post: { xp: 5, cap: 20 },     // writing a feed post
  chat: { xp: 1, cap: 20 },     // chat messages
  like: { xp: 2, cap: 20 },     // a like received on your post (from someone else)
  comment: { xp: 2, cap: 10 },  // commenting on someone else's post
};

export async function getActivitySettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'act\\_%' ESCAPE '\\'").all().catch(() => ({ results: [] }));
  const s = Object.fromEntries(results.map((r) => [r.key, Number(r.value)]));
  return Object.fromEntries(Object.entries(ACTIVITY).map(([k, d]) => [k, {
    xp: Number.isFinite(s[`act_${k}_xp`]) ? s[`act_${k}_xp`] : d.xp,
    cap: Number.isFinite(s[`act_${k}_cap`]) ? s[`act_${k}_cap`] : d.cap,
  }]));
}

// Give `user` activity XP of `kind` (respecting today's cap). Never throws: a hiccup here must not break posting.
// Pending (unapproved) users don't earn.
export async function awardActivity(env, user, kind) {
  try {
    if (!user || user.role === "pending") return;
    const a = (await getActivitySettings(env))[kind];
    if (!a || a.xp <= 0 || a.cap <= 0) return;
    const day = new Date().toISOString().slice(0, 10);
    const r = await env.DB.prepare(
      `INSERT INTO activity_xp (user_id, day, kind, amount) VALUES (?1, ?2, ?3, MIN(?4, ?5))
       ON CONFLICT(user_id, day, kind) DO UPDATE SET amount = MIN(amount + ?4, ?5) WHERE amount < ?5`
    ).bind(user.id, day, kind, a.xp, a.cap).run();
    if (r.meta.changes) await recomputeXP(env, user.id); // XP (and maybe a level-up's coins) changed
  } catch (e) { console.log("activity xp:", e?.message); }
}
