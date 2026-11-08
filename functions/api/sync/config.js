import { json, err, now } from "../../../lib/util.js";
import { syncAuthorized } from "../../../lib/sync-auth.js";
import { loadAutoQuests } from "../../../lib/xp.js";

export const CODE_TTL_MS = 15 * 60 * 1000;

// Tells the NAS script which stats/advancements to collect and which link codes to send in-game.
export async function onRequestGet({ request, env }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  const quests = await loadAutoQuests(env);
  const stats = [...new Set(quests.filter((q) => q.criteria_type === "stat").map((q) => q.criteria_key))];
  const advancements = [...new Set(quests.filter((q) => q.criteria_type === "advancement").map((q) => q.criteria_key))];
  const { results: verify } = await env.DB.prepare(
    "SELECT mc_name AS name, code FROM mc_links WHERE created_at > ?"
  ).bind(now() - CODE_TTL_MS).all();
  return json({ stats, advancements, verify });
}
