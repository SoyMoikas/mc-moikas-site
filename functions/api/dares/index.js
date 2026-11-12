import { getUser, need, hasRole } from "../../../lib/auth.js";
import { json, body, str, now, err } from "../../../lib/util.js";
import { DARES, LEVELS, DARE_HOURS, loadPool } from "../../../lib/dares.js";
import { discord } from "../../../lib/lfg.js";

const pick = (pool, game) => { const l = pool[game] || pool["Cualquier juego"]; const d = l[Math.floor(Math.random() * l.length)]; return [d.level, d.text]; };

// GET /api/dares → games + challenges, your active one, ones waiting for a friend to confirm, recent
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ games: [] });
  const t = now();
  await env.DB.prepare("UPDATE dares SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at <= ?").bind(t, t).run();
  const q = (where, ...b) => env.DB.prepare(
    `SELECT d.*, u.username, u.avatar, c.username AS confirmer FROM dares d LEFT JOIN users u ON u.id = d.user_id LEFT JOIN users c ON c.id = d.confirmed_by WHERE ${where}`).bind(...b).all().then((r) => r.results);
  const pool = await loadPool(env);
  return json({
    games: Object.keys(pool), levels: LEVELS, all: pool, staff: hasRole(me, "staff"), me: me.id,
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
  const t = now();
  const staff = hasRole(me, "staff");
  // add / remove challenges: anyone adds; you remove your own, staff remove any (built-in ones get hidden)
  if (b.action === "add") {
    const game = str(b.game, 40, "game"), text = str(b.text, 200, "text"), level = [1, 2, 3].includes(+b.level) ? +b.level : 1;
    if (!game || !text || text.length < 6) return err(400, "Write the game and the challenge");
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM dare_custom WHERE created_by = ? AND created_at > ?").bind(me.id, t - 86400000).first()).n;
    if (n >= 15 && !staff) return err(429, "That's a lot for one day — try again tomorrow");
    const dup = await env.DB.prepare("SELECT 1 FROM dare_custom WHERE game = ? AND lower(text) = lower(?)").bind(game, text).first();
    if (dup) return err(409, "That one already exists");
    await env.DB.prepare("DELETE FROM dare_hidden WHERE game = ? AND text = ?").bind(game, text).run();
    if (!(DARES[game] || []).some(([, x]) => x === text))
      await env.DB.prepare("INSERT INTO dare_custom (game, level, text, created_by, created_at) VALUES (?, ?, ?, ?, ?)").bind(game, level, text, me.id, t).run();
    return json({ ok: true });
  }
  if (b.action === "remove") {
    if (b.id) {
      const c = await env.DB.prepare("SELECT created_by FROM dare_custom WHERE id = ?").bind(+b.id).first();
      if (!c) return err(404, "Not found");
      if (c.created_by !== me.id && !staff) return err(403, "Only whoever added it (or staff) can remove it");
      await env.DB.prepare("DELETE FROM dare_custom WHERE id = ?").bind(+b.id).run();
    } else {
      if (!staff) return err(403, "Only staff can remove the built-in challenges");
      const game = str(b.game, 40, "game"), text = str(b.text, 200, "text");
      if (!(DARES[game] || []).some(([, x]) => x === text)) return err(404, "Not found");
      await env.DB.prepare("INSERT OR IGNORE INTO dare_hidden (game, text, hidden_by, created_at) VALUES (?, ?, ?, ?)").bind(game, text, me.id, t).run();
    }
    return json({ ok: true });
  }
  const pool = await loadPool(env);
  const game = pool[b.game] ? b.game : "Cualquier juego";
  await env.DB.prepare("UPDATE dares SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at <= ?").bind(t, t).run();
  if (b.action === "spin") {
    const cur = await env.DB.prepare("SELECT id FROM dares WHERE user_id = ? AND status IN ('active','claimed')").bind(me.id).first();
    if (cur) return err(409, "Finish or give up your current challenge first");
    const [level, text] = pick(pool, game);
    const r = await env.DB.prepare("INSERT INTO dares (user_id, game, text, level, status, created_at, expires_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)")
      .bind(me.id, game, text, level, t, t + DARE_HOURS * 3600000, t).run();
    return json({ id: r.meta.last_row_id, game, text, level });
  }
  if (b.action === "group") {
    const recent = await env.DB.prepare("SELECT 1 FROM dares WHERE status = 'group' AND created_at > ?").bind(t - 10 * 60000).first();
    if (recent) return err(429, "Someone just spun one — wait a few minutes");
    const [level, text] = pick(pool, game);
    await env.DB.prepare("INSERT INTO dares (user_id, game, text, level, status, created_at, expires_at, updated_at) VALUES (?, ?, ?, ?, 'group', ?, ?, ?)")
      .bind(me.id, game, text, level, t, t + 6 * 3600000, t).run();
    if (env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL) await discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, {
      content: `🎡 **${me.username}** giró la ruleta para todos — **${game}** (${LEVELS[level].name}):\n> ${text}`, allowed_mentions: { parse: [] } });
    return json({ game, text, level });
  }
  return err(400, "Bad action");
}
