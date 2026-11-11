import { getUser, need, hasRole } from "../../../lib/auth.js";
import { json, body, str, int, now, err } from "../../../lib/util.js";
import { notify, allMembers } from "../../../lib/notify.js";
import { discord, site } from "../../../lib/lfg.js";

// GET ?from=ms&to=ms → everything on the group calendar in that range:
//   real-life events, game/movie nights, tournaments, scheduled "¿Quién se apunta?", birthdays, the Secret Santa reveal
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ items: [] });
  const q = new URL(request.url).searchParams;
  const from = parseInt(q.get("from")) || now() - 7 * 86400000, to = Math.min(parseInt(q.get("to")) || now() + 60 * 86400000, from + 100 * 86400000);
  const DB = env.DB, items = [];
  const rows = async (sql, ...b) => { try { return (await DB.prepare(sql).bind(...b).all()).results; } catch { return []; } };
  for (const e of await rows(`SELECT e.*, u.username,
        (SELECT COUNT(*) FROM event_rsvp r WHERE r.event_id = e.id AND r.status = 'yes') AS going,
        (SELECT status FROM event_rsvp r WHERE r.event_id = e.id AND r.user_id = ?) AS mine
      FROM events e LEFT JOIN users u ON u.id = e.created_by WHERE e.starts_at BETWEEN ? AND ?`, me.id, from, to))
    items.push({ type: "event", id: e.id, at: e.starts_at, title: e.title, place: e.place, description: e.description, by: e.username, going: e.going, mine: e.mine, can_delete: e.created_by === me.id || hasRole(me, "staff") });
  for (const n of await rows(`SELECT id, title, game, starts_at, COALESCE(kind, 'game') AS kind FROM game_nights WHERE status IN ('locked','done') AND starts_at BETWEEN ? AND ?`, from, to))
    items.push({ type: n.kind === "watch" ? "movie" : "night", id: n.id, at: n.starts_at, title: `${n.title}: ${n.game}`, url: n.kind === "watch" ? `/juntos?night=${n.id}#cine` : `/play?night=${n.id}#noches` });
  for (const x of await rows(`SELECT id, title, game, starts_at FROM tournaments WHERE status != 'done' AND starts_at BETWEEN ? AND ?`, from, to))
    items.push({ type: "tourney", id: x.id, at: x.starts_at, title: `${x.title} (${x.game})`, url: `/tournaments?id=${x.id}` });
  for (const x of await rows(`SELECT p.id, p.game, p.starts_at, u.username FROM lfg_posts p JOIN users u ON u.id = p.user_id
                               WHERE p.closed_at IS NULL AND p.starts_at > p.created_at + 3600000 AND p.starts_at BETWEEN ? AND ?`, from, to))
    items.push({ type: "lfg", id: x.id, at: x.starts_at, title: `${x.game} (${x.username})`, url: "/#lfg" });
  for (const x of await rows(`SELECT id, title, reveal_at FROM exchanges WHERE reveal_at BETWEEN ? AND ?`, from, to))
    items.push({ type: "exchange", id: x.id, at: x.reveal_at, title: `🎁 ${x.title}`, url: "/juntos#intercambio" });
  // birthdays: month-day → every year in range (noon UTC so it lands on the right date for everyone)
  for (const u of await rows("SELECT id, username, birthday FROM users WHERE birthday IS NOT NULL AND role != 'pending'")) {
    for (let y = new Date(from).getUTCFullYear(); y <= new Date(to).getUTCFullYear(); y++) {
      const at = Date.parse(`${y}-${u.birthday}T12:00:00Z`);
      if (at >= from - 86400000 && at <= to) items.push({ type: "birthday", id: u.id, at, title: `🎂 ${u.username}`, url: `/profile?id=${u.id}`, all_day: true });
    }
  }
  items.sort((a, b) => a.at - b.at);
  return json({ items, from, to });
}

// POST {action: "create", title, place, description, starts_at} | {action: "rsvp", id, status: yes|maybe|no} | {action: "delete", id}
export async function onRequestPost({ env, request, waitUntil }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now();
  if (b.action === "create") {
    const title = str(b.title, 80, "title");
    if (!title) return err(400, "What's the plan?");
    const at = int(b.starts_at, "starts_at", { min: t - 86400000, max: t + 365 * 86400000 });
    const r = await env.DB.prepare("INSERT INTO events (title, place, description, starts_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(title, b.place ? str(b.place, 80, "place") : null, b.description ? str(b.description, 400, "description") : null, at, me.id, t).run();
    await env.DB.prepare("INSERT INTO event_rsvp (event_id, user_id, status) VALUES (?, ?, 'yes')").bind(r.meta.last_row_id, me.id).run();
    waitUntil((async () => {
      await notify(env, await allMembers(env, me.id), "game", { title: `📅 ${me.username} propone: ${title}`, body: `{t:${at}}${b.place ? ` · ${b.place}` : ""}`, url: "/juntos#calendario" });
      if (env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL) await discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, {
        content: `📅 **${me.username}** propone un plan: **${title}** — <t:${Math.floor(at / 1000)}:F>${b.place ? ` en ${b.place}` : ""}. ¿Quién va? ${site(env)}/juntos#calendario`, allowed_mentions: { parse: [] } });
    })());
    return json({ id: r.meta.last_row_id });
  }
  const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(b.id).first();
  if (!e) return err(404, "Not found");
  if (b.action === "rsvp") {
    if (!["yes", "maybe", "no"].includes(b.status)) return err(400, "Bad status");
    await env.DB.prepare("INSERT INTO event_rsvp (event_id, user_id, status) VALUES (?, ?, ?) ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status")
      .bind(e.id, me.id, b.status).run();
  } else if (b.action === "delete") {
    if (e.created_by !== me.id && !hasRole(me, "staff")) return err(403, "Not allowed");
    await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(e.id).run();
  } else return err(400, "Bad action");
  return json({ ok: true });
}
