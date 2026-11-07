import { parseCookies, sha256, now, err } from "./util.js";

export const ROLES = ["pending", "member", "staff", "admin"];
const RANK = Object.fromEntries(ROLES.map((r, i) => [r, i]));

export const SESSION_COOKIE = "sid";
export const SESSION_DAYS = 30;

export function hasRole(user, role) {
  return !!user && RANK[user.role] >= RANK[role];
}

export async function getUser(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.discord_id, u.username, u.avatar, u.role
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
  return { id: u.id, username: u.username, avatar: u.avatar, role: u.role };
}
