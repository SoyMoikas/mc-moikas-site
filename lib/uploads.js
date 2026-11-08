// Image uploads (posts, store items). Stored in D1 as base64 text: D1 rows max out around 2 MB,
// so files are capped at 1.4 MB. The browser shrinks/compresses photos before sending (see uploadImage in common.js).
export const MAX_UPLOAD = 1.4 * 1024 * 1024;
export const DAILY_LIMIT = 30;
export const MIME = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
// URL form: /api/uploads/<32 hex>.<ext> (the extension keeps it valid everywhere an image path is accepted)
export const UPLOAD_URL = /^\/api\/uploads\/([a-f0-9]{32})\.(png|jpg|gif|webp)$/;

// Work out the image type from its first bytes (never trust the browser's label). SVG is refused on purpose.
export function sniffImage(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

export function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Remove an upload when the post using it goes away (only if the same person uploaded it).
export async function dropUpload(env, url, userId) {
  const m = UPLOAD_URL.exec(url || "");
  if (m) await env.DB.prepare("DELETE FROM uploads WHERE id = ? AND user_id = ?").bind(m[1], userId).run();
}
