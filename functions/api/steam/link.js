import { need } from "../../../lib/auth.js";
import { steamLoginUrl } from "../../../lib/steam.js";

// GET /api/steam/link → sends you to Steam's login page to link your account.
// (Your site session cookie comes back with you, so we know who's linking.)
export async function onRequestGet({ request, env }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return Response.redirect(new URL("/", request.url).toString(), 302);
  return Response.redirect(steamLoginUrl(new URL(request.url).origin), 302);
}
