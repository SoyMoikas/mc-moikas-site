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
  return json({
    like_emoji: await likeEmoji(env),
    games: games.map((g) => ({ id: g.id, name: g.name, name_es: g.name_es, icon: g.icon, color: g.color })),
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
