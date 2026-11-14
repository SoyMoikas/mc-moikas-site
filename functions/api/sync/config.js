import { json, err, now } from "../../../lib/util.js";
import { syncAuthorized } from "../../../lib/sync-auth.js";
import { loadAutoQuests } from "../../../lib/xp.js";

export const CODE_TTL_MS = 15 * 60 * 1000;

// Tells the NAS script which stats/advancements to collect, which link codes to send in-game,
// which whitelist/ban actions staff queued on the site, and which stopped servers members asked to start.
export async function onRequestGet({ request, env }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  const quests = await loadAutoQuests(env);
  const stats = [...new Set(quests.filter((q) => q.criteria_type === "stat").map((q) => q.criteria_key))];
  const advancements = [...new Set(quests.filter((q) => q.criteria_type === "advancement").map((q) => q.criteria_key))];
  const { results: verify } = await env.DB.prepare(
    "SELECT mc_name AS name, code FROM mc_links WHERE created_at > ?"
  ).bind(now() - CODE_TTL_MS).all();
  const { results: moderation } = await env.DB.prepare(
    "SELECT id, ptero_uuid, action, name, edition, reason FROM mc_moderation WHERE done_at IS NULL ORDER BY id LIMIT 50"
  ).all();
  // start requests from the last 10 minutes; older ones are dropped rather than started late
  // (if the table isn't there yet because the migration hasn't been run, the rest of the sync must still work)
  let starts = [];
  try {
    starts = (await env.DB.prepare(
      "SELECT id, ptero_uuid FROM server_starts WHERE done_at IS NULL AND created_at > ? ORDER BY id LIMIT 20"
    ).bind(now() - 10 * 60 * 1000).all()).results;
  } catch { /* migration 046 not run yet */ }
  return json({ stats, advancements, verify, moderation, starts });
}
