// "Espacio": storage history + "Limpieza" — movies nobody has watched in a long time are flagged, everyone gets
// a grace period to keep them, then staff approve (or auto mode) and the NAS bot deletes them via Radarr/Jellyfin.
import { notify, allMembers } from "./notify.js";
import { discord, site } from "./lfg.js";
import { matcher, jfPoster, jfLink, norm } from "./media.js";
import { laDay } from "./coins.js";

const DAY = 86400000;
export const DEFAULTS = { added_days: 60, idle_days: 120, grace_days: 14, keep_days: 60, min_used_pct: 0, auto: false, enabled: true };
export async function settings(env) {
  try {
    const r = await env.DB.prepare("SELECT value FROM kv_cache WHERE key = 'cleanup_settings'").first();
    return { ...DEFAULTS, ...(r ? JSON.parse(r.value) : {}) };
  } catch { return { ...DEFAULTS }; }
}
export async function saveSettings(env, b) {
  const cur = await settings(env);
  const n = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);
  const s = { added_days: n(b.added_days, 7, 3650, cur.added_days), idle_days: n(b.idle_days, 14, 3650, cur.idle_days), grace_days: n(b.grace_days, 1, 90, cur.grace_days),
    keep_days: n(b.keep_days, 7, 365, cur.keep_days), min_used_pct: n(b.min_used_pct, 0, 99, cur.min_used_pct), auto: b.auto === undefined ? cur.auto : !!b.auto,
    enabled: b.enabled === undefined ? cur.enabled : !!b.enabled };
  await env.DB.prepare("INSERT OR REPLACE INTO kv_cache (key, value, updated_at) VALUES ('cleanup_settings', ?, ?)").bind(JSON.stringify(s), Date.now()).run();
  return s;
}
export const gb = (b) => (b >= 1e12 ? `${(b / 1e12).toFixed(2)} TB` : `${(b / 1e9).toFixed(1)} GB`);

// From the bot: per-item sizes + last time anyone played it, and the pool's used/free.
export async function ingest(env, usage, storage) {
  const t = Date.now();
  if (Array.isArray(usage) && usage.length) {
    const rows = usage.slice(0, 20000).filter((u) => u && u.id);
    for (let i = 0; i < rows.length; i += 80) {
      await env.DB.batch(rows.slice(i, i + 80).map((u) => env.DB.prepare(`INSERT INTO media_usage (jf_id, type, size, last_played, plays, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (jf_id) DO UPDATE SET type = excluded.type, size = excluded.size, last_played = excluded.last_played, plays = excluded.plays, updated_at = excluded.updated_at`)
        .bind(String(u.id).slice(0, 64), u.type === "Series" ? "Series" : "Movie", Number.isFinite(u.size) ? Math.round(u.size) : null,
          u.last_played ? Date.parse(u.last_played) || null : null, Number.isInteger(u.plays) ? u.plays : 0, t)));
    }
    await env.DB.prepare("DELETE FROM media_usage WHERE updated_at < ?").bind(t).run();
  }
  if (storage && Number.isFinite(storage.total) && storage.total > 0) {
    const sums = await env.DB.prepare("SELECT SUM(CASE WHEN type = 'Movie' THEN size END) AS movies, SUM(CASE WHEN type = 'Series' THEN size END) AS shows FROM media_usage").first();
    await env.DB.prepare(`INSERT OR REPLACE INTO storage_days (day, total, used, free, movies, shows, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(laDay(t), Math.round(storage.total), Math.round(storage.used), Math.round(storage.free), sums?.movies || null, sums?.shows || null, t).run();
  }
}

// Flag new candidates, move items along (watched again → kept, grace over → due/approved), tell people.
export async function scan(env) {
  const s = await settings(env);
  if (!s.enabled) return { flagged: 0 };
  const t = Date.now();
  // watched again while pending → saved
  await env.DB.prepare(`UPDATE cleanup_items SET status = 'kept', detail = 'watched', kept_until = ?, updated_at = ? WHERE status IN ('pending', 'due')
    AND jf_id IN (SELECT jf_id FROM media_usage WHERE last_played > cleanup_items.flagged_at)`).bind(t + s.keep_days * DAY, t).run();
  // gone from Jellyfin (deleted by hand / by the bot)
  await env.DB.prepare(`UPDATE cleanup_items SET status = 'deleted', updated_at = ? WHERE status IN ('pending', 'due', 'approved') AND jf_id NOT IN (SELECT jf_id FROM jellyfin_library)`).bind(t).run();
  // grace over
  const due = (await env.DB.prepare("SELECT jf_id, title FROM cleanup_items WHERE status = 'pending' AND delete_after <= ?").bind(t).all()).results;
  if (due.length) {
    await env.DB.prepare(`UPDATE cleanup_items SET status = ?, updated_at = ? WHERE status = 'pending' AND delete_after <= ?`).bind(s.auto ? "approved" : "due", t, t).run();
    if (!s.auto) {
      const staff = (await env.DB.prepare("SELECT id FROM users WHERE role IN ('staff', 'subadmin', 'admin')").all()).results.map((u) => u.id);
      await notify(env, staff, "status", { title: `🧹 ${due.length} película(s) listas para borrar`, body: due.slice(0, 5).map((d) => d.title).join(", "), url: "/status#espacio" });
    }
  }
  // only flag new ones when the disk is at least this full
  const disk = await env.DB.prepare("SELECT total, used FROM storage_days ORDER BY day DESC LIMIT 1").first();
  if (s.min_used_pct && (!disk || (disk.used / disk.total) * 100 < s.min_used_pct)) return { flagged: 0, reason: "disk ok" };
  const cands = (await env.DB.prepare(`SELECT l.jf_id, l.title, l.year, l.tmdb, u.size, u.last_played FROM jellyfin_library l JOIN media_usage u ON u.jf_id = l.jf_id
    WHERE l.type = 'Movie' AND l.added_at < ? AND COALESCE(u.last_played, 0) < ?
      AND l.jf_id NOT IN (SELECT jf_id FROM cleanup_items WHERE status IN ('pending', 'due', 'approved') OR protected = 1 OR (status = 'kept' AND kept_until > ?))
    ORDER BY u.size DESC LIMIT 25`).bind(t - s.added_days * DAY, t - s.idle_days * DAY, t).all()).results;
  if (!cands.length) return { flagged: 0 };
  // skip anything someone ❤'d on the watchlist
  const wanted = (await env.DB.prepare(`SELECT w.title, w.year, w.kind, w.ext FROM watch_items w WHERE w.watched_at IS NULL AND EXISTS (SELECT 1 FROM watch_wants x WHERE x.item_id = w.id)`).all()).results;
  const lib = cands.map((c) => ({ jf_id: c.jf_id, type: "Movie", norm: null, title: c.title, year: c.year, tmdb: c.tmdb }));
  lib.forEach((l) => (l.norm = norm(l.title)));
  const match = matcher(lib), keep = new Set(wanted.map((w) => match(w)?.jf_id).filter(Boolean));
  const fresh = cands.filter((c) => !keep.has(c.jf_id));
  if (!fresh.length) return { flagged: 0 };
  const deleteAfter = t + s.grace_days * DAY;
  await env.DB.batch(fresh.map((c) => env.DB.prepare(`INSERT INTO cleanup_items (jf_id, title, year, tmdb, size, last_played, flagged_at, delete_after, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT (jf_id) DO UPDATE SET status = 'pending', size = excluded.size, last_played = excluded.last_played,
    flagged_at = excluded.flagged_at, delete_after = excluded.delete_after, kept_until = NULL, detail = NULL, staff_pinged = 0, updated_at = excluded.updated_at`)
    .bind(c.jf_id, c.title, c.year, c.tmdb, c.size, c.last_played, t, deleteAfter, t)));
  const total = fresh.reduce((x, c) => x + (c.size || 0), 0);
  await notify(env, await allMembers(env), "fun", { title: `🧹 ${fresh.length} película(s) se borrarán en ${s.grace_days} días`, body: `Nadie las ha visto en mucho tiempo (${gb(total)}). Si quieres conservar alguna, entra y dale 🛡.`, url: "/status#espacio" });
  if (env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL)
    await discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, { allowed_mentions: { parse: [] },
      content: `🧹 **Limpieza de Jellyfin** — nadie ha visto estas en ${s.idle_days} días y se borrarán <t:${Math.floor(deleteAfter / 1000)}:R> si nadie las salva:\n${fresh.slice(0, 12).map((c) => `• ${c.title}${c.year ? ` (${c.year})` : ""} — ${gb(c.size || 0)}`).join("\n")}\n¿Quieres alguna? ${site(env)}/status#espacio` });
  return { flagged: fresh.length };
}

export async function deleteQueue(env) {
  return (await env.DB.prepare("SELECT jf_id, title, year, tmdb FROM cleanup_items WHERE status = 'approved' LIMIT 10").all()).results;
}
export async function deleteResults(env, results) {
  const t = Date.now();
  for (const r of (Array.isArray(results) ? results : []).slice(0, 20)) {
    if (!r || !r.jf_id) continue;
    await env.DB.prepare("UPDATE cleanup_items SET status = ?, detail = ?, updated_at = ? WHERE jf_id = ? AND status = 'approved'")
      .bind(r.ok ? "deleted" : "failed", r.detail ? String(r.detail).slice(0, 200) : r.via || null, t, String(r.jf_id)).run();
    if (r.ok) await env.DB.prepare("DELETE FROM jellyfin_library WHERE jf_id = ?").bind(String(r.jf_id)).run();
  }
}

// Everything the Espacio tab shows.
export async function overview(env, me) {
  const t = Date.now(), s = await settings(env);
  const days = (await env.DB.prepare("SELECT * FROM storage_days ORDER BY day DESC LIMIT 120").all()).results.reverse();
  const last = days[days.length - 1] || null;
  // growth per day over the last ~30 days → when it fills up
  let perDay = null, fullIn = null;
  const past = days.find((d) => d.day >= laDay(t - 30 * DAY)) || days[0];
  if (last && past && past !== last) {
    const span = Math.max(1, (Date.parse(last.day) - Date.parse(past.day)) / DAY);
    perDay = (last.used - past.used) / span;
    if (perDay > 1e8) fullIn = Math.round(last.free / perDay);
  }
  const items = (await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM cleanup_votes v WHERE v.jf_id = c.jf_id) AS votes,
      EXISTS (SELECT 1 FROM cleanup_votes v WHERE v.jf_id = c.jf_id AND v.user_id = ?) AS mine,
      (SELECT GROUP_CONCAT(u.username, ', ') FROM cleanup_votes v JOIN users u ON u.id = v.user_id WHERE v.jf_id = c.jf_id) AS voters
    FROM cleanup_items c WHERE c.status IN ('pending', 'due', 'approved', 'failed') OR (c.status IN ('deleted', 'kept') AND c.updated_at > ?) OR c.protected = 1
    ORDER BY CASE c.status WHEN 'due' THEN 0 WHEN 'approved' THEN 1 WHEN 'failed' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END, c.delete_after`).bind(me.id, t - 30 * DAY).all()).results;
  const biggest = (await env.DB.prepare(`SELECT l.jf_id, l.type, l.title, l.year, u.size, u.last_played, u.plays FROM jellyfin_library l JOIN media_usage u ON u.jf_id = l.jf_id
    WHERE u.size IS NOT NULL ORDER BY u.size DESC LIMIT 12`).all()).results;
  const freed = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS b, COUNT(*) AS n FROM cleanup_items WHERE status = 'deleted'").first();
  const lib = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN type = 'Movie' THEN 1 ELSE 0 END) AS movies FROM jellyfin_library").first();
  const deco = (x) => ({ ...x, poster: jfPoster(env, x.jf_id), url: jfLink(env, x.jf_id) });
  return { now: t, settings: s, disk: last, history: days.map((d) => ({ day: d.day, used: d.used, total: d.total })), per_day: perDay, full_in_days: fullIn,
    items: items.map((i) => deco({ ...i, mine: !!i.mine, protected: !!i.protected })), biggest: biggest.map(deco), freed, library: lib };
}
