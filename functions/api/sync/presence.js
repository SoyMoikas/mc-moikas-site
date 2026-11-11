import { json, err, now } from "../../../lib/util.js";
import { syncAuthorized } from "../../../lib/sync-auth.js";

// From the Discord bot on the NAS: who's playing what right now.
// Body: { playing: [{ discord_id, game, kind, since }] } — the full current list; anyone missing stopped playing.
export async function onRequestPost({ request, env }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  let p;
  try { p = JSON.parse(await request.text()); } catch { return err(400, "Invalid JSON"); }
  const t = now();
  const list = (Array.isArray(p.playing) ? p.playing : []).slice(0, 500)
    .filter((x) => /^\d{5,25}$/.test(String(x?.discord_id || "")) && typeof x.game === "string" && x.game.trim());
  const users = list.length ? (await env.DB.prepare(
    `SELECT id, discord_id FROM users WHERE role != 'pending' AND discord_id IN (${list.map(() => "?").join(",")})`
  ).bind(...list.map((x) => String(x.discord_id))).all()).results : [];
  const byDiscord = new Map(users.map((u) => [u.discord_id, u.id]));
  const stmts = [env.DB.prepare("DELETE FROM presence")];
  for (const x of list) {
    const uid = byDiscord.get(String(x.discord_id));
    if (!uid) continue; // only people with an account on the site
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO presence (user_id, game, kind, since, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(uid, x.game.trim().slice(0, 80), ["playing", "streaming", "competing"].includes(x.kind) ? x.kind : "playing",
        Number.isInteger(x.since) ? x.since : null, t));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, shown: stmts.length - 1 });
}
