import { getUser } from "../../../lib/auth.js";
import { now } from "../../../lib/util.js";
import { verifySteamLogin, refreshSteam } from "../../../lib/steam.js";

// Steam sends the person back here after they log in on steamcommunity.com.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const back = (q) => new Response(null, { status: 302, headers: { location: `/play?${q}#cuentas` } });
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return back("steam=login");
  const steamId = await verifySteamLogin(url);
  if (!steamId) return back("steam=failed");
  const taken = await env.DB.prepare("SELECT user_id FROM steam_links WHERE steam_id = ?").bind(steamId).first();
  if (taken && taken.user_id !== me.id) return back("steam=taken");
  await env.DB.prepare(
    `INSERT INTO steam_links (user_id, steam_id, linked_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET steam_id = excluded.steam_id, updated_at = 0`
  ).bind(me.id, steamId, now()).run();
  try { await refreshSteam(env, me.id); } catch (e) { console.error("steam refresh", e.message); }
  return back("steam=ok");
}
