import { notify, allMembers } from "../../../lib/notify.js";
import { getUser, need } from "../../../lib/auth.js";
import { json, body, str, int, now, err } from "../../../lib/util.js";
import { loadPost, publicPost, syncDiscord, OPEN_HOURS } from "../../../lib/lfg.js";

// GET /api/lfg → open posts (newest start first) + games people often pick
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  const ids = (await env.DB.prepare(
    "SELECT id FROM lfg_posts WHERE closed_at IS NULL AND starts_at > ? ORDER BY starts_at LIMIT 20"
  ).bind(now() - OPEN_HOURS * 3600000).all()).results;
  const posts = [];
  for (const { id } of ids) posts.push(publicPost(await loadPost(env, id), me));
  const recent = (await env.DB.prepare(
    "SELECT game, COUNT(*) AS n FROM lfg_posts WHERE created_at > ? GROUP BY game ORDER BY n DESC LIMIT 8"
  ).bind(now() - 60 * 86400000).all()).results.map((r) => r.game);
  return json({ posts, recent_games: recent, discord: !!(env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL) });
}

// POST /api/lfg {game, note, starts_at (ms, or null = now), slots}
export async function onRequestPost({ env, request, waitUntil }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const game = str(b.game, 60, "game");
  if (!game) return err(400, "Pick a game");
  const note = b.note ? str(b.note, 200, "note") : null;
  const slots = int(b.slots, "slots", { min: 2, max: 30 });
  const t = now();
  let starts = b.starts_at ? int(b.starts_at, "starts_at", { min: t - 30 * 60000, max: t + 14 * 86400000 }) : t;
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM lfg_posts WHERE user_id = ? AND closed_at IS NULL AND starts_at > ?")
    .bind(me.id, t - OPEN_HOURS * 3600000).first();
  if (open.n >= 3) return err(429, "You already have 3 open posts");
  const r = await env.DB.prepare("INSERT INTO lfg_posts (user_id, game, note, starts_at, slots, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(me.id, game, note, starts, slots, t).run();
  const id = r.meta.last_row_id;
  await env.DB.prepare("INSERT INTO lfg_members (post_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, me.id, t).run();
  const p = await loadPost(env, id);
  await syncDiscord(env, p, { created: true });
  waitUntil(allMembers(env, me.id).then((ids) => notify(env, ids, "game", {
    title: `🙋 ${me.username} busca gente para ${game}`, body: [note, `Faltan ${slots - 1}`].filter(Boolean).join(" · "), url: "/#lfg" })));
  return json({ post: publicPost(p, me) });
}
