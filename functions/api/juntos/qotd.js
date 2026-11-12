import { need, hasRole } from "../../../lib/auth.js";
import { json, body, str, now, err } from "../../../lib/util.js";
import { questionFor } from "../../../lib/qotd.js";
import { award, dayIn, zoneOf } from "../../../lib/coins.js";

// GET → today's question (your date); answers only once you've answered. POST {answer}
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const day = dayIn(zoneOf(me));
  const mine = await env.DB.prepare("SELECT answer FROM qotd_answers WHERE day = ? AND user_id = ?").bind(day, me.id).first();
  const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM qotd_answers WHERE day = ?").bind(day).first()).n;
  const answers = mine ? (await env.DB.prepare(
    `SELECT a.answer, a.created_at, u.id, u.username, u.avatar FROM qotd_answers a JOIN users u ON u.id = a.user_id WHERE a.day = ? ORDER BY a.created_at`).bind(day).all()).results : [];
  return json({ day, question: questionFor(day), answered: !!mine, mine: mine?.answer || null, me: me.id, staff: hasRole(me, "staff"), count, answers });
}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const day = dayIn(zoneOf(me));
  // delete: your own answer, or staff removing someone's ({user_id}). Coins stay (they're only paid once per day anyway).
  if (b.action === "delete") {
    const uid = b.user_id && +b.user_id !== me.id ? +b.user_id : me.id;
    if (uid !== me.id && !hasRole(me, "staff")) return err(403, "You can only delete your own answer");
    await env.DB.prepare("DELETE FROM qotd_answers WHERE day = ? AND user_id = ?").bind(b.day && uid !== me.id ? String(b.day).slice(0, 10) : day, uid).run();
    return json({ ok: true });
  }
  const answer = str(b.answer, 500, "answer");
  if (!answer) return err(400, "Write something");
  if (b.action === "edit") {
    const r = await env.DB.prepare("UPDATE qotd_answers SET answer = ? WHERE day = ? AND user_id = ?").bind(answer, day, me.id).run();
    if (!r.meta.changes) return err(404, "You haven't answered today");
    return json({ ok: true });
  }
  const r = await env.DB.prepare("INSERT OR IGNORE INTO qotd_answers (day, user_id, answer, created_at) VALUES (?, ?, ?, ?)").bind(day, me.id, answer, now()).run();
  if (!r.meta.changes) return err(409, "You already answered today");
  await award(env, me.id, "qotd", day, 5);
  return json({ ok: true });
}
