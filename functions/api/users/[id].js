import { json, err, body } from "../../../lib/util.js";
import { need, ROLES } from "../../../lib/auth.js";

// Admin: change someone's role (pending → member → staff → admin).
export async function onRequestPatch({ request, env, params }) {
  const user = await need(env, request, "admin");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  if (!ROLES.includes(b.role)) return err(400, "Invalid role");

  const target = await env.DB.prepare("SELECT id, discord_id FROM users WHERE id = ?").bind(params.id).first();
  if (!target) return err(404, "User not found");
  if (target.id === user.id) return err(400, "You can't change your own role");
  if (target.discord_id === String(env.ADMIN_DISCORD_ID || "")) return err(400, "The site owner is always admin");

  // Roles are read on every request, so the change applies immediately without re-login.
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(b.role, target.id).run();
  return json({ ok: true });
}
