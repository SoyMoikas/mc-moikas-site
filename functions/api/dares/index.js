import { getUser, need } from "../../../lib/auth.js";
import { json, body, now, err } from "../../../lib/util.js";
import { DARES, LEVELS, DARE_HOURS, DAILY_DONE_CAP } from "../../../lib/dares.js";
import { discord } from "../../../lib/lfg.js";

const pick = (game) => { const l = DARES[game] || DARES["Cualquier juego"]; return l[Math.floor(Math.random() * l.length)]; };

// GET /api/dares → games + challenges, your active one, ones waiting for a friend to confirm, recent
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ games: [] });
  const t = now();
  await env.DB.prepare("UPDATE dares SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at <= ?").bind(t, t).run();
  const q = (where, ...b) => env.DB.prepare(
    `SELECT d.*, u.username, u.avatar, c.username AS confirmer FROM dares d LEFT JOIN users u ON u.id = d.user_id LEFT JOIN users c ON c.id = d.confirmed_by WHERE ${where}`).bind(...b).all().then((r) => r.results);
  return json({
    games: Object.keys(DARES), levels: LEVELS, all: DARES,
    mine: (await q("d.user_id = ? AND d.status IN ('active','claimed') ORDER BY d.id DESC LIMIT 1", me.id))[0] || null,
    pending: await q("d.status = 'claimed' AND d.user_id != ? ORDER BY d.updated_at DESC LIMIT 20", me.id),
    recent: await q("d.status IN ('done','group') ORDER BY d.updated_at DESC LIMIT 15"),
  });
}

// POST /api/dares {action: "spin", game} → your challenge (one at a time)
//                 {action: "group", game} → one challenge for everyone, posted to Discord
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const game = DARES[b.game] ? b.game : "Cualquier juego";
  const t = now();
  await env.DB.prepare("UPDATE dares SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at <= ?").bind(t, t).run();
  if (b.action === "spin") {
    const cur = await env.DB.prepare("SELECT id FROM dares WHERE user_id = ? AND status IN ('active','claimed')").bind(me.id).first();
    if (cur) return err(409, "Finish or give up your current challenge first");
    const [level, text] = pick(game);
    const r = await env.DB.prepare("INSERT INTO dares (user_id, game, text, level, status, created_at, expires_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)")
      .bind(me.id, game, text, level, t, t + DARE_HOURS * 3600000, t).run();
    return json({ id: r.meta.last_row_id, game, text, level });
  }
  if (b.action === "group") {
    const recent = await env.DB.prepare("SELECT 1 FROM dares WHERE status = 'group' AND created_at > ?").bind(t - 10 * 60000).first();
    if (recent) return err(429, "Someone just spun one — wait a few minutes");
    const [level, text] = pick(game);
    await env.DB.prepare("INSERT INTO dares (user_id, game, text, level, status, created_at, expires_at, updated_at) VALUES (?, ?, ?, ?, 'group', ?, ?, ?)")
      .bind(me.id, game, text, level, t, t + 6 * 3600000, t).run();
    if (env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL) await discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, {
      content: `🎡 **${me.username}** giró la ruleta para todos — **${game}** (${LEVELS[level].name}):\n> ${text}`, allowed_mentions: { parse: [] } });
    return json({ game, text, level });
  }
  return err(400, "Bad action");
}
