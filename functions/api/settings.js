import { json, body, int } from "../../lib/util.js";
import { needPerm } from "../../lib/auth.js";
import { getSettings } from "../../lib/catalog.js";
import { recomputeXP } from "../../lib/xp.js";
import { ACTIVITY, getActivitySettings } from "../../lib/activity.js";

export async function onRequestGet({ request, env }) {
  const user = await needPerm(env, request, "store");
  if (user instanceof Response) return user;
  return json({ ...(await getSettings(env)), activity: await getActivitySettings(env) });
}

// Admin: { coins_base, coins_per_level } — coins for reaching level L = base + per_level × L.
export async function onRequestPatch({ request, env }) {
  const user = await needPerm(env, request, "store");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  // { activity: { post: { xp, cap }, … } } → activity XP rules only (past XP stays as earned)
  if (b.activity) {
    const stmts = [];
    for (const k of Object.keys(ACTIVITY)) {
      const a = b.activity[k];
      if (!a) continue;
      for (const f of ["xp", "cap"]) {
        const v = int(a[f], `${k} ${f}`, { min: 0, max: 10000 }) ?? 0;
        stmts.push(env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(`act_${k}_${f}`, String(v)));
      }
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, activity: await getActivitySettings(env) });
  }
  const base = int(b.coins_base, "coins_base", { min: 0, max: 100000 }) ?? 0;
  const per = int(b.coins_per_level, "coins_per_level", { min: 0, max: 100000 }) ?? 0;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('coins_base', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(base)),
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('coins_per_level', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(per)),
  ]);
  await recomputeXP(env); // everyone's earned coins change
  return json({ ok: true });
}
