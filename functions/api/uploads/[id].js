import { err } from "../../../lib/util.js";
import { MIME, fromB64 } from "../../../lib/uploads.js";

// GET /api/uploads/<id>.<ext>: the image. Ids are random and never reused, so browsers can keep it for a year.
export async function onRequestGet({ env, params }) {
  const m = /^([a-f0-9]{32})\.(png|jpg|gif|webp)$/.exec(params.id || "");
  if (!m) return err(404, "Not found");
  const r = await env.DB.prepare("SELECT ext, data FROM uploads WHERE id = ?").bind(m[1]).first();
  if (!r) return err(404, "Not found");
  return new Response(fromB64(r.data), {
    headers: { "content-type": MIME[r.ext], "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
  });
}
