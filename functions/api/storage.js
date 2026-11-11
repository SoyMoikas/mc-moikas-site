import { getUser, need, hasRole } from "../../lib/auth.js";
import { json, body, err, now } from "../../lib/util.js";
import { overview, saveSettings, settings } from "../../lib/cleanup.js";

// GET /api/storage → disk + history + cleanup queue (members).  POST: keep (anyone), protect / unprotect / delete_now / approve_due / restore / settings (staff)
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return err(401, "Log in first");
  try { return json({ ...(await overview(env, me)), staff: hasRole(me, "staff") }); }
  catch (e) { return err(503, `Storage isn't set up yet (${e.message.slice(0, 80)})`); }
}

export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now(), id = String(b.id || "").slice(0, 64);
  const s = await settings(env);
  const item = id ? await env.DB.prepare("SELECT * FROM cleanup_items WHERE jf_id = ?").bind(id).first() : null;
  if (b.action === "keep") {
    if (!item || !["pending", "due"].includes(item.status)) return err(400, "That one isn't on the list");
    await env.DB.prepare("INSERT OR IGNORE INTO cleanup_votes (jf_id, user_id, created_at) VALUES (?, ?, ?)").bind(id, me.id, t).run();
    await env.DB.prepare("UPDATE cleanup_items SET status = 'kept', kept_until = ?, detail = ?, updated_at = ? WHERE jf_id = ?").bind(t + s.keep_days * 86400000, `kept:${me.username}`, t, id).run();
    return json({ ok: true, kept_days: s.keep_days });
  }
  if (!hasRole(me, "staff")) return err(403, "Staff only");
  switch (b.action) {
    case "protect": case "unprotect":
      if (!item) return err(404, "Not found");
      await env.DB.prepare("UPDATE cleanup_items SET protected = ?, status = CASE WHEN ? = 1 THEN 'kept' ELSE status END, updated_at = ? WHERE jf_id = ?")
        .bind(b.action === "protect" ? 1 : 0, b.action === "protect" ? 1 : 0, t, id).run();
      return json({ ok: true });
    case "delete_now":
      if (!item || !["pending", "due", "failed", "kept"].includes(item.status) || item.protected) return err(400, "Can't delete that one");
      await env.DB.prepare("UPDATE cleanup_items SET status = 'approved', detail = ?, updated_at = ? WHERE jf_id = ?").bind(`by:${me.username}`, t, id).run();
      return json({ ok: true });
    case "approve_due": {
      const r = await env.DB.prepare("UPDATE cleanup_items SET status = 'approved', detail = ?, updated_at = ? WHERE status = 'due'").bind(`by:${me.username}`, t).run();
      return json({ ok: true, n: r.meta.changes });
    }
    case "restore": // undo an approval before the bot acts, or retry a failed one later
      if (!item) return err(404, "Not found");
      await env.DB.prepare("UPDATE cleanup_items SET status = 'kept', kept_until = ?, updated_at = ? WHERE jf_id = ? AND status IN ('approved', 'failed', 'due', 'pending')").bind(t + s.keep_days * 86400000, t, id).run();
      return json({ ok: true });
    case "settings":
      return json({ settings: await saveSettings(env, b) });
  }
  return err(400, "Unknown action");
}
