import { json, err, now } from "../../../lib/util.js";
import { need, hasPerm } from "../../../lib/auth.js";
import { MAX_UPLOAD, DAILY_LIMIT, sniffImage, toB64 } from "../../../lib/uploads.js";

// POST raw image bytes (body = the file, Content-Type: image/*) → { url: "/api/uploads/<id>.<ext>" }
// Approved members; 30 a day each (people who can edit the store aren't limited).
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  if (!(request.headers.get("content-type") || "").startsWith("image/")) return err(415, "Send an image");
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD) return err(413, "Image is too big (max 1.4 MB)");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return err(400, "Empty file");
  if (bytes.length > MAX_UPLOAD) return err(413, "Image is too big (max 1.4 MB)");
  const ext = sniffImage(bytes);
  if (!ext) return err(400, "That isn't a PNG, JPG, GIF or WebP image");
  if (!hasPerm(user, "store")) {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM uploads WHERE user_id = ? AND created_at > ?").bind(user.id, now() - 86400000).first();
    if ((r?.n || 0) >= DAILY_LIMIT) return err(429, `You've uploaded ${DAILY_LIMIT} images today. Try again tomorrow.`);
  }
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO uploads (id, user_id, ext, data, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, user.id, ext, toB64(bytes), bytes.length, now()).run();
  return json({ url: `/api/uploads/${id}.${ext}`, size: bytes.length }, 201);
}
