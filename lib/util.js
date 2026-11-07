export const now = () => Date.now();

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export const err = (status, message) => json({ error: message }, status);

// Parse a JSON request body with a size cap. Returns object or a Response on failure.
export async function body(request, maxBytes = 64 * 1024) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return err(415, "Expected JSON");
  const text = await request.text();
  if (text.length > maxBytes) return err(413, "Request too large");
  try {
    const v = JSON.parse(text || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return err(400, "Expected a JSON object");
    return v;
  } catch {
    return err(400, "Invalid JSON");
  }
}

// Trimmed string or null; throws on over-length so the handler can return a 400.
export function str(v, max, field = "field") {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max})`);
  return s;
}

export function int(v, field = "field", { min = -1e9, max = 1e9 } = {}) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number`);
  return n;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "server";
}

export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAge, path = "/" } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; Secure; SameSite=Lax`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

// Only allow same-site relative paths as a post-login destination.
export function safeNext(n) {
  return typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") ? n : "/";
}
