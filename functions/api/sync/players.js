import { json, err, now } from "../../../lib/util.js";
import { syncAuthorized } from "../../../lib/sync-auth.js";
import { evaluateAutoQuests, recomputeXP } from "../../../lib/xp.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[A-Za-z0-9_]{1,16}$/;

// Player names + per-server playtime/stats from the NAS script.
// Body: { players: [{uuid, name}], stats: [{uuid, ptero_uuid, play_minutes, stats: {key: n}, advancements: [id]}] }
export async function onRequestPost({ request, env }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  const text = await request.text();
  if (text.length > 2 * 1024 * 1024) return err(413, "Payload too large");
  let p;
  try { p = JSON.parse(text); } catch { return err(400, "Invalid JSON"); }

  const t = now();
  const stmts = [];
  for (const pl of (p.players || []).slice(0, 5000)) {
    if (!UUID.test(pl?.uuid) || !NAME.test(pl?.name)) continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO mc_players (uuid, name, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
    ).bind(pl.uuid.toLowerCase(), pl.name, t));
  }
  for (const s of (p.stats || []).slice(0, 10000)) {
    if (!UUID.test(s?.uuid) || typeof s.ptero_uuid !== "string" || s.ptero_uuid.length > 64) continue;
    const stats = {};
    if (s.stats && typeof s.stats === "object") {
      for (const [k, v] of Object.entries(s.stats).slice(0, 200)) {
        if (k.length <= 200 && Number.isFinite(Number(v))) stats[k] = Math.max(0, Math.floor(Number(v)));
      }
    }
    const adv = Array.isArray(s.advancements) ? s.advancements.filter((a) => typeof a === "string" && a.length <= 200).slice(0, 200) : [];
    stmts.push(env.DB.prepare(
      `INSERT INTO mc_stats (uuid, ptero_uuid, play_minutes, stats, advancements, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid, ptero_uuid) DO UPDATE SET play_minutes = excluded.play_minutes, stats = excluded.stats,
         advancements = excluded.advancements, updated_at = excluded.updated_at`
    ).bind(s.uuid.toLowerCase(), s.ptero_uuid, Math.max(0, Math.floor(Number(s.play_minutes) || 0)),
      JSON.stringify(stats), JSON.stringify(adv), t));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));

  const completed = await evaluateAutoQuests(env);
  await recomputeXP(env);
  return json({ ok: true, players: (p.players || []).length, stats: (p.stats || []).length, quests_completed: completed });
}
