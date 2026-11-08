import { json, err, body, now, str } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";
import { recomputeXP } from "../../../lib/xp.js";

const CODE_TTL_MS = 15 * 60 * 1000;

// Current link state for the logged-in user.
export async function onRequestGet({ request, env }) {
  const user = await need(env, request, "pending");
  if (user instanceof Response) return user;
  const pending = await env.DB.prepare("SELECT mc_name, created_at FROM mc_links WHERE user_id = ? AND created_at > ?")
    .bind(user.id, now() - CODE_TTL_MS).first();
  return json({ mc_name: user.mc_name || null, pending: pending || null });
}

// Start linking: { mc_name }. The NAS script will /tell that player a 6-digit code.
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "pending");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const name = str(b.mc_name, 16, "mc_name");
  if (!name || !/^[A-Za-z0-9_]{3,16}$/.test(name)) return err(400, "Invalid Minecraft name");

  const player = await env.DB.prepare("SELECT uuid, name FROM mc_players WHERE name = ? COLLATE NOCASE ORDER BY updated_at DESC LIMIT 1")
    .bind(name).first();
  if (!player) return err(404, "Player not seen yet");
  const taken = await env.DB.prepare("SELECT id FROM users WHERE mc_uuid = ? AND id != ?").bind(player.uuid, user.id).first();
  if (taken) return err(409, "Already linked to someone else");

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await env.DB.prepare(
    `INSERT INTO mc_links (user_id, mc_uuid, mc_name, code, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET mc_uuid = excluded.mc_uuid, mc_name = excluded.mc_name, code = excluded.code,
       attempts = 0, created_at = excluded.created_at`
  ).bind(user.id, player.uuid, player.name, code, now()).run();
  return json({ ok: true, mc_name: player.name });
}

// Unlink your own Minecraft account.
export async function onRequestDelete({ request, env }) {
  const user = await need(env, request, "pending");
  if (user instanceof Response) return user;
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET mc_uuid = NULL, mc_name = NULL WHERE id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM mc_links WHERE user_id = ?").bind(user.id),
  ]);
  await recomputeXP(env, user.id);
  return json({ ok: true });
}
