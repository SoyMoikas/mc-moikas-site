import { json } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";

// Staff: manual quest submissions waiting for review.
export async function onRequestGet({ request, env }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.proof, c.created_at, q.id AS quest_id, q.title, q.title_es, q.xp,
            u.id AS user_id, u.username, u.avatar, u.mc_name
       FROM quest_completions c JOIN quests q ON q.id = c.quest_id JOIN users u ON u.id = c.user_id
      WHERE c.status = 'pending' ORDER BY c.created_at ASC LIMIT 200`
  ).all();
  return json({ reviews: results });
}
