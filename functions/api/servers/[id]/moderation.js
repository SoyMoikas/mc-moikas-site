import { json, err, body, now } from "../../../../lib/util.js";
import { needPerm } from "../../../../lib/auth.js";
import { MOD_ACTIONS, NAMELESS, JAVA_NAME, BEDROCK_NAME, cleanReason, listEntry } from "../../../../lib/moderation.js";

// Whitelist & bans for one server (staff with the "moderation" permission).
// Actions are queued here; the NAS sync script runs them in the server console within ~2 minutes.
async function serverOf(env, id) {
  return env.DB.prepare("SELECT id, name, ptero_uuid FROM servers WHERE id = ?").bind(id).first();
}

export async function onRequestGet({ request, env, params }) {
  const user = await needPerm(env, request, "moderation");
  if (user instanceof Response) return user;
  const s = await serverOf(env, params.id);
  if (!s) return err(404, "Server not found");
  if (!s.ptero_uuid) return json({ linked: false });
  const [lists, queue] = await env.DB.batch([
    env.DB.prepare("SELECT whitelist, bans, whitelist_on, updated_at FROM mc_player_lists WHERE ptero_uuid = ?").bind(s.ptero_uuid),
    env.DB.prepare(
      `SELECT m.id, m.action, m.name, m.edition, m.reason, m.created_at, m.done_at, u.username AS by_name
         FROM mc_moderation m LEFT JOIN users u ON u.id = m.created_by
        WHERE m.ptero_uuid = ? AND (m.done_at IS NULL OR m.done_at > ?)
        ORDER BY m.id DESC LIMIT 40`
    ).bind(s.ptero_uuid, now() - 3 * 24 * 3600 * 1000),
  ]);
  const l = lists.results[0];
  const parse = (v) => { try { return (JSON.parse(v || "[]") || []).map(listEntry); } catch { return []; } };
  return json({
    linked: true,
    whitelist_on: l ? l.whitelist_on === 1 : null,
    whitelist: l ? parse(l.whitelist) : [],
    bans: l ? parse(l.bans) : [],
    synced_at: l?.updated_at || null,
    pending: queue.results.filter((x) => !x.done_at),
    recent: queue.results.filter((x) => x.done_at).slice(0, 15),
  });
}

export async function onRequestPost({ request, env, params }) {
  const user = await needPerm(env, request, "moderation");
  if (user instanceof Response) return user;
  const s = await serverOf(env, params.id);
  if (!s?.ptero_uuid) return err(404, "Server not linked to Pterodactyl");
  const b = await body(request);
  if (b instanceof Response) return b;
  const action = String(b.action || "");
  if (!MOD_ACTIONS.includes(action)) return err(400, "Unknown action");
  const edition = b.edition === "bedrock" ? "bedrock" : "java";
  let name = "";
  if (!NAMELESS.includes(action)) {
    name = String(b.name || "").trim().replace(/^\./, "");
    if (!(edition === "bedrock" ? BEDROCK_NAME : JAVA_NAME).test(name))
      return err(400, edition === "bedrock" ? "Bedrock gamertag: letters, numbers and spaces (max 16)" : "Java name: 3-16 letters, numbers or _");
  }
  const reason = action === "ban" ? cleanReason(b.reason) : null;
  const dup = await env.DB.prepare(
    "SELECT id FROM mc_moderation WHERE ptero_uuid = ? AND action = ? AND lower(name) = lower(?) AND edition = ? AND done_at IS NULL"
  ).bind(s.ptero_uuid, action, name, edition).first();
  if (dup) return json({ ok: true, id: dup.id, duplicate: true });
  const r = await env.DB.prepare(
    "INSERT INTO mc_moderation (ptero_uuid, action, name, edition, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(s.ptero_uuid, action, name, edition, reason, user.id, now()).run();
  return json({ ok: true, id: r.meta?.last_row_id });
}

// Cancel an action that hasn't run yet: DELETE ?action=<id>
export async function onRequestDelete({ request, env, params }) {
  const user = await needPerm(env, request, "moderation");
  if (user instanceof Response) return user;
  const s = await serverOf(env, params.id);
  if (!s?.ptero_uuid) return err(404, "Server not found");
  const qid = Number(new URL(request.url).searchParams.get("action"));
  if (!qid) return err(400, "Missing action id");
  await env.DB.prepare("DELETE FROM mc_moderation WHERE id = ? AND ptero_uuid = ? AND done_at IS NULL").bind(qid, s.ptero_uuid).run();
  return json({ ok: true });
}
