// Moikas Wrapped: your year as swipeable story slides, then a summary image to share.
import { api, esc, t, initPage, toast } from "./common.js";

const user = await initPage();
const main = document.getElementById("main");
const q = new URLSearchParams(location.search);
const nf = (n) => Number(n || 0).toLocaleString();
const av = (u, cls = "wr-av") => `<img class="${cls}" src="${esc(u?.avatar || "")}" alt="" onerror="this.style.visibility='hidden'">`;
const hourLabel = (h) => new Date(Date.UTC(2024, 0, 1, h)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });
const PERSONA_ICON = { gamer: "🎮", social: "💬", organizer: "📣", music: "🎧", cine: "🍿", comp: "🏆", steady: "📅", squad: "🫂", rookie: "🌱" };
const BG = ["#ff5f6d,#ffc371", "#5f2c82,#49a09d", "#1d2b64,#f8cdda", "#f7971e,#ffd200", "#134e5e,#71b280", "#c94b4b,#4b134f",
  "#0f2027,#2c5364", "#ee0979,#ff6a00", "#4568dc,#b06ab3", "#11998e,#38ef7d", "#fc5c7d,#6a82fb", "#232526,#414345", "#8e2de2,#4a00e0", "#e65c00,#f9d423"];

if (!user || user.role === "pending") main.innerHTML = `<section><h1>🎁 Wrapped</h1><p class="muted">${t("lfg.emptyGuest")}</p></section>`;
else load();

async function load() {
  const d = await api(`/api/wrapped?year=${+q.get("year") || ""}&user=${+q.get("user") || ""}`).catch((x) => ({ error: x.message }));
  if (d.error) { main.innerHTML = `<section><p class="muted">${esc(d.error)}</p></section>`; return; }
  if (d.locked) {
    main.innerHTML = `<section class="wr-landing"><div class="wr-big">🎁</div><h1>Moikas Wrapped ${d.year}</h1>
      <p>${t("wr.locked", { when: new Date(d.opens_at).toLocaleDateString(undefined, { month: "long", day: "numeric" }) })}</p>
      <p class="muted" id="wr-count"></p></section>`;
    const tick = () => { const s = Math.max(0, d.opens_at - Date.now()) / 1000; main.querySelector("#wr-count").textContent = t("wr.countdown", { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60) }); };
    tick(); setInterval(tick, 30000);
    return;
  }
  const p = d.person, slides = build(p, d.group);
  main.innerHTML = `
    <section class="wr-landing">
      <div class="wr-big">🎁</div>
      <h1>Moikas Wrapped ${d.year}</h1>
      ${d.preview ? `<p class="small warn">👀 ${t("wr.preview")}</p>` : ""}
      <p>${d.mine ? t("wr.ready") : t("wr.readyOf", { name: esc(p.user.username) })}</p>
      <button class="primary wr-start" id="wr-go">▶ ${t("wr.start")}</button>
      ${d.years.length > 1 ? `<p class="small">${d.years.map((y) => `<a href="/wrapped?year=${y}" class="${y === d.year ? "active" : ""}">${y}</a>`).join(" · ")}</p>` : ""}
    </section>`;
  main.querySelector("#wr-go").onclick = () => play(slides, p, d.group);
  if (q.get("play") === "1") play(slides, p, d.group);
}

/* ---------------- slides ---------------- */

function build(p, g) {
  const S = [];
  const add = (html) => S.push(html);
  const stat = (n, label) => `<div class="wr-stat"><b>${nf(n)}</b><span>${label}</span></div>`;
  add(`<div class="wr-k">${t("wr.s.hi")}</div>${av(p.user, "wr-av big")}<h1>${esc(p.user.username)}</h1><p class="wr-sub">${t("wr.s.intro", { y: p.year })}</p>
    ${p.days ? `<p class="wr-l">${t("wr.s.days", { n: p.days })}</p>` : ""}`);
  if (p.play.hours) {
    add(`<div class="wr-k">${t("wr.s.played")}</div><div class="wr-num">${nf(p.play.hours)}</div><div class="wr-unit">${t("wr.s.hours")}</div>
      <p class="wr-l">${t("wr.s.daysStraight", { n: Math.round((p.play.hours / 24) * 10) / 10 })}</p>
      ${p.play.rank ? `<p class="wr-pill">${t("wr.s.rank", p.play.rank)}</p>` : ""}`);
    const top = p.play.games[0]?.hours || 1;
    add(`<div class="wr-k">${t("wr.s.topGames")}</div><ol class="wr-list">${p.play.games.map((x, i) => `
      <li style="--d:${i}"><span class="wr-rank">${i + 1}</span><span class="wr-name">${esc(x.game)}</span><span class="wr-bar"><i style="width:${(x.hours / top) * 100}%"></i></span><b>${x.hours} h</b></li>`).join("")}</ol>`);
  }
  if (p.play.favHour !== null) {
    const mx = Math.max(...p.play.byHour, 1), h = p.play.favHour;
    const vibe = h < 5 ? "owl" : h < 12 ? "early" : h < 18 ? "afternoon" : "night";
    add(`<div class="wr-k">${t("wr.s.when")}</div><div class="wr-num sm">${hourLabel(h)}</div><p class="wr-l">${t("wr.vibe." + vibe)}</p>
      <div class="wr-hours">${p.play.byHour.map((m, i) => `<i style="height:${4 + (m / mx) * 96}%" class="${i === h ? "on" : ""}" title="${hourLabel(i)}"></i>`).join("")}</div>
      <div class="wr-hl"><span>${hourLabel(0)}</span><span>${hourLabel(12)}</span><span>${hourLabel(23)}</span></div>`);
  }
  if (p.play.duo) add(`<div class="wr-k">${t("wr.s.duo")}</div><div class="wr-pair">${av(p.user, "wr-av big")}<span>🤝</span>${av(p.play.duo, "wr-av big")}</div>
    <h1>${esc(p.play.duo.username)}</h1><p class="wr-l">${t("wr.s.duoH", { n: p.play.duo.hours })}</p>`);
  const sq = p.squad;
  if (sq.nights || sq.joined || sq.lfg || sq.tourn || sq.compa) add(`<div class="wr-k">${t("wr.s.squad")}</div>
    <div class="wr-stats">${sq.nights ? stat(sq.nights, t("wr.st.nights")) : ""}${sq.joined ? stat(sq.joined, t("wr.st.joined")) : ""}${sq.lfg ? stat(sq.lfg, t("wr.st.lfg")) : ""}
      ${sq.hosted ? stat(sq.hosted, t("wr.st.hosted")) : ""}${sq.tourn ? stat(sq.tourn, t("wr.st.tourn")) : ""}${sq.wins ? stat(sq.wins, "🏆 " + t("wr.st.wins")) : ""}</div>
    ${sq.compa ? `<div class="wr-compa">${av(sq.compa)}<div><span class="wr-k">${t("wr.s.compa")}</span><b>${esc(sq.compa.username)}</b><span class="small">${t("wr.s.compaN", { n: sq.compa.n })}</span></div></div>` : ""}`);
  if (p.ocaso.deaths || p.ocaso.mcHours) add(`<div class="wr-k">⛏️ Ocaso</div>
    ${p.ocaso.deaths ? `<div class="wr-num">${nf(p.ocaso.deaths)}</div><div class="wr-unit">${t("wr.s.deaths")}</div><p class="wr-l">${t(p.ocaso.deaths > 20 ? "wr.s.deathsMany" : "wr.s.deathsFew")}</p>` : ""}
    ${p.ocaso.mcHours ? `<p class="wr-pill">${t("wr.s.mcHours", { n: p.ocaso.mcHours })}</p>` : ""}`);
  const mu = p.music;
  if (mu.plays) add(`<div class="wr-k">${t("wr.s.music")}</div><div class="wr-num sm">${esc(mu.artists[0].artist)}</div><p class="wr-l">${t("wr.s.topArtist", { n: mu.artists[0].n })}</p>
    <ol class="wr-list small">${mu.artists.slice(1).map((a, i) => `<li style="--d:${i}"><span class="wr-rank">${i + 2}</span><span class="wr-name">${esc(a.artist)}</span><b>${a.n}</b></li>`).join("")}</ol>
    ${mu.topSong ? `<p class="wr-pill">🔁 ${esc(mu.topSong.title)} — ${esc(mu.topSong.artist || "")}</p>` : ""}
    <p class="small">${t("wr.s.musicMore", { plays: nf(mu.plays), artists: mu.artistsN })}${mu.sameArtist ? " · " + t("wr.s.same", { n: mu.sameArtist }) : ""}</p>`);
  const mv = p.movies;
  if (mv.nights || mv.ratings || mv.jelly) add(`<div class="wr-k">${t("wr.s.movies")}</div>
    <div class="wr-stats">${mv.nights ? stat(mv.nights, t("wr.st.movieNights")) : ""}${mv.ratings ? stat(mv.ratings, t("wr.st.ratings")) : ""}${mv.jelly ? stat(mv.jelly, t("wr.st.jelly")) : ""}</div>
    ${mv.best ? `<div class="wr-movie">${mv.best.poster ? `<img src="${esc(mv.best.poster)}" alt="">` : ""}<div><span class="wr-k">${t("wr.s.bestMovie")}</span><b>${esc(mv.best.title)}</b><span>${"★".repeat(Math.round(mv.best.stars / 2))}</span></div></div>` : ""}`);
  const so = p.social;
  if (so.posts || so.comments || so.chat || so.quoted) add(`<div class="wr-k">${t("wr.s.social")}</div>
    <div class="wr-stats">${so.posts ? stat(so.posts, t("wr.st.posts")) : ""}${so.comments ? stat(so.comments, t("wr.st.comments")) : ""}${so.likes ? stat(so.likes, "❤ " + t("wr.st.likes")) : ""}${so.chat ? stat(so.chat, t("wr.st.chat")) : ""}</div>
    ${so.quote ? `<blockquote class="wr-quote">“${esc(so.quote.body)}”<span>— ${esc(p.user.username)} · ${t("wr.s.quoted", { n: so.quoted })}</span></blockquote>` : ""}`);
  const hb = p.habits;
  if (hb.daily || hb.qotd || hb.goals || hb.guess || hb.ach) add(`<div class="wr-k">${t("wr.s.habits")}</div>
    ${hb.streak ? `<div class="wr-num">🔥 ${hb.streak}</div><div class="wr-unit">${t("wr.s.streak")}</div>` : ""}
    <div class="wr-stats">${hb.daily ? stat(hb.daily, t("wr.st.daily")) : ""}${hb.qotd ? stat(hb.qotd, t("wr.st.qotd")) : ""}${hb.goals ? stat(hb.goals, t("wr.st.goals")) : ""}
      ${hb.guess ? stat(hb.guess, t("wr.st.guess")) : ""}${hb.ach ? stat(hb.ach, t("wr.st.ach")) : ""}${hb.dares ? stat(hb.dares, t("wr.st.dares")) : ""}</div>`);
  add(`<div class="wr-k">${t("wr.s.youAre")}</div><div class="wr-big">${PERSONA_ICON[p.persona]}</div><h1>${t("wr.p." + p.persona)}</h1><p class="wr-l">${t("wr.p." + p.persona + ".d")}</p>
    ${p.activityRank ? `<p class="wr-pill">${t("wr.s.activeRank", p.activityRank)}</p>` : ""}`);
  add(`<div class="wr-k">${t("wr.s.group", { y: g.year })}</div>
    <div class="wr-stats">${g.hours ? stat(g.hours, t("wr.st.groupHours")) : ""}${g.nights ? stat(g.nights, t("wr.st.nights")) : ""}${g.movieNights ? stat(g.movieNights, t("wr.st.movieNights")) : ""}
      ${g.posts ? stat(g.posts, t("wr.st.posts")) : ""}${g.chat ? stat(g.chat, t("wr.st.chat")) : ""}${g.members ? stat(g.members, t("wr.st.members")) : ""}</div>
    ${g.games[0] ? `<p class="wr-pill">🎮 ${t("wr.s.gGame", { game: esc(g.games[0].game), n: g.games[0].hours })}</p>` : ""}
    ${g.artists[0] ? `<p class="wr-pill">🎧 ${t("wr.s.gArtist", { a: esc(g.artists[0].artist), n: g.artists[0].people })}</p>` : ""}
    ${g.deaths[0] ? `<p class="wr-pill">💀 ${t("wr.s.gDeaths", { name: esc(g.deaths[0].name), n: g.deaths[0].n })}</p>` : ""}`);
  if (g.mvp.length || g.quote) add(`<div class="wr-k">${t("wr.s.mvp")}</div>
    <div class="wr-podium">${g.mvp.map((m, i) => `<div class="wr-pod p${i + 1}">${av(m)}<b>${esc(m.username)}</b><span>${["🥇", "🥈", "🥉"][i]}</span></div>`).join("")}</div>
    ${g.quote ? `<blockquote class="wr-quote"><span class="wr-k">${t("wr.s.quoteYear")}</span>“${esc(g.quote.body)}”<span>— ${esc(g.quote.username || "?")}</span></blockquote>` : ""}`);
  add(`<div class="wr-k">${t("wr.s.share")}</div><canvas id="wr-card" width="1080" height="1350"></canvas>
    <div class="wr-actions"><button class="primary" data-act="share">📤 ${t("wr.share")}</button><button class="small-btn" data-act="save">⬇ ${t("wr.download")}</button><button class="small-btn" data-act="again">↺ ${t("wr.again")}</button></div>`);
  return S;
}

/* ---------------- story player ---------------- */

function play(slides, p, g) {
  let i = 0, timer = null, paused = false;
  const stage = document.createElement("div");
  stage.className = "wr-stage";
  stage.innerHTML = `<div class="wr-bars">${slides.map(() => `<i><b></b></i>`).join("")}</div><button class="wr-x" aria-label="close">✕</button><div class="wr-slide"></div>
    <button class="wr-nav prev" aria-label="prev"></button><button class="wr-nav next" aria-label="next"></button>`;
  document.body.append(stage);
  document.body.style.overflow = "hidden";
  const box = stage.querySelector(".wr-slide"), bars = [...stage.querySelectorAll(".wr-bars b")];
  const close = () => { clearTimeout(timer); stage.remove(); document.body.style.overflow = ""; removeEventListener("keydown", key); };
  const show = (n) => {
    i = Math.max(0, Math.min(slides.length - 1, n));
    stage.style.setProperty("--bg", `linear-gradient(160deg, ${BG[i % BG.length]})`);
    box.innerHTML = `<div class="wr-in">${slides[i]}</div>`;
    bars.forEach((b, k) => { b.style.transition = "none"; b.style.width = k < i ? "100%" : "0"; });
    clearTimeout(timer);
    const last = i === slides.length - 1;
    if (!last && !paused) requestAnimationFrame(() => requestAnimationFrame(() => { bars[i].style.transition = "width 7s linear"; bars[i].style.width = "100%"; timer = setTimeout(() => show(i + 1), 7000); }));
    else bars[i].style.width = "100%";
    if (last) card(stage, p, g, close, () => show(0));
  };
  stage.querySelector(".wr-x").onclick = close;
  stage.querySelector(".prev").onclick = () => show(i - 1);
  stage.querySelector(".next").onclick = () => show(i + 1);
  const key = (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowRight") show(i + 1); if (e.key === "ArrowLeft") show(i - 1); };
  addEventListener("keydown", key);
  show(0);
}

/* ---------------- summary image ---------------- */

async function card(stage, p, g, close, again) {
  const c = stage.querySelector("#wr-card");
  if (!c) return;
  const x = c.getContext("2d"), W = 1080, Hh = 1350;
  const grd = x.createLinearGradient(0, 0, W, Hh);
  grd.addColorStop(0, "#8e2de2"); grd.addColorStop(0.55, "#4a00e0"); grd.addColorStop(1, "#ff6a00");
  x.fillStyle = grd; x.fillRect(0, 0, W, Hh);
  x.fillStyle = "rgba(255,255,255,.08)";
  for (let k = 0; k < 9; k++) { x.beginPath(); x.arc(((k * 337) % W), ((k * 571) % Hh), 60 + ((k * 41) % 160), 0, 7); x.fill(); }
  x.fillStyle = "#fff"; x.textBaseline = "top";
  x.font = "bold 40px system-ui, sans-serif"; x.fillText(`MOIKAS WRAPPED ${p.year}`, 80, 80);
  try {
    const img = await new Promise((ok, no) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = no; im.src = p.user.avatar; });
    x.save(); x.beginPath(); x.arc(160, 270, 80, 0, 7); x.clip(); x.drawImage(img, 80, 190, 160, 160); x.restore();
  } catch { /* no avatar */ }
  x.font = "bold 72px system-ui, sans-serif"; x.fillText(p.user.username.slice(0, 18), 270, 225);
  x.font = "36px system-ui, sans-serif"; x.fillText(`${PERSONA_ICON[p.persona]} ${t("wr.p." + p.persona)}`, 272, 310);
  const rows = [
    p.play.hours && [t("wr.c.hours"), `${nf(p.play.hours)} h`],
    p.play.games[0] && [t("wr.c.game"), p.play.games[0].game],
    p.play.duo && [t("wr.c.duo"), `${p.play.duo.username} · ${p.play.duo.hours} h`],
    p.music.artists[0] && [t("wr.c.artist"), p.music.artists[0].artist],
    p.movies.best && [t("wr.c.movie"), p.movies.best.title],
    p.squad.nights && [t("wr.c.nights"), String(p.squad.nights)],
    p.ocaso.deaths && [t("wr.c.deaths"), String(p.ocaso.deaths)],
    p.habits.streak && [t("wr.c.streak"), `🔥 ${p.habits.streak}`],
    p.days && [t("wr.c.days"), String(p.days)],
  ].filter(Boolean).slice(0, 7);
  let y = 450;
  for (const [k, v] of rows) {
    x.font = "30px system-ui, sans-serif"; x.globalAlpha = 0.75; x.fillText(k.toUpperCase(), 80, y);
    x.globalAlpha = 1; x.font = "bold 54px system-ui, sans-serif"; x.fillText(String(v).slice(0, 26), 80, y + 40);
    y += 120;
  }
  x.font = "30px system-ui, sans-serif"; x.globalAlpha = 0.8; x.fillText(location.host, 80, Hh - 80); x.globalAlpha = 1;
  const blob = () => new Promise((ok) => { try { c.toBlob(ok, "image/png"); } catch { ok(null); } });
  const name = `moikas-wrapped-${p.year}.png`;
  stage.querySelector("[data-act=save]").onclick = async () => {
    const b = await blob(); if (!b) return toast(t("wr.noImage"), true);
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click();
  };
  stage.querySelector("[data-act=share]").onclick = async () => {
    const b = await blob();
    const file = b && new File([b], name, { type: "image/png" });
    try {
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `Moikas Wrapped ${p.year}` });
      else if (navigator.share) await navigator.share({ title: `Moikas Wrapped ${p.year}`, url: `${location.origin}/wrapped?year=${p.year}&user=${p.user.id}` });
      else { await navigator.clipboard.writeText(`${location.origin}/wrapped?year=${p.year}&user=${p.user.id}`); toast(t("wr.copied")); }
    } catch { /* cancelled */ }
  };
  stage.querySelector("[data-act=again]").onclick = again;
  void close;
}
