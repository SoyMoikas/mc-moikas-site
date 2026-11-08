import { HttpError, str } from "./util.js";

// Uploaded fonts live in D1 (base64 text; D1 rows max out around 2 MB, so files are capped at 1 MB).
export const MAX_FONT_BYTES = 1024 * 1024;
export const FONT_ID = /^u_[a-z0-9_]{1,30}$/;
export const MIME = { woff2: "font/woff2", woff: "font/woff", truetype: "font/ttf", opentype: "font/otf" };

// Work out the format from the file's first bytes (never trust the file name).
export function sniff(bytes) {
  const tag = String.fromCharCode(...bytes.slice(0, 4));
  if (tag === "wOF2") return "woff2";
  if (tag === "wOFF") return "woff";
  if (tag === "OTTO") return "opentype";
  if (tag === "true" || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return "truetype";
  return null;
}

export function decodeB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// { name, data: base64 } → { id, name, format, data, size }
export function fontInput(b) {
  const name = str(b.name, 40, "name");
  if (!name) throw new HttpError(400, "Give the font a name");
  const data = String(b.data || "").replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  if (!data) throw new HttpError(400, "Choose a .woff2, .woff, .ttf or .otf file");
  if (data.length > Math.ceil(MAX_FONT_BYTES / 3) * 4 + 4) throw new HttpError(413, "Font is too big (max 1 MB). Try the .woff2 version.");
  let bytes;
  try { bytes = decodeB64(data); } catch { throw new HttpError(400, "Couldn't read that file"); }
  const format = sniff(bytes);
  if (!format) throw new HttpError(400, "That isn't a font file (.woff2, .woff, .ttf or .otf)");
  const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "font";
  return { slug: `u_${slug}`, name, format, data, size: bytes.length };
}
