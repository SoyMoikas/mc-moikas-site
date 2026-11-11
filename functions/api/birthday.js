import { need } from "../../lib/auth.js";
import { json, body, err } from "../../lib/util.js";

// GET → your birthday ("MM-DD" or null). POST {birthday: "MM-DD" | null}. Only the day is stored, never the year.
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const r = await env.DB.prepare("SELECT birthday FROM users WHERE id = ?").bind(me.id).first();
  return json({ birthday: r?.birthday || null });
}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  let v = b.birthday || null;
  if (v !== null) {
    const m = /^(\d{2})-(\d{2})$/.exec(String(v));
    if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31) return err(400, "Use month and day");
    // only one change a month, so nobody farms birthday coins
    const cur = await env.DB.prepare("SELECT birthday FROM users WHERE id = ?").bind(me.id).first();
    const recent = await env.DB.prepare("SELECT 1 FROM coin_awards WHERE user_id = ? AND source = 'birthday' AND created_at > ?").bind(me.id, Date.now() - 300 * 86400000).first();
    if (cur?.birthday && cur.birthday !== v && recent) return err(409, "Your birthday was already celebrated this year — you can change it later");
  }
  await env.DB.prepare("UPDATE users SET birthday = ? WHERE id = ?").bind(v, me.id).run();
  return json({ birthday: v });
}
