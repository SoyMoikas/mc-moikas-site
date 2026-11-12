import { syncAuthorized } from "../../../lib/sync-auth.js";
import { json, body, err, now } from "../../../lib/util.js";
import { norm, settleArrivals } from "../../../lib/media.js";
import { notify } from "../../../lib/notify.js";
import { ingest, scan, deleteQueue, deleteResults } from "../../../lib/cleanup.js";
import { resetQueue, resetResults } from "../../../lib/jfreset.js";

// The NAS bot ↔ site: Jellyfin library + Seerr requests.
// POST { library?: [{id, type, name, year, tmdb, added}], results?: [{id, status, detail, tmdb}], seerr: bool }
// → { queue: [{id, title, year, kind, tmdb}] }   (requests the bot should send to Seerr)
export async function onRequestPost({ env, request }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now();
  await env.DB.prepare("INSERT OR REPLACE INTO kv_cache (key, value, updated_at) VALUES ('media_bot', ?, ?)").bind(JSON.stringify({ seerr: !!b.seerr }), t).run();

  // 1) Results of requests the bot sent to Seerr last time.
  for (const r of (Array.isArray(b.results) ? b.results : []).slice(0, 50)) {
    const status = ["requested", "exists", "failed"].includes(r.status) ? r.status : null;
    if (!status || !Number.isInteger(r.id)) continue;
    await env.DB.prepare("UPDATE media_requests SET status = ?, detail = ?, tmdb = COALESCE(?, tmdb), updated_at = ? WHERE id = ? AND status = 'queued'")
      .bind(status, r.detail ? String(r.detail).slice(0, 200) : null, r.tmdb ? String(r.tmdb).slice(0, 20) : null, t, r.id).run();
    if (status === "failed") {
      const row = await env.DB.prepare("SELECT r.user_id, w.title FROM media_requests r JOIN watch_items w ON w.id = r.item_id WHERE r.id = ?").bind(r.id).first();
      if (row) await notify(env, [row.user_id], "game", { title: `😕 No se pudo pedir ${row.title}`, body: r.detail || "Seerr no la encontró. Avísale al staff.", url: "/juntos#lista" });
    }
  }

  // 2) Full library snapshot.
  let arrived = 0, fresh = [];
  if (Array.isArray(b.library)) {
    const before = new Set((await env.DB.prepare("SELECT jf_id FROM jellyfin_library").all()).results.map((r) => r.jf_id));
    const rows = b.library.slice(0, 5000).filter((x) => x && x.id && x.name && ["Movie", "Series"].includes(x.type)).map((x) => ({
      jf_id: String(x.id).slice(0, 64), type: x.type, title: String(x.name).slice(0, 200), norm: norm(x.name),
      year: Number.isInteger(x.year) ? x.year : null, tmdb: x.tmdb ? String(x.tmdb).slice(0, 20) : null,
      added_at: x.added ? Date.parse(x.added) || null : null }));
    for (let i = 0; i < rows.length; i += 50) {
      await env.DB.batch(rows.slice(i, i + 50).map((r) => env.DB.prepare(
        `INSERT INTO jellyfin_library (jf_id, type, title, norm, year, tmdb, added_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (jf_id) DO UPDATE SET type = excluded.type, title = excluded.title, norm = excluded.norm, year = excluded.year, tmdb = excluded.tmdb,
           added_at = COALESCE(excluded.added_at, added_at), seen_at = excluded.seen_at`).bind(r.jf_id, r.type, r.title, r.norm, r.year, r.tmdb, r.added_at, t)));
    }
    if (rows.length) await env.DB.prepare("DELETE FROM jellyfin_library WHERE seen_at < ?").bind(t).run(); // removed from Jellyfin
    fresh = before.size ? rows.filter((r) => !before.has(r.jf_id)).map((r) => r.jf_id) : []; // (first sync isn't "new")
    arrived = await settleArrivals(env, rows, fresh);
  }

  // 3) Espacio: sizes / last played / pool usage, deletions the bot finished, then flag new candidates.
  let cleanup = null, del = [];
  try {
    if (Array.isArray(b.deleted)) await deleteResults(env, b.deleted);
    if (Array.isArray(b.usage) || b.storage) await ingest(env, b.usage, b.storage);
    if (Array.isArray(b.usage)) cleanup = await scan(env);
    del = await deleteQueue(env);
  } catch (e) { console.error("cleanup", e.message); }

  // 3b) Jellyfin password resets: the bot's answers, then the next ones to do.
  let jfResets = [];
  try { if (Array.isArray(b.jf_resets_done)) await resetResults(env, b.jf_resets_done); jfResets = await resetQueue(env); }
  catch (e) { console.error("jf reset", e.message); }

  // 4) What the bot should request next.
  const queue = (await env.DB.prepare(`SELECT r.id, w.title, w.year, w.kind, w.ext FROM media_requests r JOIN watch_items w ON w.id = r.item_id
    WHERE r.status = 'queued' ORDER BY r.created_at LIMIT 10`).all()).results.map((r) => {
    const m = /^tmdb:(movie|tv):(\d+)$/.exec(r.ext || "");
    return { id: r.id, title: r.title, year: +r.year || null, kind: r.kind === "movie" ? "movie" : "tv", tmdb: m ? +m[2] : null };
  });
  return json({ ok: true, queue, arrived, fresh: fresh.length, delete: del, cleanup, jf_resets: jfResets });
}
