import { json, err } from "../../../lib/util.js";
import { needPerm } from "../../../lib/auth.js";
import { FONT_ID, MIME, decodeB64 } from "../../../lib/fonts.js";

// GET: the font file itself. Ids are never reused, so browsers can cache it for a year.
export async function onRequestGet({ env, params }) {
  if (!FONT_ID.test(params.id)) return err(404, "Font not found");
  const f = await env.DB.prepare("SELECT format, data FROM fonts WHERE id = ?").bind(params.id).first();
  if (!f) return err(404, "Font not found");
  return new Response(decodeB64(f.data), {
    headers: { "content-type": MIME[f.format] || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*" },
  });
}

// DELETE: remove an uploaded font. Items using it fall back to the site font.
export async function onRequestDelete({ request, env, params }) {
  const user = await needPerm(env, request, "store");
  if (user instanceof Response) return user;
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM store_items WHERE visual LIKE ?").bind(`%"${params.id}"%`).first();
  await env.DB.prepare("DELETE FROM fonts WHERE id = ?").bind(params.id).run();
  return json({ ok: true, items_affected: used?.n || 0 });
}
