import { getUser, need } from "../../lib/auth.js";
import { json, body, err } from "../../lib/util.js";
import { validTz } from "../../lib/coins.js";

// GET  → your saved time zone/country + a guess from your connection (city, country, time zone)
// POST {tz, country} → save. tz = an IANA zone like "America/Mexico_City"; country = a 2-letter code like "MX".
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  const cf = request.cf || {};
  return json({
    tz: me?.tz || null, country: me?.country || null,
    detected: { tz: validTz(cf.timezone) ? cf.timezone : null, country: cf.country || null, city: cf.city || null, region: cf.region || null },
  });
}

export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const tz = b.tz == null ? null : String(b.tz).slice(0, 64);
  if (tz && !validTz(tz)) return err(400, "Unknown time zone");
  const country = b.country == null || b.country === "" ? null : String(b.country).toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) return err(400, "Unknown country");
  await env.DB.prepare("UPDATE users SET tz = ?, country = ? WHERE id = ?").bind(tz, country, me.id).run();
  return json({ tz, country });
}
