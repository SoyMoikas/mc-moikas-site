import { getUser } from "../../lib/auth.js";
import { json, now } from "../../lib/util.js";
import { mergeServer, SERVER_SELECT, splitRow } from "../../lib/servers.js";

// GET /api/presence → friends playing right now (from Discord) + how many are on each game server.
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ playing: [], servers: [], listening: [] });
  const fresh = now() - 5 * 60000; // the bot reports every ~30 s; older rows mean it stopped
  const [pl, sv] = await Promise.all([
    env.DB.prepare(`SELECT p.game, p.kind, p.since, u.id, u.username, u.avatar FROM presence p JOIN users u ON u.id = p.user_id
                     WHERE p.updated_at > ? ORDER BY p.game, p.since`).bind(fresh).all(),
    env.DB.prepare(`${SERVER_SELECT} WHERE s.hidden = 0`).all(),
  ]);
  let listening = [];
  try { listening = (await env.DB.prepare(`SELECT l.kind, l.title, l.artist, u.id, u.username, u.avatar FROM listening l JOIN users u ON u.id = l.user_id WHERE l.updated_at > ?`).bind(fresh).all()).results; } catch { /* before migration 031 */ }
  const servers = sv.results.map((r) => mergeServer(...splitRow(r), env))
    .filter((s) => s.players_online > 0).map((s) => ({ id: s.id, name: s.name, players_online: s.players_online }));
  return json({ playing: pl.results, servers, listening });
}
