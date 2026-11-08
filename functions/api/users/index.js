import { json } from "../../../lib/util.js";
import { needPerm } from "../../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  const user = await needPerm(env, request, "users");
  if (user instanceof Response) return user;
  const { results } = await env.DB.prepare(
    `SELECT id, discord_id, username, avatar, role, created_at, last_login, mc_name, xp, permissions FROM users
      ORDER BY CASE role WHEN 'pending' THEN 0 WHEN 'admin' THEN 1 WHEN 'subadmin' THEN 2 WHEN 'staff' THEN 3 ELSE 4 END, created_at DESC`
  ).all();
  return json({ users: results, owner_discord_id: String(env.ADMIN_DISCORD_ID || "") });
}
