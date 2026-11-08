import { json, err, body, str } from "../../lib/util.js";
import { getUser } from "../../lib/auth.js";
import { listGames } from "../../lib/games.js";

async function likeEmoji(env) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'like_emoji'").first().catch(() => null);
  return r?.value || "❤️";
}

// Public site info used by every page: games for the nav menu, the like emoji.
export async function onRequestGet({ env }) {
  const games = await listGames(env).catch(() => []);
  const servers = (await env.DB.prepare(
    `SELECT s.id, s.game_id, s.map_url, COALESCE(s.name, json_extract(p.data, '$.name'), s.id) AS name
       FROM servers s LEFT JOIN ptero_servers p ON p.uuid = s.ptero_uuid
      WHERE s.hidden = 0 ORDER BY s.sort_order, name`
  ).all().catch(() => ({ results: [] }))).results;
  return json({
    like_emoji: await likeEmoji(env),
    games: games.map((g) => ({ id: g.id, name: g.name, name_es: g.name_es, icon: g.icon, color: g.color,
      servers: servers.filter((s) => s.game_id === g.id).map((s) => ({ id: s.id, name: s.name, map_url: s.map_url || null })) })),
    // servers with a live web map (Map page + sidebar link)
    maps: servers.filter((s) => s.map_url).map((s) => ({ id: s.id, name: s.name, url: s.map_url })),
  }, 200, { "cache-control": "public, max-age=30" });
}

// Admin only: { like_emoji }
export async function onRequestPatch({ request, env }) {
  const user = await getUser(env, request);
  if (!user) return err(401, "Log in first");
  if (user.role !== "admin") return err(403, "Not allowed");
  const b = await body(request);
  if (b instanceof Response) return b;
  const emoji = str(b.like_emoji, 16, "like_emoji");
  if (!emoji) return err(400, "Pick an emoji");
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('like_emoji', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(emoji).run();
  return json({ ok: true });
}
