import { json, err, body, now, str, HttpError } from "../../../lib/util.js";
import { need, hasRole, hasPerm } from "../../../lib/auth.js";
import { STICKER_RE, getItem, ownedSet, owns } from "../../../lib/catalog.js";

// Channels: "general", "game:<id>", or a server id. Members and up can read and post.
const channelOf = (params) => { try { return decodeURIComponent(params.channel); } catch { return params.channel; } };

async function checkChannel(env, channel, user) {
  if (channel === "general") return;
  if (channel.startsWith("game:")) {
    const g = await env.DB.prepare("SELECT active FROM games WHERE id = ?").bind(channel.slice(5)).first();
    if (!g || (!g.active && !hasPerm(user, "servers"))) throw new HttpError(404, "Game not found");
    return;
  }
  const s = await env.DB.prepare("SELECT hidden FROM servers WHERE id = ?").bind(channel).first();
  if (!s || (s.hidden && !hasPerm(user, "servers"))) throw new HttpError(404, "Server not found");
}

// GET /api/chat/:channel            → latest 50 messages
// GET /api/chat/:channel?after=ID&since=ID → new messages after ID, plus ids deleted since `since`
export async function onRequestGet({ request, env, params }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  const channel = channelOf(params);
  await checkChannel(env, channel, user);

  const url = new URL(request.url);
  const after = Number(url.searchParams.get("after")) || 0;
  const since = Number(url.searchParams.get("since")) || 0;

  const cols = `m.id, m.body, m.created_at, m.user_id, u.username, u.avatar, u.role, u.xp, u.eq_frame, u.eq_hat, u.hat_fit, u.avatar_build, u.eq_color, u.eq_font, u.eq_text`;
  let rows;
  if (after) {
    ({ results: rows } = await env.DB.prepare(
      `SELECT ${cols} FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.channel = ? AND m.id > ? AND m.deleted = 0 ORDER BY m.id ASC LIMIT 100`
    ).bind(channel, after).all());
  } else {
    ({ results: rows } = await env.DB.prepare(
      `SELECT * FROM (SELECT ${cols} FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.channel = ? AND m.deleted = 0 ORDER BY m.id DESC LIMIT 50) ORDER BY id ASC`
    ).bind(channel).all());
  }

  let removed = [];
  if (since) {
    const r = await env.DB.prepare(
      "SELECT id FROM chat_messages WHERE channel = ? AND deleted = 1 AND id >= ?"
    ).bind(channel, since).all();
    removed = r.results.map((x) => x.id);
  }

  const staff = hasRole(user, "staff");
  const messages = rows.map(({ user_id, ...m }) => ({ ...m, mine: user_id === user.id, can_delete: staff || user_id === user.id }));
  // "Pulse": tiny fingerprints of the feed and announcements, so the page can refresh those
  // the moment they change without making its own requests.
  const pulse = await env.DB.prepare(
    `SELECT (SELECT MAX(id) FROM social_posts WHERE deleted = 0) AS feed,
            (SELECT COUNT(*) || ':' || IFNULL(MAX(updated_at), 0) FROM posts) AS posts`
  ).first();
  return json({ messages, removed, pulse });
}

export async function onRequestPost({ request, env, params }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  const channel = channelOf(params);
  await checkChannel(env, channel, user);
  const b = await body(request, 8 * 1024);
  if (b instanceof Response) return b;
  const text = str(b.body, 500, "message");
  if (!text) return err(400, "Message can't be empty");
  const sticker = text.match(STICKER_RE);
  if (sticker) {
    const item = await getItem(env, sticker[1]);
    if (!item || item.type !== "sticker" || !owns(item, await ownedSet(env, user.id), user.xp)) return err(403, "You don't own that sticker");
  }

  // Flood control: 6 messages per 10 seconds per user.
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND created_at > ?")
    .bind(user.id, now() - 10_000).first();
  if (recent.n >= 6) return err(429, "Slow down a little");

  const res = await env.DB.prepare(
    "INSERT INTO chat_messages (channel, user_id, body, created_at) VALUES (?, ?, ?, ?)"
  ).bind(channel, user.id, text, now()).run();
  return json({ id: res.meta.last_row_id }, 201);
}
