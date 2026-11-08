import { json, err, body, now, str, HttpError } from "../../../lib/util.js";
import { need, hasRole } from "../../../lib/auth.js";
import { ITEMS, STICKER_RE, ownedSet, owns } from "../../../lib/catalog.js";

// Channels: "general" or a server id. Members and up can read and post.

async function checkChannel(env, channel, user) {
  if (channel === "general") return;
  const s = await env.DB.prepare("SELECT hidden FROM servers WHERE id = ?").bind(channel).first();
  if (!s || (s.hidden && !hasRole(user, "admin"))) throw new HttpError(404, "Server not found");
}

// GET /api/chat/:channel            → latest 50 messages
// GET /api/chat/:channel?after=ID&since=ID → new messages after ID, plus ids deleted since `since`
export async function onRequestGet({ request, env, params }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  await checkChannel(env, params.channel, user);

  const url = new URL(request.url);
  const after = Number(url.searchParams.get("after")) || 0;
  const since = Number(url.searchParams.get("since")) || 0;

  const cols = `m.id, m.body, m.created_at, m.user_id, u.username, u.avatar, u.role, u.xp, u.eq_frame, u.eq_hat, u.eq_color`;
  let rows;
  if (after) {
    ({ results: rows } = await env.DB.prepare(
      `SELECT ${cols} FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.channel = ? AND m.id > ? AND m.deleted = 0 ORDER BY m.id ASC LIMIT 100`
    ).bind(params.channel, after).all());
  } else {
    ({ results: rows } = await env.DB.prepare(
      `SELECT * FROM (SELECT ${cols} FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.channel = ? AND m.deleted = 0 ORDER BY m.id DESC LIMIT 50) ORDER BY id ASC`
    ).bind(params.channel).all());
  }

  let removed = [];
  if (since) {
    const r = await env.DB.prepare(
      "SELECT id FROM chat_messages WHERE channel = ? AND deleted = 1 AND id >= ?"
    ).bind(params.channel, since).all();
    removed = r.results.map((x) => x.id);
  }

  const staff = hasRole(user, "staff");
  const messages = rows.map(({ user_id, ...m }) => ({ ...m, mine: user_id === user.id, can_delete: staff || user_id === user.id }));
  return json({ messages, removed });
}

export async function onRequestPost({ request, env, params }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  await checkChannel(env, params.channel, user);
  const b = await body(request, 8 * 1024);
  if (b instanceof Response) return b;
  const text = str(b.body, 500, "message");
  if (!text) return err(400, "Message can't be empty");
  const sticker = text.match(STICKER_RE);
  if (sticker) {
    const item = ITEMS[sticker[1]];
    if (!item || item.type !== "sticker" || !owns(item, await ownedSet(env, user.id), user.xp)) return err(403, "You don't own that sticker");
  }

  // Flood control: 6 messages per 10 seconds per user.
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND created_at > ?")
    .bind(user.id, now() - 10_000).first();
  if (recent.n >= 6) return err(429, "Slow down a little");

  const res = await env.DB.prepare(
    "INSERT INTO chat_messages (channel, user_id, body, created_at) VALUES (?, ?, ?, ?)"
  ).bind(params.channel, user.id, text, now()).run();
  return json({ id: res.meta.last_row_id }, 201);
}
