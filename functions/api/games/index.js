import { json, err, body, now } from "../../../lib/util.js";
import { getUser, hasPerm, needPerm } from "../../../lib/auth.js";
import { gameFields, listGames } from "../../../lib/games.js";

export async function onRequestGet({ request, env }) {
  const user = await getUser(env, request);
  return json({ games: await listGames(env, { includeInactive: hasPerm(user, "servers") }) });
}

// Admins / sub-admins with "servers": add a game section.
export async function onRequestPost({ request, env }) {
  const user = await needPerm(env, request, "servers");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = gameFields(b, { creating: true });
  if (await env.DB.prepare("SELECT 1 FROM games WHERE id = ?").bind(f.id).first()) return err(409, "A game with that id already exists");
  const t = now();
  const row = { ...f, created_at: t, updated_at: t };
  const keys = Object.keys(row);
  await env.DB.prepare(`INSERT INTO games (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).bind(...keys.map((k) => row[k])).run();
  return json({ id: f.id }, 201);
}
