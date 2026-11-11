import { getUser, need } from "../../lib/auth.js";
import { json, body, err, now } from "../../lib/util.js";
import { validTz } from "../../lib/coins.js";

// "¿Cuándo pueden?" — each person marks the hours they're usually free, in their own time zone.
// GET → { mine, people: [{id, username, avatar, tz, slots}], missing: [...] }   POST {tz, slots: [0..167]} (Monday 00:00 = 0)
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return err(401, "Log in first");
  const rows = (await env.DB.prepare(`SELECT a.user_id AS id, a.tz, a.slots, a.updated_at, u.username, u.avatar FROM availability a JOIN users u ON u.id = a.user_id
                                       WHERE u.role != 'pending' ORDER BY u.username`).all()).results.map((r) => ({ ...r, slots: JSON.parse(r.slots) }));
  const have = new Set(rows.map((r) => r.id));
  const recent = (await env.DB.prepare("SELECT id, username, avatar FROM users WHERE role != 'pending' AND last_login > ? ORDER BY last_login DESC")
    .bind(now() - 45 * 86400000).all()).results;
  return json({ mine: rows.find((r) => r.id === me.id) || null, people: rows.filter((r) => r.slots.length), missing: recent.filter((u) => !have.has(u.id)) });
}

export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  if (!validTz(b.tz)) return err(400, "Bad time zone");
  const slots = [...new Set((Array.isArray(b.slots) ? b.slots : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 168))].sort((a, z) => a - z);
  await env.DB.prepare("INSERT OR REPLACE INTO availability (user_id, tz, slots, updated_at) VALUES (?, ?, ?, ?)").bind(me.id, b.tz, JSON.stringify(slots), now()).run();
  return json({ ok: true, count: slots.length });
}
