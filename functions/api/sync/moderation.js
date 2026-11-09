import { json, err, body, now } from "../../../lib/util.js";
import { syncAuthorized } from "../../../lib/sync-auth.js";

// From the NAS script after each run:
// { done: [{ id, result }], lists: { <ptero_uuid>: { whitelist: [...], bans: [...], whitelist_on: bool } } }
const slim = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []).map((e) => ({
  name: String(e?.name || "").slice(0, 20),
  reason: e?.reason ? String(e.reason).slice(0, 120) : undefined,
  source: e?.source ? String(e.source).slice(0, 40) : undefined,
})).filter((e) => e.name);

export async function onRequestPost({ request, env }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  const b = await body(request, 1024 * 1024);
  if (b instanceof Response) return b;
  const t = now();
  const stmts = [];
  for (const d of (Array.isArray(b.done) ? b.done : []).slice(0, 100)) {
    const id = Number(d?.id);
    if (id) stmts.push(env.DB.prepare("UPDATE mc_moderation SET done_at = ?, result = ? WHERE id = ? AND done_at IS NULL").bind(t, String(d.result || "sent").slice(0, 60), id));
  }
  for (const [pu, l] of Object.entries(b.lists || {})) {
    if (!/^[\w-]{4,64}$/.test(pu) || !l || typeof l !== "object") continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO mc_player_lists (ptero_uuid, whitelist, bans, whitelist_on, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(ptero_uuid) DO UPDATE SET whitelist = excluded.whitelist, bans = excluded.bans, whitelist_on = excluded.whitelist_on, updated_at = excluded.updated_at`
    ).bind(pu, JSON.stringify(slim(l.whitelist, 1000)), JSON.stringify(slim(l.bans, 1000)), l.whitelist_on == null ? null : (l.whitelist_on ? 1 : 0), t));
  }
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return json({ ok: true });
}
