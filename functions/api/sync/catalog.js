import { json, err, body, now } from "../../../lib/util.js";
import { syncAuthorized } from "../../../lib/sync-auth.js";

// From the NAS script (every 6 h or `--scan`): every stat/advancement players have per server, so the quest
// editor can suggest goals that are really trackable for that modpack.
// { servers: { <ptero_uuid>: { players, stats: { "minecraft:mined/minecraft:stone": [players, max] }, advancements: { id: players } } } }
export async function onRequestPost({ request, env }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  const b = await body(request, 4 * 1024 * 1024);
  if (b instanceof Response) return b;
  const t = now();
  let total = 0;
  for (const [pu, c] of Object.entries(b.servers || {})) {
    if (!/^[\w-]{4,64}$/.test(pu) || !c || typeof c !== "object") continue;
    const rows = [["players", "_", Number(c.players) || 0, 0]];
    for (const [k, v] of Object.entries(c.stats || {}).slice(0, 3000))
      if (Array.isArray(v) && k.length <= 200) rows.push(["stat", k, Number(v[0]) || 0, Number(v[1]) || 0]);
    for (const [k, n] of Object.entries(c.advancements || {}).slice(0, 2000))
      if (k.length <= 200) rows.push(["adv", k, Number(n) || 0, 0]);
    const stmts = [env.DB.prepare("DELETE FROM mc_catalog WHERE ptero_uuid = ?").bind(pu)];
    for (const [kind, key, players, max] of rows)
      stmts.push(env.DB.prepare("INSERT INTO mc_catalog (ptero_uuid, kind, key, players, max_value, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(pu, kind, key, players, max, t));
    for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
    total += rows.length - 1;
  }
  return json({ ok: true, rows: total });
}
