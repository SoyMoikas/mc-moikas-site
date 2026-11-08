import { json } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";

// Staff: trackable stats/advancements per server (from the NAS scan) for the quest editor's picker and ideas.
export async function onRequestGet({ request, env }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const { results } = await env.DB.prepare(
    `SELECT s.id AS server_id, c.kind, c.key, c.players, c.max_value, c.updated_at
       FROM mc_catalog c JOIN servers s ON s.ptero_uuid = c.ptero_uuid ORDER BY c.players DESC`
  ).all().catch(() => ({ results: [] }));
  const servers = {};
  for (const r of results) {
    const s = (servers[r.server_id] ||= { players: 0, updated_at: r.updated_at, stats: [], advancements: [] });
    if (r.kind === "players") s.players = r.players;
    else if (r.kind === "stat") s.stats.push([r.key, r.players, r.max_value]);
    else s.advancements.push([r.key, r.players]);
  }
  return json({ servers });
}
