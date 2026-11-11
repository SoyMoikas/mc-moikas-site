import { getUser, need } from "../../../lib/auth.js";
import { json, body, str, int, now, err } from "../../../lib/util.js";
import { award, dayIn, zoneOf } from "../../../lib/coins.js";
import { notify } from "../../../lib/notify.js";

const MAX_GOALS = 3, CHECK_COINS = 5;
const weekDays = (day) => { const d = new Date(day + "T12:00:00Z"), back = (d.getUTCDay() + 6) % 7; return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setUTCDate(d.getUTCDate() - back + i); return x.toISOString().slice(0, 10); }); };

// GET → everyone's active goals with this week's check-ins, streak (weeks in a row meeting the target), cheers
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ goals: [] });
  const today = dayIn(zoneOf(me)), week = weekDays(today);
  const goals = (await env.DB.prepare(
    `SELECT g.*, u.username, u.avatar FROM goals g JOIN users u ON u.id = g.user_id WHERE g.active = 1 ORDER BY g.user_id = ? DESC, g.created_at DESC`).bind(me.id).all()).results;
  if (!goals.length) return json({ goals: [], today, week });
  const ids = goals.map((g) => g.id), inList = ids.map(() => "?").join(",");
  const checks = (await env.DB.prepare(`SELECT goal_id, day, note FROM goal_checks WHERE goal_id IN (${inList}) AND day >= ? ORDER BY day DESC`)
    .bind(...ids, (() => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 120); return d.toISOString().slice(0, 10); })()).all()).results;
  const cheers = (await env.DB.prepare(`SELECT c.goal_id, u.username FROM goal_cheers c JOIN users u ON u.id = c.user_id WHERE c.goal_id IN (${inList}) AND c.day >= ?`)
    .bind(...ids, week[0]).all()).results;
  return json({ today, week, goals: goals.map((g) => {
    const mine = checks.filter((c) => c.goal_id === g.id);
    // streak: consecutive past weeks (plus this one if already met) that hit per_week
    let streak = 0;
    for (let w = 0; w < 17; w++) {
      const d = new Date(week[0] + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 7 * w);
      const days = weekDays(d.toISOString().slice(0, 10));
      const n = mine.filter((c) => days.includes(c.day)).length;
      if (n >= g.per_week) streak++; else if (w > 0) break;
    }
    return { ...g, week: week.map((d) => !!mine.find((c) => c.day === d)), done_week: mine.filter((c) => week.includes(c.day)).length,
      checked_today: !!mine.find((c) => c.day === today), last_note: mine.find((c) => c.note)?.note || null, streak,
      cheers: cheers.filter((c) => c.goal_id === g.id).map((c) => c.username), mine: g.user_id === me.id };
  }) });
}

// POST {action: "create", title, icon, per_week} | {action: "check"|"uncheck"|"cheer"|"archive", id, note?}
export async function onRequestPost({ env, request, waitUntil }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now(), today = dayIn(zoneOf(me));
  if (b.action === "create") {
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM goals WHERE user_id = ? AND active = 1").bind(me.id).first()).n;
    if (n >= MAX_GOALS) return err(429, `Up to ${MAX_GOALS} goals at a time`);
    const title = str(b.title, 80, "title");
    if (!title) return err(400, "What's the goal?");
    const r = await env.DB.prepare("INSERT INTO goals (user_id, title, icon, per_week, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(me.id, title, str(b.icon, 8, "icon") || "🎯", int(b.per_week || 3, "per_week", { min: 1, max: 7 }), t).run();
    return json({ id: r.meta.last_row_id });
  }
  const g = await env.DB.prepare("SELECT * FROM goals WHERE id = ? AND active = 1").bind(b.id).first();
  if (!g) return err(404, "Not found");
  const mine = g.user_id === me.id;
  if (b.action === "check") {
    if (!mine) return err(403, "Not your goal");
    const r = await env.DB.prepare("INSERT OR IGNORE INTO goal_checks (goal_id, day, note, created_at) VALUES (?, ?, ?, ?)").bind(g.id, today, b.note ? str(b.note, 200, "note") : null, t).run();
    if (r.meta.changes) await award(env, me.id, "goal", `${g.id}:${today}`, CHECK_COINS);
  } else if (b.action === "uncheck") {
    if (!mine) return err(403, "Not your goal");
    await env.DB.prepare("DELETE FROM goal_checks WHERE goal_id = ? AND day = ?").bind(g.id, today).run();
  } else if (b.action === "cheer") {
    if (mine) return err(400, "Cheer for someone else 😄");
    const r = await env.DB.prepare("INSERT OR IGNORE INTO goal_cheers (goal_id, user_id, day) VALUES (?, ?, ?)").bind(g.id, me.id, today).run();
    if (r.meta.changes) waitUntil(notify(env, [g.user_id], "fun", { title: `👏 ${me.username} te echa porras`, body: `${g.icon || "🎯"} ${g.title}`, url: "/juntos#retos" }));
  } else if (b.action === "archive") {
    if (!mine) return err(403, "Not your goal");
    await env.DB.prepare("UPDATE goals SET active = 0 WHERE id = ?").bind(g.id).run();
  } else return err(400, "Bad action");
  return json({ ok: true });
}
