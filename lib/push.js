// Web Push (phone/desktop notifications) with no payload: the push just wakes the app's service worker,
// which then fetches your newest notification from the site and shows it. Only needs VAPID keys (ES256), no encryption.
// Env: VAPID_PUBLIC_KEY (base64url, 65-byte raw P-256 key) + VAPID_PRIVATE_KEY (base64url "d"). Generate them in Perfil → Ajustes (admin).
const enc = new TextEncoder();
export const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

// Only real push services (so nobody can make the site POST to random URLs).
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]*\.push\.apple\.com|[a-z0-9.-]*\.notify\.windows\.com)$/;
export const validEndpoint = (u) => { try { const x = new URL(u); return x.protocol === "https:" && PUSH_HOSTS.test(x.hostname) && u.length < 1000; } catch { return false; } };
export const pushConfigured = (env) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

let keyCache = null;
async function signingKey(env) {
  if (keyCache?.pub === env.VAPID_PUBLIC_KEY) return keyCache.key;
  const pub = unb64u(env.VAPID_PUBLIC_KEY);
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY, ext: true },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  keyCache = { pub: env.VAPID_PUBLIC_KEY, key };
  return key;
}
export async function vapidJwt(env, aud) {
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || env.SITE_URL || "https://play.moikas.cc" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(env), enc.encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64u(sig)}`;
}

/** Wake every device of these users. Never throws. Returns how many pushes were accepted. */
export async function sendPush(env, userIds) {
  try {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!pushConfigured(env) || !ids.length) return 0;
    const subs = (await env.DB.prepare(`SELECT id, endpoint FROM push_subs WHERE user_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results;
    const jwts = new Map();
    let sent = 0;
    const dead = [], ok = [];
    await Promise.allSettled(subs.slice(0, 200).map(async (s) => {
      const aud = new URL(s.endpoint).origin;
      if (!jwts.has(aud)) jwts.set(aud, vapidJwt(env, aud));
      const r = await fetch(s.endpoint, { method: "POST", signal: AbortSignal.timeout(6000),
        headers: { authorization: `vapid t=${await jwts.get(aud)}, k=${env.VAPID_PUBLIC_KEY}`, ttl: "86400", urgency: "high", "content-length": "0" } });
      if (r.status === 404 || r.status === 410) dead.push(s.id);
      else if (r.ok) { sent++; ok.push(s.id); }
      else console.error("push", r.status, (await r.text()).slice(0, 200));
    }));
    const t = Date.now();
    const stmts = [...dead.map((id) => env.DB.prepare("DELETE FROM push_subs WHERE id = ?").bind(id)), ...ok.map((id) => env.DB.prepare("UPDATE push_subs SET last_ok = ? WHERE id = ?").bind(t, id))];
    if (stmts.length) await env.DB.batch(stmts);
    return sent;
  } catch (e) { console.error("sendPush", e.message); return 0; }
}
