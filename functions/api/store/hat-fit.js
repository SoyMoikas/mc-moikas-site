import { json, err, body } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";

// Fit your equipped hat to your own avatar: { size, x, y, rotate } (same ranges as store items) or { reset: true }.
// Saved on your account and used everywhere your avatar shows. Equipping a different hat clears it.
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "pending");
  if (user instanceof Response) return user;
  if (!user.eq_hat) return err(400, "Equip a hat first");
  const b = await body(request);
  if (b instanceof Response) return b;
  if (b.reset) {
    await env.DB.prepare("UPDATE users SET hat_fit = NULL WHERE id = ?").bind(user.id).run();
    return json({ hat_fit: null });
  }
  const num = (n, lo, hi) => { const x = Number(n); if (!Number.isFinite(x)) throw Object.assign(new Error(), { bad: true }); return Math.min(hi, Math.max(lo, Math.round(x))); };
  let fit;
  try { fit = { size: num(b.size, 30, 200), x: num(b.x, -150, 150), y: num(b.y, -150, 150), rotate: num(b.rotate ?? 0, -180, 180) }; }
  catch { return err(400, "Size, x and y must be numbers"); }
  const s = JSON.stringify(fit);
  await env.DB.prepare("UPDATE users SET hat_fit = ? WHERE id = ?").bind(s, user.id).run();
  return json({ hat_fit: s });
}
