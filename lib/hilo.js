// "Mayor o menor": is the next game higher or lower than this one?
//   mode "grupo": hours your group has played it on Steam
//   mode "steam": how many people are playing it on Steam right now (live)
import { now } from "./util.js";
import { POOL } from "./guess.js";

export const DAILY_COIN_CAP = 60; // coins you can earn per day here (1 per correct answer)
const header = (appid) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;

async function groupItems(env) {
  return (await env.DB.prepare(
    `SELECT g.appid, a.name, SUM(g.playtime) AS minutes, COUNT(*) AS owners FROM steam_games g JOIN steam_apps a ON a.appid = g.appid
      WHERE a.name IS NOT NULL AND a.name != '' GROUP BY g.appid HAVING minutes >= 60 ORDER BY minutes DESC LIMIT 300`).all()).results
    .filter((r) => !/soundtrack|dedicated server|sdk|test server|benchmark/i.test(r.name))
    .map((r) => ({ key: String(r.appid), name: r.name, img: header(r.appid), value: r.minutes, owners: r.owners }));
}

async function livePlayers(env, appid) {
  const k = `players:${appid}`;
  const c = await env.DB.prepare("SELECT value, updated_at FROM kv_cache WHERE key = ?").bind(k).first();
  if (c && c.updated_at > now() - 15 * 60000) return JSON.parse(c.value);
  let n = null;
  try {
    const r = await fetch(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`);
    n = (await r.json())?.response?.player_count ?? null;
  } catch {}
  if (n == null && c) return JSON.parse(c.value);
  await env.DB.prepare("INSERT OR REPLACE INTO kv_cache (key, value, updated_at) VALUES (?, ?, ?)").bind(k, JSON.stringify(n), now()).run();
  return n;
}

export async function items(env, mode) {
  if (mode === "grupo") return groupItems(env);
  return POOL.map(([appid, name]) => ({ key: String(appid), name, img: header(appid) }));
}

export async function valueOf(env, mode, item) {
  if (mode === "grupo") return item.value;
  return livePlayers(env, item.key);
}

// pick something not seen yet in this run (and with a different value, so there's a right answer)
export async function pickNext(env, mode, list, seen, notValue) {
  const pool = list.filter((i) => !seen.includes(i.key));
  for (let tries = 0; tries < 8 && pool.length; tries++) {
    const i = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const v = await valueOf(env, mode, i);
    if (v != null && v !== notValue) return { ...i, value: v };
  }
  return null;
}

export const fmtValue = (mode, v) => mode === "grupo"
  ? `${Math.round(v / 60).toLocaleString("es-MX")} h`
  : `${Number(v).toLocaleString("es-MX")} jugando`;
