import { json, err, body, now } from "../../../lib/util.js";
import { syncAuthorized } from "../../../lib/sync-auth.js";

// From the NAS script after it handled start requests: { done: [{ id, result }] }
// result: started | already_on | failed | unknown_server
export async function onRequestPost({ request, env }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now();
  const stmts = [];
  for (const d of (Array.isArray(b.done) ? b.done : []).slice(0, 50)) {
    const id = Number(d?.id);
    if (id) stmts.push(env.DB.prepare("UPDATE server_starts SET done_at = ?, result = ? WHERE id = ? AND done_at IS NULL").bind(t, String(d.result || "started").slice(0, 40), id));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true });
}
