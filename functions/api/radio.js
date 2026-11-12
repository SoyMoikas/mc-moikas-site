import { need, hasRole } from "../../lib/auth.js";
import { json, body, now, err } from "../../lib/util.js";
import { tick, listeners, advance, report, voteSkip, listIdOf, loadState, addRequest, removeItem, vidOf, oembed } from "../../lib/radio.js";

// GET /api/radio?tune=1 → the station (and, with tune=1, counts you as listening). Also moves the station along.
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const q = new URL(request.url).searchParams;
  if (q.get("mytracks") === "1") { // your songs for the "add from my playlists" picker; fills in a few missing titles each time
    const rows = (await env.DB.prepare("SELECT t.vid, t.title, t.author, t.bad, p.title AS list FROM radio_tracks t LEFT JOIN radio_playlists p ON p.user_id = t.user_id AND p.list_id = t.list_id WHERE t.user_id = ? ORDER BY t.title IS NULL, t.title").bind(me.id).all()).results;
    const missing = rows.filter((r) => !r.title && !r.bad).slice(0, 25);
    await Promise.all(missing.map(async (r) => {
      const o = await oembed(env, r.vid);
      if (o.unplayable) { r.bad = 1; await env.DB.prepare("UPDATE radio_tracks SET bad = 1 WHERE vid = ?").bind(r.vid).run(); }
      else if (o.title) { Object.assign(r, o); await env.DB.prepare("UPDATE radio_tracks SET title = ?, author = ? WHERE vid = ?").bind(o.title, o.author, r.vid).run(); }
    }));
    return json({ tracks: rows.filter((r) => !r.bad), more: rows.some((r) => !r.title && !r.bad) });
  }
  const tune = q.get("tune") === "1";
  if (tune) await env.DB.prepare("INSERT INTO radio_listeners (user_id, seen_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET seen_at = excluded.seen_at").bind(me.id, now()).run();
  const st = await tick(env);
  const [people, mine] = await Promise.all([
    listeners(env),
    env.DB.prepare("SELECT list_id, url, title, tracks, updated_at FROM radio_playlists WHERE user_id = ? ORDER BY updated_at").bind(me.id).all().then((r) => r.results),
  ]);
  const ids = [...new Set([...(st.history || []).slice(0, 10), ...(st.queue || [])].map((h) => h.uid).concat(st.uid || 0))];
  const owners = await env.DB.prepare(`SELECT u.id, u.avatar FROM users u WHERE u.id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()
    .then((r) => Object.fromEntries(r.results.map((u) => [u.id, u.avatar])));
  const staff = hasRole(me, "staff");
  return json({
    now: now(), me: me.id,
    playing: st.vid ? { vid: st.vid, uid: st.uid, owner: st.owner, req: !!st.req, avatar: owners[st.uid] || null, title: st.title, author: st.author, dur: st.dur, started: st.started, skips: (st.skips || []).length } : null,
    skipped_by_me: (st.skips || []).includes(me.id),
    listeners: people.map((p) => ({ id: p.id, username: p.username, avatar: p.avatar, tracks: p.tracks })),
    history: (st.history || []).slice(0, 10).map((h) => ({ ...h, avatar: owners[h.uid] || null })),
    queue: (st.queue || []).map((x) => ({ id: x.id, vid: x.vid, title: x.title, author: x.author, owner: x.owner, uid: x.uid, req: !!x.req, avatar: owners[x.uid] || null,
      can_remove: staff || x.by === me.id || (!x.req && x.uid === me.id) })),
    mine,
  });
}

// POST {action}
//   add_list {url, vids} · remove_list {list_id}   your playlists (video ids are read from YouTube by your browser)
//   report {vid, dur, title} · ended {vid} · error {vid} · skip {vid} · leave
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const vid = String(b.vid || "");
  const okVid = /^[\w-]{11}$/.test(vid);
  const t = now();

  if (b.action === "add_list") { // one playlist (re-adding refreshes it); the video ids come from YouTube's player in your browser
    const id = listIdOf(b.url);
    if (!id) return err(400, "That isn't a YouTube playlist link (it needs ?list=…)");
    const vids = [...new Set((Array.isArray(b.vids) ? b.vids : []).filter((v) => /^[\w-]{11}$/.test(v)))].slice(0, 300);
    if (!vids.length) return err(400, "That playlist looks empty or private");
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM radio_playlists WHERE user_id = ? AND list_id != ?").bind(me.id, id).first()).n;
    if (n >= 5) return err(429, "Max 5 playlists — remove one first");
    let title = null;
    try { const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/playlist?list=${id}`)}`); if (r.ok) title = String((await r.json()).title || "").slice(0, 80) || null; } catch { /* no title */ }
    await env.DB.prepare(`INSERT INTO radio_playlists (user_id, list_id, url, title, tracks, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, list_id) DO UPDATE SET url = excluded.url, title = COALESCE(excluded.title, title), tracks = excluded.tracks, updated_at = excluded.updated_at`)
      .bind(me.id, id, String(b.url).slice(0, 300), title, vids.length, t).run();
    const old = new Set((await env.DB.prepare("SELECT vid FROM radio_tracks WHERE user_id = ? AND list_id = ?").bind(me.id, id).all()).results.map((r) => r.vid));
    const keep = new Set(vids);
    const ops = [...[...old].filter((v) => !keep.has(v)).map((v) => env.DB.prepare("DELETE FROM radio_tracks WHERE user_id = ? AND vid = ?").bind(me.id, v)),
      ...vids.filter((v) => !old.has(v)).map((v) => env.DB.prepare("INSERT OR IGNORE INTO radio_tracks (user_id, vid, list_id) VALUES (?, ?, ?)").bind(me.id, v, id))];
    for (let i = 0; i < ops.length; i += 90) await env.DB.batch(ops.slice(i, i + 90));
    return json({ ok: true, tracks: vids.length, title });
  }
  if (b.action === "remove_list") {
    const id = String(b.list_id || "").slice(0, 64);
    await env.DB.batch([env.DB.prepare("DELETE FROM radio_playlists WHERE user_id = ? AND list_id = ?").bind(me.id, id),
      env.DB.prepare("DELETE FROM radio_tracks WHERE user_id = ? AND list_id = ?").bind(me.id, id)]);
    return json({ ok: true });
  }
  if (b.action === "add") {
    const v = vidOf(b.url ?? b.vid);
    if (!v) return err(400, "Pega el link de un video de YouTube (o YouTube Music)");
    const r = await addRequest(env, me, v);
    return r.error ? err(409, r.error) : json(r);
  }
  if (b.action === "remove") {
    const r = await removeItem(env, me, String(b.id || ""), hasRole(me, "staff"));
    return r.error ? err(403, r.error) : json(r);
  }
  if (b.action === "leave") { await env.DB.prepare("DELETE FROM radio_listeners WHERE user_id = ?").bind(me.id).run(); return json({ ok: true }); }
  if (!okVid) return err(400, "Bad video");
  if (b.action === "report") { await report(env, vid, b.dur, b.title); return json({ ok: true }); }
  if (b.action === "ended") {
    const { st } = await loadState(env);
    // trust "it ended" only near the real end (so one listener can't skip for everyone)
    const nearEnd = st.dur ? t >= st.started + st.dur * 1000 - 8000 : t - st.started > 30000;
    if (st.vid === vid && nearEnd) await advance(env, vid);
    return json({ ok: true });
  }
  if (b.action === "error") {
    const { st } = await loadState(env);
    if (st.vid === vid) {
      await env.DB.prepare("UPDATE radio_tracks SET bad = 1 WHERE vid = ?").bind(vid).run(); // can't be embedded / removed
      await advance(env, vid);
    }
    return json({ ok: true });
  }
  if (b.action === "skip") { await voteSkip(env, me.id, vid); return json({ ok: true }); }
  return err(400, "Bad action");
}
