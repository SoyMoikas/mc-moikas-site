import { json, err, body } from "../../../lib/util.js";
import { needPerm, ROLES, PERMS } from "../../../lib/auth.js";
import { recomputeXP } from "../../../lib/xp.js";

// Roles a sub-admin with the "users" permission may hand out or change.
const SUB_MANAGEABLE = ["pending", "member", "staff"];

// Body: { role } and/or { permissions: [...] } (admin only, for sub-admins) or { unlink_mc: true }.
export async function onRequestPatch({ request, env, params }) {
  const user = await needPerm(env, request, "users");
  if (user instanceof Response) return user;
  const isAdmin = user.role === "admin";
  const b = await body(request);
  if (b instanceof Response) return b;

  const target = await env.DB.prepare("SELECT id, discord_id, role FROM users WHERE id = ?").bind(params.id).first();
  if (!target) return err(404, "User not found");
  const owner = target.discord_id === String(env.ADMIN_DISCORD_ID || "");
  // Sub-admins can only touch pending/member/staff accounts.
  if (!isAdmin && !SUB_MANAGEABLE.includes(target.role)) return err(403, "Only the admin can change this user");

  if (b.unlink_mc) {
    await env.DB.prepare("UPDATE users SET mc_uuid = NULL, mc_name = NULL WHERE id = ?").bind(target.id).run();
    await recomputeXP(env, target.id);
    return json({ ok: true });
  }

  if (target.id === user.id) return err(400, "You can't change your own role");
  if (owner) return err(400, "The site owner is always admin");

  let role = target.role;
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return err(400, "Invalid role");
    if (!isAdmin && !SUB_MANAGEABLE.includes(b.role)) return err(403, "Only the admin can give that role");
    role = b.role;
  }

  let permissions = null;
  if (role === "subadmin") {
    if (b.permissions !== undefined) {
      if (!isAdmin) return err(403, "Only the admin can change permissions");
      if (!Array.isArray(b.permissions)) return err(400, "permissions must be a list");
      permissions = JSON.stringify([...new Set(b.permissions.filter((p) => PERMS.includes(p)))]);
    } else {
      const cur = await env.DB.prepare("SELECT permissions FROM users WHERE id = ?").bind(target.id).first();
      permissions = cur?.permissions || "[]";
    }
  }

  await env.DB.prepare("UPDATE users SET role = ?, permissions = ? WHERE id = ?").bind(role, permissions, target.id).run();
  return json({ ok: true });
}
