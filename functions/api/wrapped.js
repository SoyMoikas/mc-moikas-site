import { getUser, hasRole } from "../../lib/auth.js";
import { json, err } from "../../lib/util.js";
import { personYear, groupYear, isOpen, opensAt, currentYear } from "../../lib/wrapped.js";

// GET /api/wrapped?year=2026&user=ID → { me: one person's year, group } — opens Dec 1 (staff can peek early).
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return err(401, "Log in first");
  const url = new URL(request.url), cy = currentYear();
  const Y = Math.min(cy, Math.max(2026, +url.searchParams.get("year") || cy));
  const peek = hasRole(me, "staff");
  if (!isOpen(Y) && !peek) return json({ locked: true, year: Y, opens_at: opensAt(Y) });
  const uid = +url.searchParams.get("user") || me.id;
  const [person, group] = await Promise.all([personYear(env, uid, Y), groupYear(env, Y)]);
  if (!person) return err(404, "User not found");
  const { ranked, max, ...g } = group; // keep everyone's raw scores private
  void ranked; void max;
  return json({ year: Y, years: Array.from({ length: cy - 2025 }, (_, i) => cy - i).filter((y) => isOpen(y) || peek), preview: !isOpen(Y), mine: uid === me.id, person, group: g });
}
