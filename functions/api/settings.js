import { json, body, int } from "../../lib/util.js";
import { need } from "../../lib/auth.js";
import { getSettings } from "../../lib/catalog.js";
import { recomputeXP } from "../../lib/xp.js";

export async function onRequestGet({ request, env }) {
  const user = await need(env, request, "admin");
  if (user instanceof Response) return user;
  return json(await getSettings(env));
}

// Admin: { coins_base, coins_per_level } — coins for reaching level L = base + per_level × L.
export async function onRequestPatch({ request, env }) {
  const user = await need(env, request, "admin");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const base = int(b.coins_base, "coins_base", { min: 0, max: 100000 }) ?? 0;
  const per = int(b.coins_per_level, "coins_per_level", { min: 0, max: 100000 }) ?? 0;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('coins_base', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(base)),
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('coins_per_level', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(per)),
  ]);
  await recomputeXP(env); // everyone's earned coins change
  return json({ ok: true });
}
