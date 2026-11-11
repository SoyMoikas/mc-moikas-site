// Steam: link accounts with Steam's own login (OpenID), read owned games with the Web API.
import { now } from "./util.js";

const OPENID = "https://steamcommunity.com/openid/login";
const API = "https://api.steampowered.com";

export function steamLoginUrl(origin) {
  const p = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": `${origin}/api/steam/callback`,
    "openid.realm": origin,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${OPENID}?${p}`;
}

// Ask Steam to confirm the login really came from it. Returns the SteamID64 or null.
export async function verifySteamLogin(url) {
  const q = url.searchParams;
  if (q.get("openid.mode") !== "id_res") return null;
  if (!(q.get("openid.return_to") || "").startsWith(`${url.origin}/api/steam/callback`)) return null;
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(q.get("openid.claimed_id") || "");
  if (!m) return null;
  const body = new URLSearchParams();
  for (const [k, v] of q) if (k.startsWith("openid.")) body.set(k, v);
  body.set("openid.mode", "check_authentication");
  const r = await fetch(OPENID, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
  const text = await r.text();
  return /is_valid\s*:\s*true/.test(text) ? m[1] : null;
}

async function api(env, path, params) {
  if (!env.STEAM_API_KEY) throw new Error("STEAM_API_KEY is not set");
  const r = await fetch(`${API}${path}?${new URLSearchParams({ key: env.STEAM_API_KEY, ...params })}`);
  if (!r.ok) throw new Error(`Steam ${r.status}`);
  return r.json();
}

// Refresh one linked person's profile + game list.
export async function refreshSteam(env, userId) {
  const link = await env.DB.prepare("SELECT steam_id FROM steam_links WHERE user_id = ?").bind(userId).first();
  if (!link) return;
  const t = now();
  const sum = (await api(env, "/ISteamUser/GetPlayerSummaries/v2/", { steamids: link.steam_id })).response?.players?.[0];
  const owned = (await api(env, "/IPlayerService/GetOwnedGames/v1/", {
    steamid: link.steam_id, include_appinfo: "1", include_played_free_games: "1",
  })).response || {};
  const games = owned.games || [];
  const isPublic = sum?.communityvisibilitystate === 3 && games.length > 0;
  const stmts = [env.DB.prepare(
    "UPDATE steam_links SET persona = ?, avatar = ?, public = ?, game_count = ?, updated_at = ? WHERE user_id = ?"
  ).bind(sum?.personaname || null, sum?.avatarfull || null, isPublic ? 1 : 0, games.length, t, userId)];
  if (isPublic) {
    stmts.push(env.DB.prepare("DELETE FROM steam_games WHERE user_id = ?").bind(userId));
    for (const g of games.slice(0, 3000)) {
      stmts.push(env.DB.prepare("INSERT INTO steam_games (user_id, appid, playtime, playtime_2w) VALUES (?, ?, ?, ?)")
        .bind(userId, g.appid, g.playtime_forever || 0, g.playtime_2weeks || 0));
      stmts.push(env.DB.prepare(
        "INSERT INTO steam_apps (appid, name) VALUES (?, ?) ON CONFLICT(appid) DO UPDATE SET name = COALESCE(steam_apps.name, excluded.name)"
      ).bind(g.appid, String(g.name || "").slice(0, 120)));
    }
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
}

// Is this game multiplayer? Asks the Steam store once per game and remembers it.
export async function fillMultiplayer(env, appids, max = 12) {
  if (!appids.length) return;
  const unknown = (await env.DB.prepare(
    `SELECT appid FROM steam_apps WHERE appid IN (${appids.map(() => "?").join(",")}) AND multiplayer IS NULL AND fetched_at < ? LIMIT ?`
  ).bind(...appids, now() - 86400000, max).all()).results.map((r) => r.appid);
  await Promise.all(unknown.map(async (appid) => {
    let mp = null;
    try {
      const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=categories`);
      const d = (await r.json())?.[appid];
      if (d?.success) {
        const cats = (d.data?.categories || []).map((c) => c.id);
        mp = [1, 9, 27, 36, 37, 38, 39, 47, 48, 49].some((c) => cats.includes(c)) ? 1 : 0; // multi-player, co-op, PvP…
      }
    } catch {}
    await env.DB.prepare("UPDATE steam_apps SET multiplayer = ?, fetched_at = ? WHERE appid = ?").bind(mp, now(), appid).run();
  }));
}

export const steamHeader = (appid) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;
