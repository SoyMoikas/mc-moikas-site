import { getUser, need } from "../../../lib/auth.js";
import { json, body, now, err } from "../../../lib/util.js";

// GET /api/quotes?sort=top|new&month=YYYY-MM → the quote wall
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ quotes: [] });
  const q = new URL(request.url).searchParams;
  const sort = q.get("sort") === "new" ? "q.created_at DESC" : "votes DESC, q.created_at DESC";
  let where = "", bind = [];
  if (/^\d{4}-\d{2}$/.test(q.get("month") || "")) {
    const from = Date.parse(q.get("month") + "-01T08:00:00Z"); const d = new Date(from); d.setUTCMonth(d.getUTCMonth() + 1);
    where = "WHERE q.created_at >= ? AND q.created_at < ?"; bind = [from, d.getTime()];
  }
  const quotes = (await env.DB.prepare(
    `SELECT q.id, q.body, q.said_at, q.created_at, a.id AS author_id, a.username AS author, a.avatar AS author_avatar, s.username AS saved_by,
            (SELECT COUNT(*) FROM quote_votes v WHERE v.quote_id = q.id) AS votes,
            EXISTS (SELECT 1 FROM quote_votes v WHERE v.quote_id = q.id AND v.user_id = ?) AS mine
       FROM quotes q LEFT JOIN users a ON a.id = q.author_id LEFT JOIN users s ON s.id = q.saved_by ${where}
      ORDER BY ${sort} LIMIT 60`).bind(me.id, ...bind).all()).results;
  return json({ quotes });
}

// POST /api/quotes {message_id} → save a chat message to the wall
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const m = await env.DB.prepare("SELECT id, user_id, body, created_at FROM chat_messages WHERE id = ? AND deleted = 0").bind(b.message_id).first();
  if (!m) return err(404, "Message not found");
  if (/^\s*\[\[sticker:|^https?:\/\/\S+$|\/api\/uploads\//.test(m.body)) return err(400, "Only text messages can be quotes");
  const r = await env.DB.prepare("INSERT OR IGNORE INTO quotes (message_id, body, author_id, saved_by, said_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(m.id, m.body.slice(0, 400), m.user_id, me.id, m.created_at, now()).run();
  if (!r.meta.changes) return err(409, "Already on the wall");
  return json({ id: r.meta.last_row_id });
}
