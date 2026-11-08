import { json, err } from "../../../lib/util.js";

// Public profile: level info, hours per server, completed quests.
export async function onRequestGet({ env, params }) {
  const u = await env.DB.prepare(
    "SELECT id, username, avatar, role, mc_uuid, mc_name, xp, play_minutes, created_at, eq_frame, eq_hat, eq_color FROM users WHERE id = ?"
  ).bind(params.id).first();
  if (!u) return err(404, "User not found");

  const [servers, quests, rank] = await env.DB.batch([
    env.DB.prepare(
      `SELECT st.play_minutes, st.updated_at, COALESCE(s.name, s.id) AS server_name, s.id AS server_id, s.hidden,
              json_extract(p.data, '$.name') AS ptero_name
         FROM mc_stats st
         LEFT JOIN servers s ON s.ptero_uuid = st.ptero_uuid
         LEFT JOIN ptero_servers p ON p.uuid = st.ptero_uuid
        WHERE st.uuid = ? ORDER BY st.play_minutes DESC`
    ).bind(u.mc_uuid || ""),
    env.DB.prepare(
      `SELECT q.id, q.title, q.title_es, q.xp, c.reviewed_at
         FROM quest_completions c JOIN quests q ON q.id = c.quest_id
        WHERE c.user_id = ? AND c.status = 'approved' ORDER BY c.reviewed_at DESC`
    ).bind(u.id),
    env.DB.prepare(
      "SELECT COUNT(*) + 1 AS position FROM users WHERE role != 'pending' AND (xp > ? OR (xp = ? AND play_minutes > ?))"
    ).bind(u.xp, u.xp, u.play_minutes),
  ]);

  const { mc_uuid, ...pub } = u;
  return json({
    user: { ...pub, linked: !!mc_uuid },
    position: u.xp > 0 ? rank.results[0].position : null,
    servers: servers.results
      .filter((s) => !s.hidden)
      .map((s) => ({ name: s.server_name || s.ptero_name || "?", server_id: s.server_id, minutes: s.play_minutes })),
    quests: quests.results,
  });
}
