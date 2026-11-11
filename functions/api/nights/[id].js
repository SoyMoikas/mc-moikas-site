import { need, hasRole } from "../../../lib/auth.js";
import { json, body, err } from "../../../lib/util.js";
import { loadNight, publicNight, lockNight, updateLockedMessage } from "../../../lib/nights.js";

// POST /api/nights/:id
//   {action: "vote", option_id}      toggle your vote on a game or time (while voting)
//   {action: "rsvp", status}         yes | maybe | no (once locked)
//   {action: "lock", game_id?, time_id?}  host/staff: close the vote now (default: most votes)
//   {action: "cancel"}               host/staff
export async function onRequestPost({ env, request, params }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const n = await loadNight(env, parseInt(params.id) || 0, me);
  if (!n) return err(404, "Not found");
  const boss = n.user_id === me.id || hasRole(me, "staff");

  if (b.action === "vote") {
    if (n.status !== "voting") return err(409, "Voting is closed");
    const o = n.options.find((x) => x.id === b.option_id);
    if (!o) return err(404, "Option not found");
    if (o.mine) await env.DB.prepare("DELETE FROM game_night_votes WHERE option_id = ? AND user_id = ?").bind(o.id, me.id).run();
    else await env.DB.prepare("INSERT OR IGNORE INTO game_night_votes (option_id, night_id, user_id) VALUES (?, ?, ?)").bind(o.id, n.id, me.id).run();
  } else if (b.action === "rsvp") {
    if (n.status !== "locked") return err(409, "This night isn't set yet");
    if (!["yes", "maybe", "no"].includes(b.status)) return err(400, "Bad status");
    await env.DB.prepare(
      `INSERT INTO game_night_rsvp (night_id, user_id, status) VALUES (?, ?, ?)
       ON CONFLICT(night_id, user_id) DO UPDATE SET status = excluded.status`).bind(n.id, me.id, b.status).run();
    await updateLockedMessage(env, await loadNight(env, n.id));
  } else if (b.action === "lock") {
    if (!boss) return err(403, "Only the host can close the vote");
    if (n.status !== "voting") return err(409, "Already decided");
    await lockNight(env, n, b.game_id, b.time_id);
  } else if (b.action === "cancel") {
    if (!boss) return err(403, "Only the host can cancel");
    await env.DB.prepare("UPDATE game_nights SET status = 'cancelled' WHERE id = ?").bind(n.id).run();
    const fresh = await loadNight(env, n.id);
    if (fresh.discord_msg_id) await updateLockedMessage(env, { ...fresh, status: "cancelled", game: fresh.game || "—", starts_at: fresh.starts_at || fresh.vote_until });
  } else return err(400, "Bad action");

  return json({ night: publicNight(await loadNight(env, n.id, me), me) });
}
