import { json } from "../../lib/util.js";

// Top players by XP (only people who have linked a Minecraft account or earned quest XP).
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, username, avatar, role, mc_name, xp, play_minutes, eq_frame, eq_hat, hat_fit, avatar_build, acc_extra, eq_color, eq_banner, eq_font,
            (SELECT COUNT(*) FROM quest_completions c WHERE c.user_id = users.id AND c.status = 'approved') AS quests
       FROM users WHERE role != 'pending' AND (mc_uuid IS NOT NULL OR xp > 0)
      ORDER BY xp DESC, play_minutes DESC LIMIT 100`
  ).all();
  return json({ players: results });
}
