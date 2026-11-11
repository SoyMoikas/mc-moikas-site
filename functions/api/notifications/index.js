import { need } from "../../../lib/auth.js";
import { json, body, now, err } from "../../../lib/util.js";
import { KINDS, prefsFor } from "../../../lib/notify.js";

// GET /api/notifications → { unread, items: [...latest 30], prefs }
//     ?count=1 → just { unread } (polled by every page)
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return json({ unread: 0, items: [] });
  const unread = (await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(me.id).first()).n;
  if (new URL(request.url).searchParams.get("count")) return json({ unread });
  const items = (await env.DB.prepare("SELECT id, kind, title, body, url, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30")
    .bind(me.id).all()).results;
  const prefs = (await prefsFor(env, [me.id])).get(me.id);
  return json({ unread, items, prefs, kinds: Object.keys(KINDS) });
}

// POST /api/notifications {action: "read", id?} (no id = mark everything read) | {action: "prefs", prefs: {kind: {site, dm}}}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  if (b.action === "read") {
    if (Number.isInteger(b.id)) await env.DB.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?").bind(now(), b.id, me.id).run();
    else await env.DB.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now(), me.id).run();
    return json({ ok: true });
  }
  if (b.action === "prefs") {
    const clean = {};
    for (const k of Object.keys(KINDS)) {
      const p = b.prefs?.[k];
      if (p) clean[k] = { site: !!p.site, dm: !!p.dm };
    }
    await env.DB.prepare("INSERT OR REPLACE INTO notif_prefs (user_id, data) VALUES (?, ?)").bind(me.id, JSON.stringify(clean)).run();
    return json({ ok: true });
  }
  return err(400, "Bad action");
}
