import { need, hasRole } from "../../../lib/auth.js";
import { json, err } from "../../../lib/util.js";
import { award } from "../../../lib/coins.js";

// POST /api/bounties/:id → cancel your open bounty (coins back). Staff can cancel any.
export async function onRequestPost({ env, request, params }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await env.DB.prepare("SELECT * FROM bounties WHERE id = ?").bind(params.id).first();
  if (!b || b.status !== "open") return err(404, "No open bounty");
  if (b.poster_id !== me.id && !hasRole(me, "staff")) return err(403, "Not yours");
  const r = await env.DB.prepare("UPDATE bounties SET status = 'cancelled' WHERE id = ? AND status = 'open'").bind(b.id).run();
  if (r.meta.changes) await award(env, b.poster_id, "bounty_refund", b.id, b.coins);
  return json({ ok: true });
}
