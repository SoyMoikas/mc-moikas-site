import { json, err, body, now } from "../../../lib/util.js";
import { needPerm } from "../../../lib/auth.js";
import { fontInput } from "../../../lib/fonts.js";

// GET: list uploaded fonts (public; the site needs it to draw names/posts).
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare("SELECT id, name, format, size, created_at FROM fonts ORDER BY name").all().catch(() => ({ results: [] }));
  return json({ fonts: results });
}

// POST { name, data: base64 file } → upload a font. Anyone who can edit the store.
export async function onRequestPost({ request, env }) {
  const user = await needPerm(env, request, "store");
  if (user instanceof Response) return user;
  const b = await body(request, 1600 * 1024);
  if (b instanceof Response) return b;
  const f = fontInput(b);
  // unique id: u_name, u_name_2, u_name_3…
  let id = f.slug, n = 1;
  while (await env.DB.prepare("SELECT 1 FROM fonts WHERE id = ?").bind(id).first()) id = `${f.slug.slice(0, 28)}_${++n}`;
  await env.DB.prepare("INSERT INTO fonts (id, name, format, data, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, f.name, f.format, f.data, f.size, user.id, now()).run();
  return json({ font: { id, name: f.name, format: f.format, size: f.size } }, 201);
}
