import { json } from "../../lib/util.js";

// Ranking: every approved member, by XP (playtime + quests + site activity). site_xp = the activity part.
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, username, avatar, role, mc_name, xp, play_minutes, eq_frame, eq_hat, hat_fit, avatar_build, acc_extra, eq_color, eq_banner, eq_font,
            (SELECT COUNT(*) FROM quest_completions c WHERE c.user_id = users.id AND c.status = 'approved') AS quests,
            (SELECT COALESCE(SUM(a.amount), 0) FROM activity_xp a WHERE a.user_id = users.id) AS site_xp
       FROM users WHERE role != 'pending' 
      ORDER BY xp DESC, play_minutes DESC, username LIMIT 200`
  ).all();
  return json({ players: results });
}
