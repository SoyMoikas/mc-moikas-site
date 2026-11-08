import { str, int, HttpError } from "./util.js";

export function gameFields(b, { creating = false } = {}) {
  const out = {};
  if (creating) {
    out.id = str(b.id, 30, "id");
    if (!out.id || !/^[a-z0-9-]{2,30}$/.test(out.id)) throw new HttpError(400, "Game id: 2–30 lowercase letters, numbers or -");
  }
  out.name = str(b.name, 50, "name");
  if (!out.name) throw new HttpError(400, "Name is required");
  out.name_es = str(b.name_es, 50, "name_es");
  out.description = str(b.description, 500, "description");
  out.description_es = str(b.description_es, 500, "description_es");
  out.icon = str(b.icon, 16, "icon");
  out.image = str(b.image, 400, "image");
  if (out.image && !/^https:\/\/[^\s"'<>]+$/i.test(out.image)) throw new HttpError(400, "Image must be an https:// link");
  out.color = str(b.color, 7, "color");
  if (out.color && !/^#[0-9a-f]{6}$/i.test(out.color)) throw new HttpError(400, "Color must look like #ff8800");
  out.active = b.active === false || b.active === 0 ? 0 : 1;
  out.sort_order = int(b.sort_order, "sort_order") ?? 0;
  return out;
}

// Active games with server counts and total online players (from synced status).
export async function listGames(env, { includeInactive = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT g.*,
            (SELECT COUNT(*) FROM servers s WHERE s.game_id = g.id AND s.hidden = 0) AS servers
       FROM games g ${includeInactive ? "" : "WHERE g.active = 1"} ORDER BY g.sort_order, g.name`
  ).all();
  return results;
}
