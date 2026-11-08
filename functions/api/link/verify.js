import { json, err, body, now, str, timingSafeEqual } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";
import { evaluateAutoQuests, recomputeXP } from "../../../lib/xp.js";

const CODE_TTL_MS = 15 * 60 * 1000;

// Finish linking: { code } — the 6 digits the player got in-game.
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "pending");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const code = (str(b.code, 12, "code") || "").replace(/\D/g, "");

  const link = await env.DB.prepare("SELECT * FROM mc_links WHERE user_id = ? AND created_at > ?")
    .bind(user.id, now() - CODE_TTL_MS).first();
  if (!link) return err(400, "Code expired");
  if (link.attempts >= 5) return err(429, "Too many attempts");
  if (!timingSafeEqual(code, link.code)) {
    await env.DB.prepare("UPDATE mc_links SET attempts = attempts + 1 WHERE user_id = ?").bind(user.id).run();
    return err(400, "Wrong code");
  }
  const taken = await env.DB.prepare("SELECT id FROM users WHERE mc_uuid = ? AND id != ?").bind(link.mc_uuid, user.id).first();
  if (taken) return err(409, "Already linked to someone else");

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET mc_uuid = ?, mc_name = ? WHERE id = ?").bind(link.mc_uuid, link.mc_name, user.id),
    env.DB.prepare("DELETE FROM mc_links WHERE user_id = ?").bind(user.id),
  ]);
  await evaluateAutoQuests(env);
  await recomputeXP(env, user.id);
  return json({ ok: true, mc_name: link.mc_name });
}
