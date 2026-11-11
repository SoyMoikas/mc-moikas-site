import { need, hasRole } from "../../../lib/auth.js";
import { json, body, err } from "../../../lib/util.js";
import { loadMarket, placeBet, settle, MIN_BET, MAX_BET } from "../../../lib/markets.js";

// POST /api/markets/:id {action: "bet", option_id, coins} | staff: {action: "settle", option_id} | {action: "void"} | {action: "close"}
export async function onRequestPost({ env, request, params }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const m = await loadMarket(env, parseInt(params.id) || 0, me);
  if (!m) return err(404, "Not found");
  if (b.action === "bet") {
    const r = await placeBet(env, m, me.id, b.option_id, b.coins);
    const msg = { closed: "Betting is closed", already: "You already bet on this", bad_option: "Pick an option",
      bad_amount: `Bet between ${MIN_BET} and ${MAX_BET} coins`, no_coins: "Not enough coins" }[r];
    if (msg) return err(r === "no_coins" ? 402 : 409, msg);
  } else {
    if (!hasRole(me, "staff") && m.created_by !== me.id) return err(403, "Staff only");
    if (m.kind !== "custom" && b.action !== "void") return err(409, "This one settles by itself");
    if (b.action === "close") await env.DB.prepare("UPDATE markets SET status = 'closed' WHERE id = ? AND status = 'open'").bind(m.id).run();
    else if (b.action === "settle") { if (!m.options.some((o) => o.id === b.option_id)) return err(400, "Pick the winner"); await settle(env, m, b.option_id); }
    else if (b.action === "void") await settle(env, m, null);
    else return err(400, "Bad action");
  }
  return json({ market: await loadMarket(env, m.id, me) });
}
