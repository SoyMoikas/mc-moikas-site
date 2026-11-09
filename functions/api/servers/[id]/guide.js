import { json, err } from "../../../../lib/util.js";
import { getUser, hasPerm } from "../../../../lib/auth.js";

// The server's player guide (markdown, English + Spanish). Lists don't carry it, to stay light.
export async function onRequestGet({ request, env, params }) {
  const user = await getUser(env, request);
  const r = await env.DB.prepare("SELECT id, name, hidden, guide, guide_es, game_id FROM servers WHERE id = ?").bind(params.id).first();
  if (!r || (r.hidden && !hasPerm(user, "servers"))) return err(404, "Server not found");
  return json({ id: r.id, name: r.name || r.id, game_id: r.game_id, guide: r.guide || "", guide_es: r.guide_es || "" });
}
