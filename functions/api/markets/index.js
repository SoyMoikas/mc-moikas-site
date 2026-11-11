import { getUser, need, hasRole } from "../../../lib/auth.js";
import { json, body, str, err } from "../../../lib/util.js";
import { loadMarket, ensureMarket, closeDue } from "../../../lib/markets.js";

// GET /api/markets → open + recently settled predictions
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ markets: [] });
  await closeDue(env);
  const ids = (await env.DB.prepare(
    `SELECT id FROM markets WHERE status IN ('open','closed') OR created_at > ? ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'closed' THEN 1 ELSE 2 END, id DESC LIMIT 30`
  ).bind(Date.now() - 14 * 86400000).all()).results;
  const markets = [];
  for (const { id } of ids) markets.push(await loadMarket(env, id, me));
  return json({ markets });
}

// POST /api/markets (staff) {title, options: ["A","B"], closes_at?}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "staff");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const title = str(b.title, 120, "title");
  const options = [...new Set((b.options || []).map((o) => String(o).trim()).filter(Boolean))].slice(0, 8);
  if (!title || options.length < 2) return err(400, "A question and at least 2 options");
  const id = await ensureMarket(env, { kind: "custom", ref: `c${Date.now()}`, title, options: options.map((label) => ({ label })),
    closes_at: Number.isInteger(b.closes_at) ? b.closes_at : null, created_by: me.id });
  void hasRole;
  return json({ id });
}
