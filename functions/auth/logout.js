import { cookie, parseCookies, sha256 } from "../../lib/util.js";
import { SESSION_COOKIE } from "../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  const headers = new Headers({ location: "/" });
  headers.append("set-cookie", cookie(SESSION_COOKIE, "", { maxAge: 0 }));
  return new Response(null, { status: 302, headers });
}
