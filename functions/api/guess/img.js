import { getUser } from "../../../lib/auth.js";
import { today } from "../../../lib/guess.js";
import { dayIn, zoneOf } from "../../../lib/coins.js";

// GET /api/guess/img → today's cover, served from here so the address doesn't give the game away.
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return new Response("Log in", { status: 401 });
  const g = await today(env, dayIn(zoneOf(me)));
  const r = await fetch(`https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`, { cf: { cacheTtl: 86400 } });
  if (!r.ok) return new Response("Image not found", { status: 502 });
  return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "image/jpeg", "cache-control": "private, max-age=3600" } });
}
