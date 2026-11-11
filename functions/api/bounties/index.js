import { getUser, need } from "../../../lib/auth.js";
import { json, body, str, int, now, err } from "../../../lib/util.js";
import { spend } from "../../../lib/coins.js";
import { notify } from "../../../lib/notify.js";
import { MIN_BOUNTY, MAX_BOUNTY, BOUNTY_DAYS } from "../../../lib/bounties.js";
import { discord } from "../../../lib/lfg.js";

// GET /api/bounties → open bounties + the last few collected, and who you can target
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ open: [], done: [], targets: [] });
  const list = async (where) => (await env.DB.prepare(
    `SELECT b.id, b.target_name, b.target_uuid, b.coins, b.blood_moon_only, b.note, b.status, b.claimed_by_name, b.claimed_at, b.created_at, b.expires_at,
            u.username AS poster, b.poster_id = ? AS mine FROM bounties b JOIN users u ON u.id = b.poster_id WHERE ${where}`).bind(me.id).all()).results;
  const open = await list("b.status = 'open' ORDER BY b.coins DESC");
  const done = await list("b.status = 'claimed' ORDER BY b.claimed_at DESC LIMIT 10");
  const targets = (await env.DB.prepare("SELECT DISTINCT mc_uuid AS uuid, name FROM ocaso_players WHERE name IS NOT NULL ORDER BY name COLLATE NOCASE").all()).results;
  return json({ open, done, targets, min: MIN_BOUNTY, max: MAX_BOUNTY, days: BOUNTY_DAYS });
}

// POST /api/bounties {target_uuid, coins, blood_moon_only, note}
export async function onRequestPost({ env, request, waitUntil }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const target = await env.DB.prepare("SELECT mc_uuid, name FROM ocaso_players WHERE mc_uuid = ? LIMIT 1").bind(String(b.target_uuid || "")).first();
  if (!target) return err(404, "Pick an Ocaso player");
  const mine = await env.DB.prepare("SELECT mc_uuid FROM users WHERE id = ?").bind(me.id).first();
  if (mine?.mc_uuid === target.mc_uuid) return err(400, "You can't put a bounty on yourself 😅");
  const coins = int(b.coins, "coins", { min: MIN_BOUNTY, max: MAX_BOUNTY });
  if (!(await spend(env, me.id, coins))) return err(402, "Not enough coins");
  const t = now();
  const r = await env.DB.prepare(
    "INSERT INTO bounties (target_uuid, target_name, poster_id, coins, blood_moon_only, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(target.mc_uuid, target.name, me.id, coins, b.blood_moon_only ? 1 : 0, b.note ? str(b.note, 140, "note") : null, t, t + BOUNTY_DAYS * 86400000).run();
  waitUntil((async () => {
    const victim = await env.DB.prepare("SELECT id FROM users WHERE mc_uuid = ?").bind(target.mc_uuid).first();
    if (victim) await notify(env, [victim.id], "fun", { title: `📜 Hay precio por tu cabeza: 🪙 ${coins}`, body: `Ten cuidado en Ocaso${b.blood_moon_only ? " durante la Luna de Sangre" : ""}…`, url: "/#ocaso" });
    if (env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL) await discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, {
      content: `📜 **SE BUSCA:** ${target.name} — 🪙 ${coins} para quien lo mate en Ocaso${b.blood_moon_only ? " durante la Luna de Sangre" : ""}.${b.note ? `\n> ${b.note}` : ""}`,
      allowed_mentions: { parse: [] } });
  })());
  return json({ id: r.meta.last_row_id });
}
