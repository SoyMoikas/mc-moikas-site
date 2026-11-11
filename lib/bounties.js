// Ocaso bounties: put coins on a player's head; whoever kills them (seen in the server log) collects.
import { now } from "./util.js";
import { award } from "./coins.js";
import { notify } from "./notify.js";
import { discord } from "./lfg.js";

export const MIN_BOUNTY = 20, MAX_BOUNTY = 2000, BOUNTY_DAYS = 7;
// "<victim> was slain by <killer>", "…was shot by <killer> using …", etc. Only player killers count.
const BY = /^(?:was (?:slain|shot|killed|blown up|fireballed|pummeled|skewered|impaled|squashed|struck|stung|poked|obliterated|frozen)(?: to death)?|died|burned to death|drowned|fell|hit the ground too hard|tried to swim in lava|walked into fire|went up in flames)\b.*?\b(?:by|whilst fighting|while fighting|trying to escape|escaping)\s+([.\w]{2,20})/;

export function killerOf(message) {
  const m = BY.exec(message || "");
  return m ? m[1] : null;
}

/** Called by the Ocaso sync for each new death. world = current Ocaso world state (for Blood Moon-only bounties). */
export async function checkBountyDeath(env, ptero, death, world) {
  const killerName = killerOf(death.message);
  if (!killerName || !death.mc_uuid) return;
  const open = (await env.DB.prepare(
    "SELECT * FROM bounties WHERE status = 'open' AND target_uuid = ? AND expires_at > ? ORDER BY coins DESC").bind(death.mc_uuid, now()).all()).results;
  if (!open.length) return;
  const killer = await env.DB.prepare(
    `SELECT p.uuid, p.name, u.id AS user_id FROM mc_players p LEFT JOIN users u ON u.mc_uuid = p.uuid WHERE lower(p.name) = lower(?)`
  ).bind(killerName).first() || await env.DB.prepare(
    `SELECT o.mc_uuid AS uuid, o.name, u.id AS user_id FROM ocaso_players o LEFT JOIN users u ON u.mc_uuid = o.mc_uuid WHERE lower(o.name) = lower(?) LIMIT 1`
  ).bind(killerName).first();
  if (!killer || killer.uuid === death.mc_uuid) return; // a mob with that name, or suicide
  for (const b of open) {
    if (b.blood_moon_only && !world?.lunasangre) continue;
    if (killer.user_id && killer.user_id === b.poster_id) continue; // you can't collect your own bounty
    if (!killer.user_id) continue; // the killer has no site account: the bounty stays open
    const r = await env.DB.prepare("UPDATE bounties SET status = 'claimed', claimed_by_name = ?, claimed_by_user = ?, claimed_at = ? WHERE id = ? AND status = 'open'")
      .bind(killer.name, killer.user_id, now(), b.id).run();
    if (!r.meta.changes) continue;
    await award(env, killer.user_id, "bounty", b.id, b.coins);
    await notify(env, [killer.user_id], "fun", { title: `🗡️ ¡Cobraste ${b.coins} monedas!`, body: `Mataste a ${b.target_name}.`, url: "/#ocaso" });
    await notify(env, [b.poster_id], "fun", { title: `🗡️ ${killer.name} cobró tu recompensa`, body: `${b.target_name} cayó.`, url: "/#ocaso" });
    if (env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL) await discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, {
      content: `🗡️ **${killer.name}** cobró la recompensa de 🪙 ${b.coins} por la cabeza de **${b.target_name}** en Ocaso.`, allowed_mentions: { parse: [] } });
  }
}

export async function expireBounties(env) {
  const due = (await env.DB.prepare("SELECT id, poster_id, coins, target_name FROM bounties WHERE status = 'open' AND expires_at <= ?").bind(now()).all()).results;
  for (const b of due) {
    const r = await env.DB.prepare("UPDATE bounties SET status = 'expired' WHERE id = ? AND status = 'open'").bind(b.id).run();
    if (!r.meta.changes) continue;
    await award(env, b.poster_id, "bounty_refund", b.id, b.coins);
    await notify(env, [b.poster_id], "fun", { title: `📜 Tu recompensa por ${b.target_name} expiró`, body: `Te regresamos 🪙 ${b.coins}.`, url: "/#ocaso" });
  }
}
