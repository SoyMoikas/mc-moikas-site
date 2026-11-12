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

/** Choose the next song: the listener who's waited longest for a turn, then a song of theirs that hasn't played lately. */
export async function pickNext(env, st, people) {
  const withSongs = people.filter((p) => p.tracks > 0);
  if (!withSongs.length) return null;
  const turns = [...(st.vid ? [{ uid: st.uid }] : []), ...(st.history || [])]; // the song playing now counts as the latest turn
  const lastTurn = (uid) => { const i = turns.findIndex((h) => h.uid === uid); return i < 0 ? 1e9 : i; };
  const order = [...withSongs].sort((a, b) => lastTurn(b.id) - lastTurn(a.id) || Math.random() - 0.5);
  const owner = order[0];
  const pool = (await env.DB.prepare("SELECT vid, title, author, dur FROM radio_tracks WHERE user_id = ? AND bad = 0").bind(owner.id).all()).results;
  // none of this person's songs repeat until all of them have played
  const mine = [...(st.vid && st.uid === owner.id ? [st.vid] : []), ...(st.history || []).filter((h) => h.uid === owner.id).map((h) => h.vid)];
  const recent = new Set(mine.slice(0, Math.max(0, pool.length - 1)).concat(st.vid ? [st.vid] : []));
  const fresh = pool.filter((p) => !recent.has(p.vid));
  const list = fresh.length ? fresh : pool;
  const a = new Uint32Array(1); crypto.getRandomValues(a);
  const song = list[a[0] % list.length];
  return { ...song, uid: owner.id, owner: owner.username };
}

async function fillTitle(env, song) {
  if (song.title) return song;
  try { // oEmbed needs no API key
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${song.vid}`)}`);
    if (r.ok) {
      const d = await r.json();
      song.title = String(d.title || "").slice(0, 150) || null; song.author = String(d.author_name || "").slice(0, 80) || null;
      await env.DB.prepare("UPDATE radio_tracks SET title = ?, author = ? WHERE vid = ?").bind(song.title, song.author, song.vid).run();
    } else if (r.status === 401 || r.status === 403 || r.status === 404) song.unplayable = true; // private / removed / no embedding
  } catch { /* offline: the player will tell us the title later */ }
  return song;
}

/** Start the next song now (used when the current one ends, is skipped, or fails). Returns the new state. */
export async function advance(env, expectVid = undefined) {
  for (let i = 0; i < 4; i++) {
    const { raw, st } = await loadState(env);
    if (expectVid !== undefined && st.vid !== expectVid) return st; // someone else already moved it
    const people = await listeners(env);
    let song = await pickNext(env, st, people);
    for (let tries = 0; song && tries < 3; tries++) {
      song = await fillTitle(env, song);
      if (!song.unplayable) break;
      await env.DB.prepare("UPDATE radio_tracks SET bad = 1 WHERE vid = ?").bind(song.vid).run();
      song = await pickNext(env, st, people);
    }
    const t = now();
    const history = st.vid ? [{ vid: st.vid, uid: st.uid, owner: st.owner, title: st.title, author: st.author, at: st.started }, ...(st.history || [])].slice(0, 80) : st.history || [];
    const next = song
      ? { vid: song.vid, uid: song.uid, owner: song.owner, title: song.title || null, author: song.author || null, dur: song.dur || null, started: t + LEAD_MS, skips: [], history }
      : { vid: null, history, skips: [] };
    if (await saveState(env, raw, next)) return next;
  }
  return (await loadState(env)).st;
}

/** Called on every poll: start playing if idle with listeners, or move on when the song is over. */
export async function tick(env) {
  const { st } = await loadState(env);
  const t = now();
  if (!st.vid) { const people = await listeners(env); return people.some((p) => p.tracks > 0) ? advance(env, null) : st; }
  const over = st.dur ? t > st.started + st.dur * 1000 + 2500 : t > st.started + STUCK_MS;
  return over ? advance(env, st.vid) : st;
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
