import { json, err, body, now } from "../../../lib/util.js";
import { getUser, hasRole, need } from "../../../lib/auth.js";
import { questFields } from "../../../lib/quests.js";
import { questProgress, evaluateAutoQuests, recomputeXP } from "../../../lib/xp.js";

// Quest list. Logged-in users also get their status and progress on each quest.
export async function onRequestGet({ request, env }) {
  const user = await getUser(env, request);
  const staff = hasRole(user, "staff");
  const { results: quests } = await env.DB.prepare(
    `SELECT q.*, s.ptero_uuid, COALESCE(s.name, s.id) AS server_name,
            (SELECT COUNT(*) FROM quest_completions c WHERE c.quest_id = q.id AND c.status = 'approved') AS completions
       FROM quests q LEFT JOIN servers s ON s.id = q.server_id
      ${staff ? "" : "WHERE q.active = 1"}
      ORDER BY q.active DESC, q.sort_order, q.xp, q.id`
  ).all();

  let mine = {}, statRows = [], linked = false;
  if (user) {
    const r = await env.DB.prepare("SELECT quest_id, status, review_note FROM quest_completions WHERE user_id = ?").bind(user.id).all();
    mine = Object.fromEntries(r.results.map((c) => [c.quest_id, c]));
    const u = await env.DB.prepare("SELECT mc_uuid FROM users WHERE id = ?").bind(user.id).first();
    linked = !!u?.mc_uuid;
    if (linked) statRows = (await env.DB.prepare("SELECT ptero_uuid, stats, advancements FROM mc_stats WHERE uuid = ?").bind(u.mc_uuid).all()).results;
  }

  return json({
    linked,
    quests: quests.map(({ ptero_uuid, created_by, ...q }) => ({
      ...q,
      my_status: mine[q.id]?.status || null,
      my_note: mine[q.id]?.review_note || null,
      progress: linked && q.kind === "auto" ? questProgress({ ...q, ptero_uuid }, statRows) : null,
    })),
  });
}

// Staff: create a quest.
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = questFields(b);
  if (f.server_id && !(await env.DB.prepare("SELECT 1 FROM servers WHERE id = ?").bind(f.server_id).first())) return err(404, "Server not found");
  const t = now();
  const row = { active: 1, sort_order: 0, ...f, created_by: user.id, created_at: t, updated_at: t };
  const keys = Object.keys(row);
  const res = await env.DB.prepare(`INSERT INTO quests (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .bind(...keys.map((k) => row[k])).run();
  if (row.kind === "auto") { await evaluateAutoQuests(env); await recomputeXP(env); }
  return json({ id: res.meta.last_row_id }, 201);
}
