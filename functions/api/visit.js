import { getUser } from "../../lib/auth.js";
import { json, body, now, sha256 } from "../../lib/util.js";

const KEEP_DAYS = 120;     // older rows are pruned now and then
const DEDUPE_MIN = 10;     // same visitor + same page within this window counts once

// POST /api/visit {path, ref} — every page calls this once on load (see initPage in common.js).
export async function onRequestPost({ env, request }) {
  const b = await body(request, 2048).catch(() => ({}));
  let path = typeof b.path === "string" ? b.path.slice(0, 120) : "/";
  if (!path.startsWith("/")) path = "/";
  let ref = null;
  try {
    if (b.ref) {
      const r = new URL(b.ref);
      if (r.host !== new URL(request.url).host) ref = r.host.slice(0, 80);
    }
  } catch {}

  const ua = request.headers.get("user-agent") || "";
  if (/bot|crawl|spider|preview|headless|monitor|curl|python|wget/i.test(ua)) return json({ ok: true });
  const device = /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "pc";
  const country = request.cf?.country || null;

  const user = await getUser(env, request).catch(() => null);
  let visitor;
  if (user) visitor = `u:${user.id}`;
  else {
    // Anonymous: a daily-rotating hash — counts unique visitors without storing IPs.
    const ip = request.headers.get("cf-connecting-ip") || "";
    const day = new Date().toISOString().slice(0, 10);
    visitor = "a:" + (await sha256(`${ip}|${ua}|${day}`)).slice(0, 16);
  }

  const t = now();
  const dup = await env.DB.prepare(
    "SELECT 1 FROM page_views WHERE visitor = ? AND path = ? AND created_at > ? LIMIT 1"
  ).bind(visitor, path, t - DEDUPE_MIN * 60000).first();
  if (!dup) {
    await env.DB.prepare(
      "INSERT INTO page_views (visitor, user_id, path, ref, country, device, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(visitor, user ? user.id : null, path, ref, country, device, t).run();
  }
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM page_views WHERE created_at < ?").bind(t - KEEP_DAYS * 86400000).run();
  }
  return json({ ok: true });
}
