import { need, hasRole } from "../../../lib/auth.js";
import { json, body, str, int, now, err } from "../../../lib/util.js";
import { spend } from "../../../lib/coins.js";
import { drawDueRaffles, drawRaffle, refundRaffle } from "../../../lib/casino.js";

const IMG = /^(https:\/\/[^\s"'<>()]+|\/[\w\-./]+\.(png|webp|gif|jpe?g|svg))$/i;

// GET → open raffles + the last month's results
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  await drawDueRaffles(env);
  const { results } = await env.DB.prepare(
    `SELECT r.*, w.username AS winner_name, w.avatar AS winner_avatar,
       (SELECT COALESCE(SUM(n), 0) FROM raffle_tickets WHERE raffle_id = r.id) AS tickets,
       (SELECT COUNT(*) FROM raffle_tickets WHERE raffle_id = r.id) AS people,
       (SELECT n FROM raffle_tickets WHERE raffle_id = r.id AND user_id = ?) AS mine
     FROM raffles r LEFT JOIN users w ON w.id = r.winner_id
     WHERE r.status = 'open' OR r.draws_at > ? ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.draws_at DESC LIMIT 30`).bind(me.id, now() - 30 * 86400000).all();
  return json({ staff: hasRole(me, "staff"), me: me.id, raffles: results.map((r) => ({ ...r, mine: r.mine || 0 })) });
}

// POST {action: buy {id, n}} · staff: create {title, prize, image?, ticket_price, max_per_user, draws_at} · cancel {id} · draw {id} · delivered {id}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const staff = hasRole(me, "staff");
  const t = now();
  if (b.action === "create") {
    if (!staff) return err(403, "Staff only");
    const title = str(b.title, 80, "title"), prize = str(b.prize, 200, "prize"), image = str(b.image, 400, "image");
    const price = int(b.ticket_price, "ticket_price"), max = int(b.max_per_user, "max_per_user"), at = int(b.draws_at, "draws_at", { min: 0, max: 1e14 });
    if (!title || !prize) return err(400, "Add a title and the prize");
    if (image && !IMG.test(image)) return err(400, "Image must be an https:// link");
    if (!price || price < 1 || price > 10000) return err(400, "Ticket price: 1–10,000 coins");
    if (!max || max < 1 || max > 100) return err(400, "Max tickets per person: 1–100");
    if (!at || at < t + 60000) return err(400, "Pick a draw time in the future");
    const r = await env.DB.prepare("INSERT INTO raffles (title, prize, image, ticket_price, max_per_user, draws_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(title, prize, image || null, price, max, at, me.id, t).run();
    return json({ id: r.meta.last_row_id });
  }
  const r = await env.DB.prepare("SELECT * FROM raffles WHERE id = ?").bind(int(b.id, "id") || 0).first();
  if (!r) return err(404, "Raffle not found");
  if (b.action === "buy") {
    const n = int(b.n, "n");
    if (r.status !== "open" || r.draws_at <= t) return err(409, "This raffle is closed");
    if (!n || n < 1) return err(400, "How many tickets?");
    const have = (await env.DB.prepare("SELECT n FROM raffle_tickets WHERE raffle_id = ? AND user_id = ?").bind(r.id, me.id).first())?.n || 0;
    if (have + n > r.max_per_user) return err(400, `Max ${r.max_per_user} tickets per person (you have ${have})`);
    const cost = n * r.ticket_price;
    if (!(await spend(env, me.id, cost))) return err(402, "Not enough coins");
    await env.DB.prepare(`INSERT INTO raffle_tickets (raffle_id, user_id, n, coins, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(raffle_id, user_id) DO UPDATE SET n = n + excluded.n, coins = coins + excluded.coins, updated_at = excluded.updated_at`).bind(r.id, me.id, n, cost, t).run();
    return json({ ok: true, mine: have + n });
  }
  if (!staff) return err(403, "Staff only");
  if (b.action === "cancel") {
    if (r.status !== "open") return err(409, "Already drawn");
    const c = await env.DB.prepare("UPDATE raffles SET status = 'cancelled' WHERE id = ? AND status = 'open'").bind(r.id).run();
    if (c.meta.changes) await refundRaffle(env, r.id);
    return json({ ok: true });
  }
  if (b.action === "draw") {
    if (r.status !== "open") return err(409, "Already drawn");
    const w = await drawRaffle(env, r);
    return json({ ok: true, winner: w?.username || null });
  }
  if (b.action === "delivered") {
    await env.DB.prepare("UPDATE raffles SET delivered = 1 - delivered WHERE id = ?").bind(r.id).run();
    return json({ ok: true });
  }
  return err(400, "Bad action");
}
