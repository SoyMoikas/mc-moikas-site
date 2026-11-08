import { json } from "../../lib/util.js";
import { needPerm } from "../../lib/auth.js";
import { pteroInfo } from "../../lib/servers.js";

// Admin: everything the NAS sync has reported, and which page each is linked to.
export async function onRequestGet({ request, env }) {
  const user = await needPerm(env, request, "servers");
  if (user instanceof Response) return user;
  const { results } = await env.DB.prepare(
    `SELECT p.uuid, p.data, p.synced_at, s.id AS linked_to
       FROM ptero_servers p LEFT JOIN servers s ON s.ptero_uuid = p.uuid
      ORDER BY p.synced_at DESC`
  ).all();
  const servers = results.map((r) => {
    const data = JSON.parse(r.data);
    return { uuid: r.uuid, synced_at: r.synced_at, linked_to: r.linked_to, data, auto: pteroInfo(data) };
  });
  const last = servers.reduce((m, s) => Math.max(m, s.synced_at), 0) || null;
  return json({ servers, last_sync: last });
}
