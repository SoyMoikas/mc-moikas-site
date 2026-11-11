import { getUser, need } from "../../../lib/auth.js";
import { json, body, str, now, err } from "../../../lib/util.js";
import { PLATFORMS, fetchApex, slim, refreshApex } from "../../../lib/apex.js";

// GET /api/apex → friends' Apex cards + leaderboards (rank, RP this week)
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return err(401, "Log in first");
  const rows = (await env.DB.prepare(
    `SELECT a.*, u.username, u.avatar FROM apex_links a JOIN users u ON u.id = a.user_id`).all()).results;
  const players = rows.map((r) => {
    const d = r.data ? JSON.parse(r.data) : null;
    return { user_id: r.user_id, username: r.username, avatar: r.avatar, platform: r.platform, apex_name: r.name,
      error: r.error, updated_at: r.updated_at, ...(d || {}),
      week_rp: d?.rank?.score != null && r.week_score != null ? d.rank.score - r.week_score : null,
      week_kills: d?.kills != null && r.week_kills != null ? d.kills - r.week_kills : null, mine: r.user_id === me.id };
  });
  players.sort((a, b) => (b.rank?.score ?? -1) - (a.rank?.score ?? -1));
  return json({ configured: !!env.APEX_API_KEY, players });
}

// POST /api/apex {action: "link", name, platform} | {action: "unlink"} | {action: "refresh"}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  if (b.action === "unlink") {
    await env.DB.prepare("DELETE FROM apex_links WHERE user_id = ?").bind(me.id).run();
    return json({ ok: true });
  }
  if (b.action === "link") {
    const name = str(b.name, 40, "name");
    const platform = PLATFORMS.includes(b.platform) ? b.platform : "PC";
    if (!name) return err(400, "Enter your Apex (EA) name");
    let s;
    try { s = slim(await fetchApex(env, name, platform)); }
    catch (e) { return err(404, `Apex couldn't find "${name}" on ${platform}: ${e.message}`); }
    await env.DB.prepare(
      `INSERT INTO apex_links (user_id, platform, name, data, linked_at, updated_at, week_start, week_score, week_kills)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
       ON CONFLICT(user_id) DO UPDATE SET platform = excluded.platform, name = excluded.name, data = excluded.data,
         updated_at = excluded.updated_at, error = NULL, week_start = NULL, week_score = NULL, week_kills = NULL`
    ).bind(me.id, platform, s.name || name, JSON.stringify(s), now(), now()).run();
    await refreshApex(env, me.id).catch(() => {}); // sets this week's starting point
    return json({ ok: true, player: s });
  }
  if (b.action === "refresh") {
    const l = await env.DB.prepare("SELECT updated_at FROM apex_links WHERE user_id = ?").bind(me.id).first();
    if (!l) return err(404, "Apex isn't linked");
    if (l.updated_at > now() - 60000) return err(429, "Wait a minute before refreshing again");
    try { return json({ ok: true, player: await refreshApex(env, me.id) }); } catch (e) { return err(502, e.message); }
  }
  return err(400, "Bad action");
}
