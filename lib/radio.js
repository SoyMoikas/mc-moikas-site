// Radio: one shared station. Songs come from the YouTube playlists of the people tuned in right now, taking turns
// (one from Ana, one from Leo…). Everyone's player seeks to the same moment. State lives in kv_cache 'radio_state'
// and changes with a compare-and-swap, so two listeners can't both pick the next song.
import { now } from "./util.js";

export const LISTEN_TTL = 75_000;   // a listener counts while their page pinged within this window
const LEAD_MS = 1500;               // a new song starts a moment in the future so everyone can load it
const STUCK_MS = 12 * 60_000;       // unknown length: give up after this long

export async function loadState(env) {
  const r = await env.DB.prepare("SELECT value FROM kv_cache WHERE key = 'radio_state'").first();
  let st = null;
  try { st = r ? JSON.parse(r.value) : null; } catch { st = null; }
  return { raw: r?.value ?? null, st: st || { vid: null, history: [], skips: [] } };
}
async function saveState(env, raw, st) {
  const val = JSON.stringify(st);
  const t = now();
  if (raw == null) {
    const r = await env.DB.prepare("INSERT OR IGNORE INTO kv_cache (key, value, updated_at) VALUES ('radio_state', ?, ?)").bind(val, t).run();
    return r.meta.changes > 0;
  }
  const r = await env.DB.prepare("UPDATE kv_cache SET value = ?, updated_at = ? WHERE key = 'radio_state' AND value = ?").bind(val, t, raw).run();
  return r.meta.changes > 0;
}

export async function listeners(env) {
  return (await env.DB.prepare(`SELECT u.id, u.username, u.avatar,
      (SELECT COUNT(*) FROM radio_tracks t WHERE t.user_id = u.id AND t.bad = 0) AS tracks
    FROM radio_listeners l JOIN users u ON u.id = l.user_id WHERE l.seen_at > ? ORDER BY l.seen_at`).bind(now() - LISTEN_TTL).all()).results;
}

export const QUEUE_AUTO = 5, MAX_REQ_EACH = 3, MAX_QUEUE = 25;
const qid = () => Math.random().toString(36).slice(2, 9);

/** Choose an automatic song: the listener who's waited longest for a turn (counting songs already queued), then a song
 *  of theirs that hasn't played lately. `timeline` = most recent first: queued (last first), now playing, history. */
export async function pickNext(env, timeline, people, avoid = new Set()) {
  const withSongs = people.filter((p) => p.tracks > 0);
  if (!withSongs.length) return null;
  const lastTurn = (uid) => { const i = timeline.findIndex((h) => h.uid === uid && !h.req && !h.removed); return i < 0 ? 1e9 : i; };
  const order = [...withSongs].sort((a, b) => lastTurn(b.id) - lastTurn(a.id) || Math.random() - 0.5);
  for (const owner of order) {
    const pool = (await env.DB.prepare("SELECT vid, title, author, dur FROM radio_tracks WHERE user_id = ? AND bad = 0").bind(owner.id).all()).results;
    if (!pool.length) continue;
    // none of this person's songs repeat until all of them have played
    const mine = timeline.filter((h) => h.uid === owner.id).map((h) => h.vid);
    const recent = new Set([...mine.slice(0, Math.max(0, pool.length - 1)), ...avoid]);
    const fresh = pool.filter((p) => !recent.has(p.vid));
    const list = fresh.length ? fresh : pool.filter((p) => !avoid.has(p.vid));
    if (!list.length) continue;
    const a = new Uint32Array(1); crypto.getRandomValues(a);
    const song = list[a[0] % list.length];
    return { ...song, uid: owner.id, owner: owner.username };
  }
  return null;
}

export async function oembed(env, vid) {
  try { // oEmbed needs no API key
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}`);
    if (r.ok) { const d = await r.json(); return { title: String(d.title || "").slice(0, 150) || null, author: String(d.author_name || "").slice(0, 80) || null }; }
    if (r.status === 401 || r.status === 403 || r.status === 404) return { unplayable: true }; // private / removed / no embedding
  } catch { /* offline: the player will tell us the title later */ }
  return {};
}
async function fillTitle(env, song) {
  if (song.title) return song;
  const o = await oembed(env, song.vid);
  if (o.unplayable) return { ...song, unplayable: true };
  if (o.title) { Object.assign(song, o); await env.DB.prepare("UPDATE radio_tracks SET title = ?, author = ? WHERE vid = ?").bind(o.title, o.author, song.vid).run(); }
  return song;
}

/** Keep the queue honest and topped up: drop automatic picks from people who left, then add picks up to QUEUE_AUTO. */
async function refill(env, st, people) {
  const here = new Set(people.filter((p) => p.tracks > 0).map((p) => p.id));
  let queue = (st.queue || []).filter((q) => q.req || here.has(q.uid));
  let autos = queue.filter((q) => !q.req).length;
  for (let guard = 0; autos < QUEUE_AUTO && guard < QUEUE_AUTO + 3; guard++) {
    const timeline = [...[...queue].reverse(), ...(st.vid ? [{ uid: st.uid, vid: st.vid, req: st.req }] : []), ...(st.history || [])];
    let song = await pickNext(env, timeline, people, new Set([...queue.map((q) => q.vid), st.vid].filter(Boolean)));
    if (!song) break;
    song = await fillTitle(env, song);
    if (song.unplayable) { await env.DB.prepare("UPDATE radio_tracks SET bad = 1 WHERE vid = ?").bind(song.vid).run(); continue; }
    queue.push({ id: qid(), vid: song.vid, uid: song.uid, owner: song.owner, title: song.title || null, author: song.author || null, dur: song.dur || null });
    autos++;
  }
  return queue;
}

/** Start the next song in the queue (used when the current one ends, is skipped, or fails). Returns the new state. */
export async function advance(env, expectVid = undefined) {
  for (let i = 0; i < 4; i++) {
    const { raw, st } = await loadState(env);
    if (expectVid !== undefined && st.vid !== expectVid) return st; // someone else already moved it
    const people = await listeners(env);
    const t = now();
    const history = st.vid ? [{ vid: st.vid, uid: st.uid, owner: st.owner, title: st.title, author: st.author, req: st.req || false, at: st.started }, ...(st.history || [])].slice(0, 80) : st.history || [];
    let queue = await refill(env, { ...st, history, vid: null }, people);
    const song = queue.shift();
    const next = song
      ? { vid: song.vid, uid: song.uid, owner: song.owner, req: !!song.req, by: song.by || null, title: song.title || null, author: song.author || null, dur: song.dur || null, started: t + LEAD_MS, skips: [], history, queue }
      : { vid: null, history, skips: [], queue: [] };
    if (song) next.queue = await refill(env, next, people);
    if (await saveState(env, raw, next)) return next;
  }
  return (await loadState(env)).st;
}

/** Called on every poll: start playing if idle, move on when the song is over, keep the upcoming list fresh. */
export async function tick(env) {
  const { raw, st } = await loadState(env);
  const t = now();
  const people = await listeners(env);
  if (!people.length) return st; // nobody listening: don't burn through the queue
  if (!st.vid) return people.some((p) => p.tracks > 0) || (st.queue || []).some((q) => q.req) ? advance(env, null) : st;
  const over = st.dur ? t > st.started + st.dur * 1000 + 2500 : t > st.started + STUCK_MS;
  if (over) return advance(env, st.vid);
  // someone joined or left: refresh the automatic picks (cheap check first)
  const here = new Set(people.filter((p) => p.tracks > 0).map((p) => p.id));
  const queue = st.queue || [];
  const stale = queue.some((q) => !q.req && !here.has(q.uid)) || queue.filter((q) => !q.req).length < Math.min(QUEUE_AUTO, here.size ? QUEUE_AUTO : 0)
    || [...here].some((uid) => !queue.some((q) => q.uid === uid) && st.uid !== uid);
  if (!stale) return st;
  const next = { ...st, queue: await refill(env, { ...st, queue: queue.filter((q) => q.req) }, people) };
  return (await saveState(env, raw, next)) ? next : (await loadState(env)).st;
}

/** Add a song to the queue (after the other requests, before the automatic picks). */
export async function addRequest(env, me, vid) {
  const o = await oembed(env, vid);
  if (o.unplayable) return { error: "Ese video no se puede poner aquí (es privado, lo quitaron o no deja reproducirse fuera de YouTube)" };
  for (let i = 0; i < 4; i++) {
    const { raw, st } = await loadState(env);
    const queue = st.queue || [];
    if (queue.filter((q) => q.req && q.by === me.id).length >= MAX_REQ_EACH) return { error: `Máximo ${MAX_REQ_EACH} canciones pedidas a la vez — espera a que suenen` };
    if (queue.length >= MAX_QUEUE) return { error: "La fila está llena" };
    if (st.vid === vid || queue.some((q) => q.vid === vid && q.req)) return { error: "Esa ya está en la fila" };
    const known = await env.DB.prepare("SELECT title, author, dur FROM radio_tracks WHERE vid = ? AND title IS NOT NULL LIMIT 1").bind(vid).first();
    const item = { id: qid(), vid, uid: me.id, owner: me.username, by: me.id, req: true, title: o.title || known?.title || null, author: o.author || known?.author || null, dur: known?.dur || null };
    const at = queue.findIndex((q) => !q.req);
    const nq = at < 0 ? [...queue, item] : [...queue.slice(0, at), item, ...queue.slice(at)];
    if (await saveState(env, raw, { ...st, queue: nq.filter((q) => q.req || q.vid !== vid) })) return { ok: true, item };
  }
  return { error: "Intenta otra vez" };
}

/** Remove from the queue: your own requests, upcoming songs from your playlist, or anything if you're staff. */
export async function removeItem(env, me, id, staff) {
  for (let i = 0; i < 4; i++) {
    const { raw, st } = await loadState(env);
    const item = (st.queue || []).find((q) => q.id === id);
    if (!item) return { ok: true };
    if (!staff && item.by !== me.id && !(item.uid === me.id && !item.req)) return { error: "Solo quien la pidió (o el staff) la puede quitar" };
    const people = await listeners(env);
    // keep the requests, rebuild the automatic picks so the turns stay even (and the removed song isn't picked again right away)
    const next = { ...st, queue: (st.queue || []).filter((q) => q.id !== id && q.req) };
    next.queue = await refill(env, { ...next, history: [{ vid: item.vid, uid: item.uid, removed: true }, ...(st.history || [])] }, people);
    if (await saveState(env, raw, next)) return { ok: true };
  }
  return { error: "Intenta otra vez" };
}

/** A player tells us the length / title of the current song (first one to know wins). */
export async function report(env, vid, dur, title) {
  dur = Math.round(Number(dur));
  if (Number.isFinite(dur) && dur > 0 && dur < 4 * 3600) await env.DB.prepare("UPDATE radio_tracks SET dur = ? WHERE vid = ?").bind(dur, vid).run();
  if (title) await env.DB.prepare("UPDATE radio_tracks SET title = COALESCE(title, ?) WHERE vid = ?").bind(String(title).slice(0, 150), vid).run();
  for (let i = 0; i < 3; i++) {
    const { raw, st } = await loadState(env);
    if (st.vid !== vid || (st.dur && (st.title || !title))) return;
    const next = { ...st, dur: st.dur || (dur > 0 ? dur : null), title: st.title || (title ? String(title).slice(0, 150) : null) };
    if (await saveState(env, raw, next)) return;
  }
}

/** Skip vote: a majority of listeners moves on. */
export async function voteSkip(env, uid, vid) {
  for (let i = 0; i < 3; i++) {
    const { raw, st } = await loadState(env);
    if (st.vid !== vid) return st;
    const skips = [...new Set([...(st.skips || []), uid])];
    const n = (await listeners(env)).length || 1;
    if (skips.length >= Math.ceil(n / 2)) return advance(env, vid);
    if (await saveState(env, raw, { ...st, skips })) return { ...st, skips };
  }
  return (await loadState(env)).st;
}

/** Parse a YouTube / YouTube Music playlist link → list id. */
export function listIdOf(url) {
  try {
    const u = new URL(String(url).trim());
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null;
    const id = u.searchParams.get("list");
    return id && /^[\w-]{10,64}$/.test(id) ? id : null;
  } catch { return null; }
}

/** Parse a YouTube / YouTube Music video link (or a bare 11-char id) → video id. */
export function vidOf(s) {
  s = String(s || "").trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") return /^\/([\w-]{11})/.exec(u.pathname)?.[1] || null;
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const v = u.searchParams.get("v") || /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname)?.[1];
    return v && /^[\w-]{11}$/.test(v) ? v : null;
  } catch { return null; }
}

/** Why a list id can never be read (these are personal / generated lists). */
export function listProblem(id) {
  if (id === "LM" || id === "LL") return "Esa es tu lista de \"Me gusta\", y YouTube la mantiene privada siempre. Agrega las canciones a una playlist normal (pública o no listada) y pega esa.";
  if (id === "WL") return "\"Ver más tarde\" es privada siempre. Usa una playlist normal (pública o no listada).";
  if (/^RD/.test(id)) return "Esa es una mezcla automática de YouTube (cambia sola). Usa una playlist normal.";
  return null;
}

/** Read a playlist on the server: YouTube Data API if YOUTUBE_API_KEY is set (fast, with titles), otherwise the public page.
 *  → { vids: [{ vid, title?, author? }], title? } or { error, private? } */
export async function readPlaylistServer(env, id, max = 300) {
  const bad = listProblem(id);
  if (bad) return { error: bad };
  if (env.YOUTUBE_API_KEY) {
    const out = []; let page = "", title = null;
    try {
      const meta = await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet,status&id=${id}&key=${env.YOUTUBE_API_KEY}`).then((r) => r.json());
      if (!meta.items?.length) return { error: "No encontré esa playlist — probablemente es privada. Cámbiala a pública o no listada.", private: true };
      title = meta.items[0].snippet?.title || null;
      for (let i = 0; i < Math.ceil(max / 50) && out.length < max; i++) {
        const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,status&maxResults=50&playlistId=${id}&key=${env.YOUTUBE_API_KEY}${page ? `&pageToken=${page}` : ""}`).then((x) => x.json());
        if (r.error) return { error: `YouTube dijo: ${r.error.message}`.slice(0, 160) };
        for (const it of r.items || []) {
          const vid = it.snippet?.resourceId?.videoId, st = it.status?.privacyStatus;
          if (vid && st !== "private" && it.snippet?.title !== "Deleted video") out.push({ vid, title: it.snippet.title?.slice(0, 150) || null, author: (it.snippet.videoOwnerChannelTitle || "").replace(/ - Topic$/, "").slice(0, 80) || null });
        }
        page = r.nextPageToken; if (!page) break;
      }
      return out.length ? { vids: out.slice(0, max), title } : { error: "Esa playlist está vacía." };
    } catch (e) { return { error: `No pude hablar con YouTube (${e.message})`.slice(0, 160) }; }
  }
  // no key: read the public playlist page (first ~100 songs)
  try {
    const r = await fetch(`https://www.youtube.com/playlist?list=${id}&hl=es&persist_hl=1`, { headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "accept-language": "es-MX,es;q=0.9,en;q=0.8", cookie: "CONSENT=YES+cb; SOCS=CAI" } });
    if (!r.ok) return { error: null };
    const html = await r.text();
    const at = html.indexOf("ytInitialData");
    if (at < 0) return { error: null };
    const chunk = html.slice(at, at + 1_500_000);
    const vids = [...new Set([...chunk.matchAll(/"playlistVideoRenderer":\{"videoId":"([\w-]{11})"/g)].map((m) => m[1]))].slice(0, max).map((vid) => ({ vid }));
    if (vids.length) return { vids, title: (/"title":\{"simpleText":"([^"]{1,80})"/.exec(chunk) || [])[1] || null };
    if (/"isPrivate"|privad|private/i.test(chunk.slice(0, 200000)) || /alertRenderer/.test(chunk)) return { error: "Esa playlist es privada. En YouTube Music: abre la playlist → ✏️ Editar → Privacidad: Pública o No listada.", private: true };
    return { error: null }; // couldn't tell: let the browser try
  } catch { return { error: null }; }
}
