import { getUser, need, hasRole } from "../../../lib/auth.js";
import { json, body, str, now, err } from "../../../lib/util.js";
import { matcher, jfLink } from "../../../lib/media.js";

// Group watchlist. GET → everything with "want" votes and ratings; ?q=… searches movies (iTunes) and series (TVmaze).
// POST {action: "add", kind, title, year, poster, ext} | {action: "want"|"watched"|"rate"|"delete", id, stars?, comment?}
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return err(401, "Log in first");
  const q = new URL(request.url).searchParams.get("q");
  if (q) {
    const term = encodeURIComponent(q.slice(0, 60));
    // Best: TMDB (free key, Spanish titles, movies + shows). Without a key: iTunes movies + TVmaze shows.
    if (env.TMDB_API_KEY) {
      try {
        const auth = env.TMDB_API_KEY.length > 40 ? { headers: { Authorization: `Bearer ${env.TMDB_API_KEY}` } } : {};
        const key = env.TMDB_API_KEY.length > 40 ? "" : `&api_key=${env.TMDB_API_KEY}`;
        const d = await (await fetch(`https://api.themoviedb.org/3/search/multi?query=${term}&language=es-MX&include_adult=false${key}`, auth)).json();
        const results = (d.results || []).filter((r) => r.media_type === "movie" || r.media_type === "tv").slice(0, 12).map((r) => ({
          kind: r.media_type === "movie" ? "movie" : (r.genre_ids || []).includes(16) && r.original_language === "ja" ? "anime" : "show",
          title: r.title || r.name, year: (r.release_date || r.first_air_date || "").slice(0, 4), ext: `tmdb:${r.media_type}:${r.id}`,
          poster: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : null }));
        if (results.length) return json({ results });
      } catch { /* fall back below */ }
    }
    const [mv, tv] = await Promise.allSettled([
      fetch(`https://itunes.apple.com/search?term=${term}&media=movie&entity=movie&limit=8&country=mx`).then((r) => r.json()),
      fetch(`https://api.tvmaze.com/search/shows?q=${term}`).then((r) => r.json()),
    ]);
    const movies = mv.status === "fulfilled" ? (mv.value.results || []).map((m) => ({
      kind: "movie", title: m.trackName, year: (m.releaseDate || "").slice(0, 4), ext: `itunes:${m.trackId}`,
      poster: (m.artworkUrl100 || "").replace("100x100", "300x450") })) : [];
    const shows = tv.status === "fulfilled" ? (tv.value || []).slice(0, 8).map(({ show: s }) => ({
      kind: /anime/i.test((s.genres || []).join(" ")) || s.language === "Japanese" ? "anime" : "show", title: s.name, year: (s.premiered || "").slice(0, 4),
      ext: `tvmaze:${s.id}`, poster: s.image?.medium || null })) : [];
    return json({ results: [...movies, ...shows] });
  }
  const items = (await env.DB.prepare(
    `SELECT w.*, u.username AS added_name,
            (SELECT COUNT(*) FROM watch_wants x WHERE x.item_id = w.id) AS wants,
            EXISTS (SELECT 1 FROM watch_wants x WHERE x.item_id = w.id AND x.user_id = ?) AS i_want,
            (SELECT ROUND(AVG(stars) / 2.0, 1) FROM watch_ratings r WHERE r.item_id = w.id) AS avg,
            (SELECT COUNT(*) FROM watch_ratings r WHERE r.item_id = w.id) AS n_ratings,
            (SELECT stars FROM watch_ratings r WHERE r.item_id = w.id AND r.user_id = ?) AS my_stars
       FROM watch_items w LEFT JOIN users u ON u.id = w.added_by ORDER BY w.watched_at IS NOT NULL, wants DESC, w.created_at DESC LIMIT 300`
  ).bind(me.id, me.id).all()).results;
  const ratings = (await env.DB.prepare(
    `SELECT r.item_id, r.stars, r.comment, u.username, u.avatar FROM watch_ratings r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 600`).all()).results;
  // Jellyfin + Seerr (filled by the NAS bot; empty before migration 034 or without the bot)
  let library = [], reqs = new Map(), bot = null;
  try {
    library = (await env.DB.prepare("SELECT jf_id, type, title, norm, year, tmdb FROM jellyfin_library").all()).results;
    reqs = new Map((await env.DB.prepare("SELECT item_id, status, detail FROM media_requests").all()).results.map((r) => [r.item_id, r]));
    bot = await env.DB.prepare("SELECT value, updated_at FROM kv_cache WHERE key = 'media_bot'").first();
  } catch { /* */ }
  const match = matcher(library);
  const requestsOn = !!(bot && JSON.parse(bot.value).seerr && Date.now() - bot.updated_at < 15 * 60000);
  return json({
    requests_on: requestsOn, library_on: library.length > 0,
    items: items.map((i) => {
      const hit = library.length ? match(i) : null, r = reqs.get(i.id);
      return { ...i, ratings: ratings.filter((x) => x.item_id === i.id), jf: hit ? { id: hit.jf_id, url: jfLink(env, hit.jf_id) } : null,
        req: r && !hit ? { status: r.status, detail: r.status === "failed" ? r.detail : null } : null };
    }),
  });
}

export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now();
  if (b.action === "request") {
    const it = await env.DB.prepare("SELECT id, title FROM watch_items WHERE id = ?").bind(+b.id || 0).first();
    if (!it) return err(404, "Not on the list");
    const ex = await env.DB.prepare("SELECT status FROM media_requests WHERE item_id = ?").bind(it.id).first();
    if (ex && ex.status !== "failed") return json({ status: ex.status });
    if (!hasRole(me, "staff")) {
      const open = (await env.DB.prepare("SELECT COUNT(*) AS n FROM media_requests WHERE user_id = ? AND status IN ('queued', 'requested') AND created_at > ?").bind(me.id, t - 7 * 86400000).first()).n;
      if (open >= 5) return err(429, "You have 5 requests waiting this week — wait until some arrive");
    }
    await env.DB.prepare(`INSERT INTO media_requests (item_id, user_id, status, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?)
      ON CONFLICT (item_id) DO UPDATE SET user_id = excluded.user_id, status = 'queued', detail = NULL, updated_at = excluded.updated_at`).bind(it.id, me.id, t, t).run();
    return json({ status: "queued" });
  }
  if (b.action === "add") {
    const title = str(b.title, 120, "title");
    if (!title) return err(400, "Title?");
    const kind = ["movie", "show", "anime"].includes(b.kind) ? b.kind : "movie";
    const ext = /^(itunes:\d+|tvmaze:\d+|tmdb:(movie|tv):\d+)$/.test(b.ext || "") ? b.ext : `manual:${title.toLowerCase()}`;
    const poster = /^https:\/\//.test(b.poster || "") ? String(b.poster).slice(0, 300) : null;
    const r = await env.DB.prepare("INSERT OR IGNORE INTO watch_items (kind, title, year, poster, ext, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(kind, title, str(b.year, 4, "year"), poster, ext, me.id, t).run();
    const id = r.meta.last_row_id || (await env.DB.prepare("SELECT id FROM watch_items WHERE ext = ?").bind(ext).first())?.id;
    await env.DB.prepare("INSERT OR IGNORE INTO watch_wants (item_id, user_id) VALUES (?, ?)").bind(id, me.id).run();
    return json({ id, existed: !r.meta.changes });
  }
  const item = await env.DB.prepare("SELECT * FROM watch_items WHERE id = ?").bind(b.id).first();
  if (!item) return err(404, "Not found");
  if (b.action === "want") {
    const d = await env.DB.prepare("DELETE FROM watch_wants WHERE item_id = ? AND user_id = ?").bind(item.id, me.id).run();
    if (!d.meta.changes) await env.DB.prepare("INSERT INTO watch_wants (item_id, user_id) VALUES (?, ?)").bind(item.id, me.id).run();
  } else if (b.action === "watched") {
    await env.DB.prepare("UPDATE watch_items SET watched_at = CASE WHEN watched_at IS NULL THEN ? ELSE NULL END WHERE id = ?").bind(t, item.id).run();
  } else if (b.action === "rate") {
    const stars = Math.round(Number(b.stars));
    if (!(stars >= 1 && stars <= 10)) return err(400, "1 to 5 stars");
    await env.DB.prepare(
      `INSERT INTO watch_ratings (item_id, user_id, stars, comment, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id, user_id) DO UPDATE SET stars = excluded.stars, comment = excluded.comment, created_at = excluded.created_at`
    ).bind(item.id, me.id, stars, b.comment ? str(b.comment, 280, "comment") : null, t).run();
    if (!item.watched_at) await env.DB.prepare("UPDATE watch_items SET watched_at = ? WHERE id = ?").bind(t, item.id).run();
  } else if (b.action === "delete") {
    if (item.added_by !== me.id && !hasRole(me, "staff")) return err(403, "Only who added it");
    await env.DB.prepare("DELETE FROM watch_items WHERE id = ?").bind(item.id).run();
  } else return err(400, "Bad action");
  return json({ ok: true });
}
