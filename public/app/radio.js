// 📻 Radio: one shared station playing songs from the YouTube playlists of whoever is tuned in, taking turns.
// Everyone's player follows the server's clock, so you all hear the same song at the same moment.
import { ask, notice, api, esc, t, initPage, toast } from "./common.js";

const user = await initPage();
const main = document.getElementById("main");
document.title = `${t("rd.title")} · Moikas`;
const popup = new URLSearchParams(location.search).has("popup");
if (popup) document.body.classList.add("popup");
const av = (u) => `<img class="soc-av" src="${esc(u.avatar || "https://cdn.discordapp.com/embed/avatars/0.png")}" alt="" title="${esc(u.username || u.owner || "")}" loading="lazy" onerror="this.style.visibility='hidden'">`;

let d = null, skew = 0, tuned = false, player = null, ready = false, loadedVid = null, reported = new Set(), timer = null, vol = 70;
try { vol = +localStorage.getItem("radio_vol") || 70; } catch { /* storage off */ }

// YouTube IFrame API (loaded once)
const ytReady = new Promise((ok) => {
  if (window.YT?.Player) return ok();
  window.onYouTubeIframeAPIReady = ok;
  const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s);
});

if (!user || user.role === "pending") main.innerHTML = `<section><h1>📻 ${t("rd.title")}</h1><p class="muted">${t("cs.guest")}</p></section>`;
else start();

async function start() {
  main.innerHTML = `
    <section class="rd">
      <div class="section-head"><h1>📻 ${t("rd.title")}</h1>${popup ? "" : `<button class="small-btn" id="rd-pop">↗ ${t("rd.popout")}</button>`}</div>
      <p class="muted rd-intro">${t("rd.intro")}</p>
      <div class="rd-grid">
        <div class="card rd-now">
          <div class="rd-video"><div id="rd-player"></div><div class="rd-cover" id="rd-cover">📻</div></div>
          <div id="rd-info"></div>
          <div class="rd-bar"><i id="rd-prog"></i></div>
          <div class="rd-ctl" id="rd-ctl"></div>
        </div>
        <div class="rd-side">
          <div class="card"><b>🎧 ${t("rd.listening")}</b><div id="rd-people" class="rd-people"></div></div>
          <div class="card rd-q"><b>🎶 ${t("rd.upNext")}</b><div id="rd-queue" class="rd-queue"></div>
            <form class="lfg-row" id="rd-req"><input name="url" required placeholder="${esc(t("rd.reqPh"))}"><button class="primary small-btn">＋</button></form>
            <button class="small-btn" id="rd-pick">🎵 ${t("rd.fromMine")}</button><div id="rd-picker"></div></div>
          <div class="card"><b>🕘 ${t("rd.history")}</b><div id="rd-hist" class="rd-hist"></div></div>
        </div>
      </div>
      <div class="card rd-mine" id="rd-mine"></div>
      <div id="rd-import" class="rd-import"></div>
    </section>`;
  main.querySelector("#rd-pop")?.addEventListener("click", () => {
    window.open("/radio?popup=1", "moikas-radio", "width=460,height=820");
    if (tuned) leave();
  });
  await poll();
}

const serverNow = () => Date.now() + skew;
const offsetSec = (p) => (serverNow() - p.started) / 1000;
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function poll() {
  clearTimeout(timer);
  const t0 = Date.now();
  try {
    d = await api(`/api/radio${tuned ? "?tune=1" : ""}`);
    skew = d.now - (t0 + Date.now()) / 2;
    draw();
    if (tuned) sync();
  } catch (x) { console.warn(x); }
  timer = setTimeout(poll, tuned ? 5000 : 15000);
}

function draw() {
  const p = d.playing;
  main.querySelector("#rd-cover").hidden = !!(tuned && p);
  main.querySelector("#rd-info").innerHTML = p ? `
    <div class="rd-title">${esc(p.title || t("rd.loadingTitle"))}</div>
    <div class="small muted">${p.author ? `${esc(p.author)} · ` : ""}${av(p)} ${t("rd.fromList", { name: esc(p.owner || "?") })}</div>`
    : `<div class="rd-title muted">${t(d.listeners.length ? "rd.noSongs" : "rd.silence")}</div>`;
  const ctl = main.querySelector("#rd-ctl");
  ctl.innerHTML = !tuned ? `<button class="primary rd-tune" data-rd="tune">▶ ${t("rd.tune")}</button>`
    : `<button class="small-btn" data-rd="mute">${vol ? "🔊" : "🔇"}</button><input type="range" min="0" max="100" value="${vol}" id="rd-vol">
       ${p ? `<button class="small-btn" data-rd="skip" ${d.skipped_by_me ? "disabled" : ""}>⏭ ${t("rd.skip")} ${p.skips ? `(${p.skips}/${Math.ceil(d.listeners.length / 2)})` : ""}</button>` : ""}
       <span style="flex:1"></span><button class="small-btn" data-rd="leave">⏹ ${t("rd.leave")}</button>`;
  main.querySelector("#rd-vol")?.addEventListener("input", (e) => { vol = +e.target.value; player?.setVolume?.(vol); try { localStorage.setItem("radio_vol", vol); } catch { /* */ } });
  main.querySelector("#rd-people").innerHTML = d.listeners.map((l) => `<span class="rd-p ${l.tracks ? "" : "none"}" title="${esc(l.tracks ? t("rd.songs", { n: l.tracks }) : t("rd.noList"))}">${av(l)} ${esc(l.username)}${l.tracks ? "" : " 🔇"}</span>`).join("")
    || `<span class="hint">${t("rd.nobody")}</span>`;
  main.querySelector("#rd-queue").innerHTML = (d.queue || []).slice(0, 12).map((q, i) => `<div class="rd-qi ${q.req ? "req" : ""}">
      <span class="rd-qn">${i + 1}</span>${av(q)}<span class="rd-qt"><b>${esc(q.title || "…")}</b><span class="small muted">${q.req ? `⭐ ${t("rd.askedBy", { name: esc(q.owner) })}` : t("rd.fromList", { name: esc(q.owner) })}</span></span>
      ${q.can_remove ? `<button class="link" data-qdel="${esc(q.id)}" title="${esc(t("rd.removeSong"))}">✕</button>` : ""}</div>`).join("") || `<span class="hint">${t("rd.queueEmpty")}</span>`;
  main.querySelector("#rd-hist").innerHTML = d.history.map((h) => `<div class="small rd-h">${av(h)} <span>${esc(h.title || "…")}</span></div>`).join("") || `<span class="hint">—</span>`;
  const mine = main.querySelector("#rd-mine");
  mine.innerHTML = `<b>🎵 ${t("rd.myLists")}</b>
    <div class="rd-lists">${d.mine.map((l) => `<div class="rd-list"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title || l.list_id)}</a> <span class="small muted">${t("rd.songs", { n: l.tracks })}</span>
      <span style="flex:1"></span><button class="link" data-refresh="${esc(l.url)}" title="${esc(t("rd.refresh"))}">↻</button><button class="link" data-remove="${esc(l.list_id)}">✕</button></div>`).join("") || `<p class="hint">${t("rd.noneYet")}</p>`}</div>
    ${d.mine.length < 5 ? `<form class="lfg-row" id="rd-add"><input name="url" required placeholder="https://music.youtube.com/playlist?list=…"><button class="primary">${t("rd.add")}</button></form>` : ""}
    <p class="hint">${t("rd.howAdd")}</p>`;
  progress();
}

function progress() {
  const p = d?.playing, bar = main.querySelector("#rd-prog");
  if (!bar) return;
  if (!p || !p.dur) { bar.style.width = "0"; return; }
  bar.style.width = `${Math.max(0, Math.min(100, (offsetSec(p) / p.dur) * 100))}%`;
  bar.title = `${fmtT(Math.max(0, offsetSec(p)))} / ${fmtT(p.dur)}`;
}
setInterval(progress, 1000);

// ---------- playback ----------
async function ensurePlayer() {
  if (player) return;
  await ytReady;
  await new Promise((ok) => {
    player = new YT.Player("rd-player", { width: "100%", height: "100%", playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1 },
      events: { onReady: () => { ready = true; player.setVolume(vol); ok(); }, onStateChange: onState, onError } });
  });
}
function sync() {
  const p = d.playing;
  if (!ready) return;
  if (!p) { if (loadedVid) { player.stopVideo(); loadedVid = null; } return; }
  const off = offsetSec(p);
  if (loadedVid !== p.vid) {
    loadedVid = p.vid;
    if (off < 0) { player.cueVideoById(p.vid, 0); setTimeout(() => loadedVid === p.vid && player.playVideo(), -off * 1000); }
    else player.loadVideoById({ videoId: p.vid, startSeconds: off });
    return;
  }
  const st = player.getPlayerState();
  if (off > 0 && st === YT.PlayerState.PLAYING && Math.abs(player.getCurrentTime() - off) > 3) player.seekTo(off, true);
  if (off > 0 && (st === YT.PlayerState.PAUSED || st === YT.PlayerState.CUED)) { player.seekTo(off, true); player.playVideo(); }
}
function onState(e) {
  const p = d?.playing;
  if (!p || loadedVid !== p.vid) return;
  if (e.data === YT.PlayerState.PLAYING && !reported.has(p.vid)) {
    reported.add(p.vid);
    const dur = player.getDuration(), title = player.getVideoData()?.title;
    if (!p.dur || !p.title) api("/api/radio", { method: "POST", body: { action: "report", vid: p.vid, dur, title } }).then(poll).catch(() => {});
  }
  if (e.data === YT.PlayerState.ENDED) api("/api/radio", { method: "POST", body: { action: "ended", vid: p.vid } }).then(() => setTimeout(poll, 400)).catch(() => {});
}
function onError(e) {
  const p = d?.playing;
  // 2 bad id · 5 html5 · 100 removed · 101/150 owner blocked embedding
  if (p && loadedVid === p.vid && [2, 100, 101, 150].includes(e.data)) api("/api/radio", { method: "POST", body: { action: "error", vid: p.vid } }).then(() => setTimeout(poll, 400)).catch(() => {});
}
function leave() {
  tuned = false; loadedVid = null;
  try { player?.stopVideo(); } catch { /* */ }
  fetch("/api/radio", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "leave" }) }).catch(() => {});
  poll();
}
addEventListener("pagehide", () => { if (tuned) navigator.sendBeacon?.("/api/radio", new Blob([JSON.stringify({ action: "leave" })], { type: "application/json" })); });

// ---------- importing a playlist: let YouTube's own player list the videos (no API key needed) ----------
function readPlaylist(listId) {
  return new Promise(async (resolve, reject) => {
    await ytReady;
    const box = main.querySelector("#rd-import");
    box.innerHTML = `<div id="rd-imp"></div>`;
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { imp.destroy(); } catch { /* */ } box.innerHTML = ""; v instanceof Error ? reject(v) : resolve(v); };
    const imp = new YT.Player("rd-imp", { width: 200, height: 200, playerVars: { listType: "playlist", list: listId, autoplay: 0 },
      events: {
        onReady: () => { try { imp.cuePlaylist({ listType: "playlist", list: listId }); } catch { /* */ } const tryRead = (n) => { const ids = imp.getPlaylist?.(); if (ids?.length) finish(ids); else if (n > 0) setTimeout(() => tryRead(n - 1), 500); else finish(new Error(t("rd.cantRead"))); }; tryRead(16); },
        onError: () => finish(new Error(t("rd.cantRead"))),
      } });
    setTimeout(() => finish(new Error(t("rd.cantRead"))), 12000);
  });
}
async function addList(url) {
  const id = (() => { try { return new URL(url).searchParams.get("list"); } catch { return null; } })();
  if (!id) return toast(t("rd.badLink"), true);
  toast(t("rd.reading"));
  const send = (body) => fetch("/api/radio", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add_list", url, ...body }) })
    .then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));
  try {
    let r = await send({}); // the server reads the playlist itself
    if (!r.ok && r.status === 422 && r.data.fallback) { // it couldn't — let YouTube's player in this browser try
      const vids = await readPlaylist(id).catch(() => null);
      if (vids?.length) r = await send({ vids });
      else r = { ok: false, data: { error: t("rd.cantRead") } };
    }
    if (!r.ok) return notice(r.data.error || t("rd.cantRead"), { icon: "🎵" });
    toast(t("rd.added", { n: r.data.tracks }));
    poll();
  } catch (x) { toast(x.message, true); }
}

main.addEventListener("click", async (e) => {
  const q = (s) => e.target.closest(s);
  const a = q("[data-rd]")?.dataset.rd;
  if (a === "tune") { tuned = true; await ensurePlayer(); await poll(); return; }
  if (a === "leave") return leave();
  if (a === "mute") { vol = vol ? 0 : 70; player?.setVolume(vol); draw(); return; }
  if (a === "skip") { await api("/api/radio", { method: "POST", body: { action: "skip", vid: d.playing.vid } }).catch((x) => toast(x.message, true)); return poll(); }
  if (q("[data-remove]")) {
    if (!(await ask(t("rd.removeQ"), { danger: true }))) return;
    await api("/api/radio", { method: "POST", body: { action: "remove_list", list_id: q("[data-remove]").dataset.remove } }).catch((x) => toast(x.message, true));
    return poll();
  }
  if (q("[data-refresh]")) return addList(q("[data-refresh]").dataset.refresh);
  if (q("[data-qdel]")) {
    try { await api("/api/radio", { method: "POST", body: { action: "remove", id: q("[data-qdel]").dataset.qdel } }); } catch (x) { toast(x.message, true); }
    return poll();
  }
  if (q("#rd-pick")) return picker();
  if (q("[data-qadd]")) return request(q("[data-qadd]").dataset.qadd, q("[data-qadd]"));
});
main.addEventListener("submit", (e) => {
  if (e.target.id === "rd-req") { e.preventDefault(); request(e.target.url.value.trim()).then((ok) => ok && (e.target.url.value = "")); return; }
  if (e.target.id !== "rd-add") return;
  e.preventDefault();
  addList(e.target.url.value.trim());
});

// ---------- queue: add a song by link, or from your own playlists ----------
async function request(urlOrVid, btn) {
  try {
    if (btn) btn.disabled = true;
    const r = await api("/api/radio", { method: "POST", body: { action: "add", url: urlOrVid } });
    toast(t("rd.queued", { title: r.item?.title || "🎵" }));
    poll();
    return true;
  } catch (x) { toast(x.message, true); if (btn) btn.disabled = false; return false; }
}
async function picker() {
  const box = main.querySelector("#rd-picker");
  if (box.innerHTML) { box.innerHTML = ""; return; }
  box.innerHTML = `<p class="hint">${t("loading")}</p>`;
  let r;
  try { r = await api("/api/radio?mytracks=1"); } catch (x) { box.innerHTML = `<p class="hint">${esc(x.message)}</p>`; return; }
  if (!r.tracks.length) { box.innerHTML = `<p class="hint">${t("rd.noneYet")}</p>`; return; }
  box.innerHTML = `<input class="rd-search" placeholder="${esc(t("rd.search"))}"><div class="rd-pl">${r.tracks.map((x) => `
    <div class="rd-pi" data-q="${esc(((x.title || "") + " " + (x.author || "")).toLowerCase())}"><span><b>${esc(x.title || x.vid)}</b>${x.author ? ` <span class="small muted">${esc(x.author)}</span>` : ""}</span>
      <button class="small-btn" data-qadd="${esc(x.vid)}">＋</button></div>`).join("")}</div>${r.more ? `<p class="hint">${t("rd.moreTitles")}</p>` : ""}`;
  box.querySelector(".rd-search").addEventListener("input", (e) => {
    const s = e.target.value.toLowerCase();
    box.querySelectorAll(".rd-pi").forEach((el) => (el.hidden = s && !el.dataset.q.includes(s)));
  });
}
