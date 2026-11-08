import { json, err, now } from "../../lib/util.js";
import { syncAuthorized } from "../../lib/sync-auth.js";

// Called by sync/ptero-sync.py on the NAS. Authenticated with the SYNC_SECRET bearer token.
export async function onRequestPost({ request, env }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");

  const text = await request.text();
  if (text.length > 512 * 1024) return err(413, "Payload too large");
  let payload;
  try { payload = JSON.parse(text); } catch { return err(400, "Invalid JSON"); }
  if (!Array.isArray(payload?.servers)) return err(400, "Expected { servers: [...] }");

  const t = now();
  const s = (v, max) => (v === null || v === undefined ? null : String(v).slice(0, max));
  const n = (v) => (Number.isInteger(v) ? v : null);

  const rows = payload.servers.slice(0, 100).filter((x) => x && typeof x.uuid === "string" && x.uuid.length <= 64).map((x) => {
    const vars = {};
    if (x.variables && typeof x.variables === "object") {
      for (const [k, v] of Object.entries(x.variables).slice(0, 40)) {
        if (/^[A-Z0-9_]{1,64}$/.test(k)) vars[k] = s(v, 120);
      }
    }
    return {
      uuid: x.uuid,
      data: JSON.stringify({
        identifier: s(x.identifier, 16),
        name: s(x.name, 120),
        description: s(x.description, 2000),
        egg: s(x.egg, 120),
        ip: s(x.ip, 64),
        port: n(x.port),
        state: ["running", "offline", "starting", "stopping"].includes(x.state) ? x.state : "unknown",
        players_online: n(x.players_online),
        players_max: n(x.players_max),
        variables: vars,
      }),
    };
  });

  const stmts = rows.map((r) =>
    env.DB.prepare(
      `INSERT INTO ptero_servers (uuid, data, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET data = excluded.data, synced_at = excluded.synced_at`
    ).bind(r.uuid, r.data, t)
  );
  // Forget servers that no longer exist in Pterodactyl (linked pages keep their manual info).
  if (rows.length) {
    stmts.push(env.DB.prepare(
      `DELETE FROM ptero_servers WHERE uuid NOT IN (${rows.map(() => "?").join(",")})`
    ).bind(...rows.map((r) => r.uuid)));
  } else {
    stmts.push(env.DB.prepare("DELETE FROM ptero_servers"));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, received: rows.length });
}
