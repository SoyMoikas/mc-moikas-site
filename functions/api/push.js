import { need } from "../../lib/auth.js";
import { json, body, err, now } from "../../lib/util.js";
import { sendPush, validEndpoint, pushConfigured } from "../../lib/push.js";

// Phone notifications. GET → {configured, key, devices}   POST {action: subscribe|unsubscribe|test, endpoint, label}
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  let devices = 0;
  try { devices = (await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?").bind(me.id).first()).n; } catch { /* before migration 034 */ }
  return json({ configured: pushConfigured(env), key: env.VAPID_PUBLIC_KEY || null, devices });
}

export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  if (!pushConfigured(env)) return err(503, "Phone notifications aren't set up on the site yet");
  if (b.action === "subscribe") {
    if (!validEndpoint(b.endpoint)) return err(400, "That browser's push service isn't supported");
    const label = b.label ? String(b.label).slice(0, 60) : null;
    await env.DB.prepare(`INSERT INTO push_subs (user_id, endpoint, label, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, label = excluded.label`).bind(me.id, b.endpoint, label, now()).run();
    return json({ ok: true });
  }
  if (b.action === "unsubscribe") {
    await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").bind(String(b.endpoint || ""), me.id).run();
    return json({ ok: true });
  }
  if (b.action === "test") {
    await env.DB.prepare("INSERT INTO notifications (user_id, kind, title, body, url, created_at) VALUES (?, 'announce', ?, ?, '/profile#ajustes', ?)")
      .bind(me.id, "🔔 ¡Funciona!", "Así te van a llegar los avisos de Moikas.", now()).run();
    return json({ sent: await sendPush(env, [me.id]) });
  }
  return err(400, "Unknown action");
}
