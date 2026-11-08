import { parseCookies, sha256, now, err } from "./util.js";

export const ROLES = ["pending", "member", "staff", "subadmin", "admin"];
// Admin powers a sub-admin can be given. Admins have all of them.
export const PERMS = ["users", "servers", "store"];
const RANK = Object.fromEntries(ROLES.map((r, i) => [r, i]));

export const SESSION_COOKIE = "sid";
export const SESSION_DAYS = 30;

export function hasRole(user, role) {
  return !!user && RANK[user.role] >= RANK[role];
}

export function permsOf(user) {
  if (!user) return [];
  if (user.role === "admin") return PERMS;
  if (user.role !== "subadmin") return [];
  try { return JSON.parse(user.permissions || "[]").filter((p) => PERMS.includes(p)); } catch { return []; }
}
export const hasPerm = (user, perm) => permsOf(user).includes(perm);

// Returns the user if they're an admin, or a sub-admin with `perm`; otherwise a 401/403 Response.
export async function needPerm(env, request, perm) {
  const user = await getUser(env, request);
  if (!user) return err(401, "Log in first");
  if (!hasPerm(user, perm)) return err(403, "Not allowed");
  return user;
}

export async function getUser(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.discord_id, u.username, u.avatar, u.role, u.mc_name, u.xp, u.play_minutes, u.coins_spent, u.coins_earned, u.eq_frame, u.eq_hat, u.eq_color, u.permissions
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(hash, now()).first();
  return row || null;
}

// Returns the user if they have at least `role`, otherwise a 401/403 Response.
export async function need(env, request, role) {
  const user = await getUser(env, request);
  if (!user) return err(401, "Log in first");
  if (!hasRole(user, role)) {
    return err(403, user.role === "pending" ? "Your account is waiting for approval" : "Not allowed");
  }
  return user;
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, avatar: u.avatar, role: u.role, mc_name: u.mc_name || null, xp: u.xp || 0, play_minutes: u.play_minutes || 0,
    eq_frame: u.eq_frame || null, eq_hat: u.eq_hat || null, eq_color: u.eq_color || null,
    coins: Math.max(0, (u.coins_earned || 0) - (u.coins_spent || 0)), permissions: permsOf(u) };
}
