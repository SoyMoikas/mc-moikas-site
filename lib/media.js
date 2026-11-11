// Jellyfin library matching + Seerr request bookkeeping (the NAS bot does the actual LAN calls).
import { notify } from "./notify.js";
import { discord, site } from "./lfg.js";

export const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/^(the|el|la|los|las) /, "").replace(/[^a-z0-9]+/g, " ").trim();

// Watchlist item → Jellyfin item: same TMDB id, or same title and a year within 1.
export function matcher(library) {
  const byTmdb = new Map(), byNorm = new Map();
  for (const l of library) {
    if (l.tmdb) byTmdb.set(`${l.type === "Movie" ? "movie" : "tv"}:${l.tmdb}`, l);
    if (!byNorm.has(l.norm)) byNorm.set(l.norm, []);
    byNorm.get(l.norm).push(l);
  }
  return (item) => {
    const m = /^tmdb:(movie|tv):(\d+)$/.exec(item.ext || "");
    if (m && byTmdb.has(`${m[1]}:${m[2]}`)) return byTmdb.get(`${m[1]}:${m[2]}`);
    const want = item.kind === "movie" ? "Movie" : "Series";
    const c = (byNorm.get(norm(item.title)) || []).filter((l) => l.type === want);
    const y = +item.year || null;
    return c.find((l) => !y || !l.year || Math.abs(l.year - y) <= 1) || null;
  };
}
export const jfLink = (env, id) => (env.JELLYFIN_PUBLIC_URL ? `${env.JELLYFIN_PUBLIC_URL.replace(/\/$/, "")}/web/#/details?id=${id}` : null);
export const jfPoster = (env, id) => (env.JELLYFIN_PUBLIC_URL ? `${env.JELLYFIN_PUBLIC_URL.replace(/\/$/, "")}/Items/${id}/Images/Primary?fillHeight=360&quality=85` : null);

// After a library sync: requests (and ❤'d watchlist items) that are now on Jellyfin → tell the people who wanted them.
export async function settleArrivals(env, library, freshIds) {
  const match = matcher(library);
  const open = (await env.DB.prepare(`SELECT r.id, r.user_id, r.status, w.id AS item_id, w.title, w.year, w.kind, w.ext FROM media_requests r
    JOIN watch_items w ON w.id = r.item_id WHERE r.status IN ('queued', 'requested', 'exists')`).all()).results;
  const t = Date.now();
  let arrived = 0;
  for (const r of open) {
    const hit = match(r);
    if (!hit) continue;
    arrived++;
    await env.DB.prepare("UPDATE media_requests SET status = 'available', detail = ?, updated_at = ? WHERE id = ?").bind(hit.jf_id, t, r.id).run();
    const fans = (await env.DB.prepare("SELECT user_id FROM watch_wants WHERE item_id = ?").bind(r.item_id).all()).results.map((x) => x.user_id);
    await notify(env, [r.user_id, ...fans], "game", { title: `🍿 ${r.title} ya está en Jellyfin`, body: "La pediste (o le diste ❤). ¡Ya se puede ver!", url: jfLink(env, hit.jf_id) || "/juntos#lista" });
  }
  // Brand-new arrivals → one Discord message for the batch.
  if (freshIds.length && env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL) {
    const names = library.filter((l) => freshIds.includes(l.jf_id)).slice(0, 10).map((l) => `• ${l.title}${l.year ? ` (${l.year})` : ""}`);
    if (names.length) await discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, { allowed_mentions: { parse: [] },
      content: `🎞️ **Nuevo en Jellyfin**\n${names.join("\n")}\n${site(env)}/juntos#lista` });
  }
  return arrived;
}
