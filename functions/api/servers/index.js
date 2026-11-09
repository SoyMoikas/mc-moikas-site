import { json, err, body, now, slugify, str } from "../../../lib/util.js";
import { getUser, hasPerm, needPerm } from "../../../lib/auth.js";
import { mergeServer, SERVER_SELECT, splitRow } from "../../../lib/servers.js";
import { serverFields } from "../../../lib/fields.js";

// Public list of server cards (admins also see hidden drafts).
export async function onRequestGet({ request, env }) {
  const user = await getUser(env, request);
  const admin = hasPerm(user, "servers");
  const game = new URL(request.url).searchParams.get("game");
  const where = [admin ? null : "s.hidden = 0", game ? "s.game_id = ?" : null].filter(Boolean);
  const stmt = env.DB.prepare(
    `${SERVER_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.sort_order, s.name, s.id`
  );
  const { results } = await (game ? stmt.bind(game) : stmt).all();
  const servers = results.map((r) => mergeServer(...splitRow(r), env, { admin }));

  // Open-task counts for the cards.
  const counts = await env.DB.prepare(
    "SELECT server_id, SUM(status = 'done') AS done, COUNT(*) AS total FROM tasks GROUP BY server_id"
  ).all();
  const byId = Object.fromEntries(counts.results.map((c) => [c.server_id, c]));
  for (const s of servers) {
    s.tasks_done = byId[s.id]?.done ?? 0;
    s.tasks_total = byId[s.id]?.total ?? 0;
  }
  return json({ servers });
}

// Admin: create a server page (optionally linked to a Pterodactyl server).
export async function onRequestPost({ request, env }) {
  const user = await needPerm(env, request, "servers");
  if (user instanceof Response) return user;
  const b = await body(request, 300 * 1024); // room for the markdown guides
  if (b instanceof Response) return b;

  const fields = serverFields(b);
  if (fields.game_id && !(await env.DB.prepare("SELECT 1 FROM games WHERE id = ?").bind(fields.game_id).first())) return err(404, "Game not found");
  let base = slugify(str(b.id, 40, "id") || fields.name || "server");
  let id = base;
  for (let i = 2; await env.DB.prepare("SELECT 1 FROM servers WHERE id = ?").bind(id).first(); i++) id = `${base}-${i}`;

  if (fields.ptero_uuid) {
    const taken = await env.DB.prepare("SELECT id FROM servers WHERE ptero_uuid = ?").bind(fields.ptero_uuid).first();
    if (taken) return err(409, `That Pterodactyl server is already linked to "${taken.id}"`);
  }

  const t = now();
  const row = { hidden: 1, sort_order: 0, ...fields, id, created_at: t, updated_at: t };
  const keys = Object.keys(row);
  await env.DB.prepare(
    `INSERT INTO servers (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`
  ).bind(...keys.map((k) => row[k])).run();
  return json({ id }, 201);
}
