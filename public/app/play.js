// "Jugar": game nights (vote), games we all own (Steam), Apex stats, free games, and linking accounts.
import { ask, notice, askText, api, esc, t, initPage, toast, ago, inputToMs, zonedNow, wallInput, msToInput } from "./common.js";
import { mountCuando } from "./cuando.js";
import { mountWheels } from "./wheels.js";

const user = await initPage();
const main = document.getElementById("main");
const q = new URLSearchParams(location.search);
const TABS = ["noches", "cuando", "adivina", "mayor", "ruleta", "ruedas", "frases", "comun", "gratis"];
if (location.hash === "#apuestas") location.replace("/casino#apuestas"); // bets moved to the Casino
if (location.hash === "#apex") location.replace("/ranking#apex"); // Apex board moved to Ranking
if (location.hash === "#cuentas") location.replace("/profile#ajustes"); // linked accounts moved to the profile settings
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : q.get("night") ? "noches" : "noches";
const fmt = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const av = (u) => `<img class="soc-av" src="${esc(u.avatar || "")}" alt="" title="${esc(u.username)}" loading="lazy" onerror="this.style.visibility='hidden'">`;
const hrs = (min) => (min >= 60 ? `${Math.round(min / 6) / 10} h` : `${min} min`);

if (!user || user.role === "pending") {
  main.innerHTML = `<section><h1>🎮 ${t("play.title")}</h1><p class="muted">${t("lfg.emptyGuest")}</p></section>`;
} else {
  frame();
  addEventListener("hashchange", () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== tab) { tab = h; frame(); } });
}

function frame() {
  main.innerHTML = `
    <section>
      <h1>🎮 ${t("play.title")}</h1>
      <div class="play-tabs">${TABS.map((k) => `<a href="#${k}" class="${k === tab ? "active" : ""}" data-tab="${k}">${t("play.tab." + k)}</a>`).join("")}</div>
      <div id="play-body"><p class="muted">${t("loading")}</p></div>
    </section>`;
  main.querySelectorAll("[data-tab]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); tab = a.dataset.tab; history.replaceState(null, "", `/play#${tab}`); frame(); }));
  const body = main.querySelector("#play-body");
  ({ noches: nights, cuando: (b) => mountCuando(b, user), adivina: guess, mayor: hilo, ruleta: dares, ruedas: (b) => mountWheels(b, user), frases: quotes, comun: common, gratis: free })[tab](body).catch((x) => (body.innerHTML = `<p class="muted">${esc(x.message)}</p>`));
}

/* ---------------- Game nights ---------------- */

async function nights(el) {
  const { nights } = await api("/api/nights");
  const focus = +q.get("night") || null;
  el.innerHTML = `
    <div class="section-head"><p class="muted" style="margin:0">${t("gn.intro")}</p><button class="primary" id="gn-new">+ ${t("gn.new")}</button></div>
    <div id="gn-form"></div>
    <div class="gn-list">${nights.map((n) => nightCard(n, n.id === focus)).join("") || `<p class="muted">${t("gn.none")}</p>`}</div>`;
  el.querySelector("#gn-new").onclick = () => nightForm(el.querySelector("#gn-form"));
  el.querySelectorAll("[data-vote]").forEach((b) => (b.onclick = () => nightAct(b.dataset.n, { action: "vote", option_id: +b.dataset.vote }, el)));
  el.querySelectorAll("[data-rsvp]").forEach((b) => (b.onclick = () => nightAct(b.dataset.n, { action: "rsvp", status: b.dataset.rsvp }, el)));
  el.querySelectorAll("[data-lock]").forEach((b) => (b.onclick = async () => await ask(t("gn.lockQ")) && nightAct(b.dataset.lock, { action: "lock" }, el)));
  el.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = async () => await ask(t("gn.cancelQ")) && nightAct(b.dataset.cancel, { action: "cancel" }, el)));
  if (focus) el.querySelector(`#gn-${focus}`)?.scrollIntoView({ block: "center" });
  const pre = +q.get("time");
  if (pre > Date.now() - 3600000) { // from "¿Cuándo pueden?": open the form with that time
    nightForm(el.querySelector("#gn-form"));
    const first = el.querySelector("#gn-times input");
    if (first) { first.value = msToInput(pre); first.nextElementSibling?.remove(); }
    history.replaceState(null, "", "/play#noches");
  }
  el.querySelectorAll("[data-tabgo]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); tab = a.dataset.tabgo; history.replaceState(null, "", `/play#${tab}`); frame(); }));
}

async function nightAct(id, body, el) {
  try { await api(`/api/nights/${id}`, { method: "POST", body }); await nights(el); } catch (x) { toast(x.message, true); }
}

function nightCard(n, focus) {
  const games = n.options.filter((o) => o.kind === "game"), times = n.options.filter((o) => o.kind === "time");
  const max = (list) => Math.max(1, ...list.map((o) => o.votes.length));
  const opt = (o, label) => `
    <button class="gn-opt ${o.mine ? "mine" : ""}" data-vote="${o.id}" data-n="${n.id}" ${n.status !== "voting" ? "disabled" : ""}>
      <span class="gn-fill" style="width:${(o.votes.length / max(o.kind === "game" ? games : times)) * 100}%"></span>
      <span class="gn-lbl">${o.mine ? "✓ " : ""}${label}</span><span class="gn-avs">${o.votes.slice(0, 5).map(av).join("")}</span><b>${o.votes.length}</b>
    </button>`;
  const yes = n.rsvp.filter((r) => r.status === "yes"), maybe = n.rsvp.filter((r) => r.status === "maybe");
  const status = n.status === "voting" ? `🗳️ ${t("gn.voting", { when: fmt(n.vote_until) })}`
    : n.status === "locked" ? `🎉 ${esc(n.game)} · ${fmt(n.starts_at)}` : n.status === "done" ? `🏁 ${t("gn.done")}` : `✖ ${t("gn.cancelled")}`;
  return `
    <div class="card gn ${focus ? "focus" : ""} gn-${n.status}" id="gn-${n.id}">
      <div class="gn-head"><div><b>${esc(n.title)}</b> <span class="small muted">· ${t("lfg.by", { name: esc(n.host_name) })}</span>
        <div class="small">${status}</div>${n.note ? `<div class="small muted">${esc(n.note)}</div>` : ""}</div>
        <div class="gn-boss">${n.status === "voting" && (n.mine || ["staff", "subadmin", "admin"].includes(user.role)) ? `<button class="small-btn" data-lock="${n.id}">${t("gn.lock")}</button>` : ""}
          ${["voting", "locked"].includes(n.status) && (n.mine || ["staff", "subadmin", "admin"].includes(user.role)) ? `<button class="small-btn danger" data-cancel="${n.id}">${t("gn.cancel")}</button>` : ""}</div></div>
      ${n.status === "voting" ? `
        <div class="gn-cols"><div><div class="small muted">${t("gn.whatGame")}</div>${games.map((o) => opt(o, esc(o.label))).join("")}</div>
          <div><div class="small muted">${t("gn.when")}</div>${times.map((o) => opt(o, esc(fmt(o.value)))).join("")}</div></div>
        <p class="hint">${t("gn.voteHint")} · <a href="/casino#apuestas">🪙 ${t("mk.betOnIt")}</a></p>` : ""}
      ${n.status === "locked" ? `
        <div class="gn-rsvp">
          ${["yes", "maybe", "no"].map((s) => `<button class="${n.my_rsvp === s ? "primary" : "small-btn"}" data-rsvp="${s}" data-n="${n.id}">${t("gn.rsvp." + s)}</button>`).join("")}
          <span class="small">${t("gn.going", { n: yes.length })} ${yes.map(av).join("")}${maybe.length ? ` · ${t("gn.maybe", { n: maybe.length })}` : ""}</span>
        </div>
        <p class="hint">${t("gn.coinsHint", { game: esc(n.game) })}</p>` : ""}
      ${n.status === "done" ? `<p class="small">${t("gn.showedUp")}: ${n.rsvp.filter((r) => r.attended).map((r) => `${av(r)} ${esc(r.username)}`).join(" · ") || "—"}</p>` : ""}
    </div>`;
}

function nightForm(box) {
  if (box.innerHTML) { box.innerHTML = ""; return; }
  // defaults: next Friday and Saturday 9 pm in your time zone
  const n = zonedNow(), ahead = (5 - n.dow + 7) % 7 || 7;
  const fri = wallInput(n.y, n.mo, n.d + ahead, 21), sat = wallInput(n.y, n.mo, n.d + ahead + 1, 21);
  const local = (x) => x;
  const PRESETS = ["Apex Legends", "League of Legends", "Sons of the Forest", "Minecraft (Ocaso)", "Fortnite", "Marvel Rivals", "Valorant"];
  box.innerHTML = `
    <form class="card lfg-form">
      <label>${t("gn.fTitle")}<input name="title" maxlength="80" value="${esc(t("gn.defaultTitle"))}"></label>
      <div><div class="small">${t("gn.fGames")}</div>
        <div class="lfg-quick">${PRESETS.map((g) => `<button type="button" class="chip" data-g="${esc(g)}">${esc(g)}</button>`).join("")}</div>
        <div class="gn-chosen" id="gn-games"></div>
        <div class="lfg-row"><input id="gn-other" maxlength="60" placeholder="${esc(t("gn.otherGame"))}"><button type="button" class="small-btn" id="gn-add-g">+</button></div></div>
      <div><div class="small">${t("gn.fTimes")}</div>
        <div id="gn-times"><input type="datetime-local" value="${local(fri)}"><input type="datetime-local" value="${local(sat)}"></div>
        <button type="button" class="small-btn" id="gn-add-t">+ ${t("gn.addTime")}</button></div>
      <label>${t("lfg.note")}<input name="note" maxlength="300"></label>
      <div class="lfg-row"><button class="primary">${t("gn.create")}</button><span class="hint">${t("gn.createHint")}</span></div>
    </form>`;
  const chosen = new Set();
  const draw = () => (box.querySelector("#gn-games").innerHTML = [...chosen].map((g) => `<span class="chip on">${esc(g)} <a href="#" data-rm="${esc(g)}">✕</a></span>`).join("") || `<span class="hint">${t("gn.pickGames")}</span>`);
  box.querySelector("#gn-games").onclick = (e) => { const g = e.target.dataset?.rm; if (g) { e.preventDefault(); chosen.delete(g); draw(); } };
  box.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => { chosen.add(b.dataset.g); draw(); }));
  box.querySelector("#gn-add-g").onclick = () => { const v = box.querySelector("#gn-other").value.trim(); if (v) { chosen.add(v); box.querySelector("#gn-other").value = ""; draw(); } };
  box.querySelector("#gn-add-t").onclick = () => box.querySelector("#gn-times").insertAdjacentHTML("beforeend", `<input type="datetime-local">`);
  draw();
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const times = [...box.querySelectorAll("#gn-times input")].map((i) => (i.value ? inputToMs(i.value) : null)).filter((x) => x && !isNaN(x));
    try {
      await api("/api/nights", { method: "POST", body: { title: f.title.value, note: f.note.value, games: [...chosen], times } });
      toast(t("gn.created")); box.innerHTML = ""; await nights(box.closest("#play-body"));
    } catch (x) { toast(x.message, true); }
  };
}

/* ---------------- Games we all own (Steam) ---------------- */

async function common(el) {
  const d = await api("/api/steam");
  if (!d.configured) { el.innerHTML = `<p class="muted">${t("play.noSteamKey")}</p>`; return; }
  const linked = d.people.filter((p) => p.public);
  const pick = new Set(linked.map((p) => p.user_id));
  el.innerHTML = `
    ${!d.me ? `<div class="card play-cta">🔗 ${t("play.linkSteamCta")} <a class="primary btn" href="/api/steam/link">${t("play.linkSteam")}</a></div>` : ""}
    <p class="muted">${t("sg.intro")}</p>
    <div class="st-people">${d.people.map((p) => `
      <label class="st-person ${p.public ? "" : "off"}" title="${p.public ? "" : esc(t("sg.private"))}">
        <input type="checkbox" value="${p.user_id}" ${p.public ? "checked" : "disabled"}> ${av(p)} ${esc(p.username)}
        <span class="small muted">${p.public ? t("sg.nGames", { n: p.game_count }) : "🔒"}</span></label>`).join("") || `<p class="muted">${t("sg.nobody")}</p>`}</div>
    <label class="small"><input type="checkbox" id="st-mp" checked> ${t("sg.onlyMp")}</label>
    <div id="st-games"></div>
    ${d.people.some((p) => p.recent.length) ? `<h3>${t("sg.recent")}</h3><div class="st-recent">${d.people.filter((p) => p.recent.length).map((p) => `
      <div class="card st-r"><div>${av(p)} <b>${esc(p.username)}</b></div>${p.recent.map((g) => `<div class="small">🎮 ${esc(g.name || g.appid)} <span class="muted">· ${hrs(g.playtime_2w)} ${t("sg.last2w")}</span></div>`).join("")}</div>`).join("")}</div>` : ""}`;
  const run = async () => {
    const ids = [...el.querySelectorAll(".st-person input:checked")].map((i) => i.value);
    const box = el.querySelector("#st-games");
    if (ids.length < 2) { box.innerHTML = `<p class="hint">${t("sg.pick2")}</p>`; return; }
    box.innerHTML = `<p class="muted">${t("loading")}</p>`;
    const r = await api(`/api/steam?common=${ids.join(",")}`);
    const only = el.querySelector("#st-mp").checked;
    const games = r.games.filter((g) => !only || g.multiplayer !== 0);
    box.innerHTML = `<h3>${t("sg.allOwn", { n: games.length, p: ids.length })}</h3>
      <div class="st-grid">${games.map((g) => `
        <a class="card st-game" href="https://store.steampowered.com/app/${g.appid}" target="_blank" rel="noopener">
          <img src="${esc(g.img)}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div><b>${esc(g.name || g.appid)}</b><div class="small muted">${t("sg.together", { h: hrs(g.total) })}${g.recent ? ` · 🔥 ${hrs(g.recent)} ${t("sg.last2w")}` : ""}${g.multiplayer === 1 ? " · 👥" : ""}</div></div>
        </a>`).join("") || `<p class="muted">${t("sg.none")}</p>`}</div>`;
  };
  el.querySelectorAll(".st-person input, #st-mp").forEach((i) => (i.onchange = run));
  void pick;
  await run();
}

/* ---------------- Apex ---------------- */

/* ---------------- Free games ---------------- */

function freeCard(g) {
  return `<a class="card fg" href="${esc(g.url)}" target="_blank" rel="noopener">
    ${g.img ? `<img src="${esc(g.img)}" alt="" loading="lazy">` : ""}
    <div class="fg-info"><b>${esc(g.title)}</b>
      <div class="small"><span class="fg-store">${esc(g.store)}</span> ${g.upcoming ? `· ${t("fg.from", { when: fmt(g.starts) })}` : g.ends ? `· ${t("fg.until", { when: fmt(g.ends) })}` : ""}${g.worth ? ` · <s class="muted">${esc(g.worth)}</s>` : ""}</div></div></a>`;
}

async function free(el) {
  const { games } = await api("/api/freegames");
  const now = games.filter((g) => !g.upcoming), next = games.filter((g) => g.upcoming);
  el.innerHTML = `<p class="muted">${t("fg.intro")}</p>
    <div class="fg-grid">${now.map(freeCard).join("") || `<p class="muted">${t("fg.none")}</p>`}</div>
    ${next.length ? `<h3>${t("fg.next")}</h3><div class="fg-grid">${next.map(freeCard).join("")}</div>` : ""}`;
}

/* ---------------- Accounts ---------------- */



/* ---------------- Adivina el juego ---------------- */

async function guess(el) {
  const render = (d) => {
    const n = d.guesses.length;
    const step = d.done ? 6 : n; // 0..6 → blur and zoom shrink with every guess
    const blur = [26, 18, 12, 8, 5, 2, 0][step], zoom = [3.2, 2.6, 2.1, 1.7, 1.4, 1.15, 1][step];
    const cells = Array.from({ length: d.max }, (_, i) => {
      const g = d.guesses[i];
      if (g == null) return `<span class="gg-cell"></span>`;
      const ok = d.solved && i === n - 1;
      return `<span class="gg-cell ${ok ? "ok" : "bad"}" title="${esc(g)}">${ok ? "🟩" : g === "—" ? "⬛" : "🟥"}</span>`;
    }).join("");
    const share = `🎮 Adivina el juego ${d.day}: ${d.solved ? n : "X"}/${d.max}\n${d.guesses.map((g, i) => (d.solved && i === n - 1 ? "🟩" : g === "—" ? "⬛" : "🟥")).join("")}\nplay.moikas.cc/play#adivina`;
    el.innerHTML = `
      <p class="muted">${t("gg.intro", { max: d.max })}</p>
      <div class="gg-wrap">
        <div class="gg-frame"><img src="/api/guess/img?d=${d.day}" alt="" style="filter: blur(${blur}px); transform: scale(${zoom})"></div>
        <div class="gg-side">
          <div class="gg-cells">${cells}</div>
          ${d.done ? `
            <div class="card gg-result ${d.solved ? "win" : ""}">
              <b>${d.solved ? t("gg.win", { n, coins: d.coins }) : t("gg.lose")}</b>
              <div>${t("gg.answer")}: <a href="https://store.steampowered.com/app/${d.answer.appid}" target="_blank" rel="noopener">${esc(d.answer.name)}</a></div>
              <button class="small-btn" id="gg-share">📋 ${t("gg.share")}</button>
              <div class="hint">${t("gg.tomorrow")}</div>
            </div>` : `
            <form id="gg-form" class="lfg-row">
              <input name="g" list="gg-names" autocomplete="off" placeholder="${esc(t("gg.ph"))}" required>
              <datalist id="gg-names">${d.names.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
              <button class="primary">${t("gg.try")}</button>
              <button type="button" class="small-btn" id="gg-skip">${t("gg.skip")}</button>
            </form>
            <div class="hint">${t("gg.reward", { coins: d.rewards[n] })}</div>
            ${d.guesses.filter((g) => g !== "—").length ? `<div class="small muted">${t("gg.tried")}: ${d.guesses.filter((g) => g !== "—").map(esc).join(", ")}</div>` : ""}`}
          ${d.board.length ? `<h3>${t("gg.today")}</h3><ol class="gg-board">${d.board.map((b) => `<li>${av(b)} ${esc(b.username)} <span class="muted">${b.solved ? `${b.n}/${d.max}` : "X"}</span></li>`).join("")}</ol>` : ""}
        </div>
      </div>`;
    const f = el.querySelector("#gg-form");
    const send = async (payload) => {
      try { const r = await api("/api/guess", { method: "POST", body: payload }); if (!r.right && !r.done && payload.guess) toast(t("gg.nope"), true); if (r.right) toast(t("gg.win", { n: r.guesses.length, coins: r.coins })); render(r); }
      catch (x) { toast(x.message, true); }
    };
    if (f) { f.onsubmit = (e) => { e.preventDefault(); send({ guess: f.g.value }); }; f.g.focus(); }
    el.querySelector("#gg-skip")?.addEventListener("click", () => send({ skip: true }));
    el.querySelector("#gg-share")?.addEventListener("click", () => { navigator.clipboard?.writeText(share); toast(t("gg.copied")); });
  };
  render(await api("/api/guess"));
}

/* ---------------- Apuestas (predictions) ---------------- */


/* ---------------- Frases célebres ---------------- */

async function quotes(el, sort = "top") {
  const { quotes } = await api(`/api/quotes?sort=${sort}`);
  el.innerHTML = `
    <div class="section-head"><p class="muted" style="margin:0">${t("qt.intro")}</p>
      <span><button class="small-btn ${sort === "top" ? "primary" : ""}" data-sort="top">${t("qt.top")}</button> <button class="small-btn ${sort === "new" ? "primary" : ""}" data-sort="new">${t("qt.new")}</button></span></div>
    <div class="qt-list">${quotes.map((q) => `
      <figure class="card qt">
        <blockquote>“${esc(q.body)}”</blockquote>
        <figcaption>${q.author ? `${av({ username: q.author, avatar: q.author_avatar })} <b>${esc(q.author)}</b>` : "?"} <span class="small muted">· ${esc(new Date(q.said_at).toLocaleDateString())}${q.saved_by ? ` · ${t("qt.savedBy", { name: esc(q.saved_by) })}` : ""}</span></figcaption>
        <button class="qt-vote ${q.mine ? "on" : ""}" data-vote="${q.id}">⭐ ${q.votes}</button>
      </figure>`).join("") || `<p class="muted">${t("qt.none")}</p>`}</div>`;
  el.querySelectorAll("[data-sort]").forEach((b) => (b.onclick = () => quotes(el, b.dataset.sort)));
  el.querySelectorAll("[data-vote]").forEach((b) => (b.onclick = async () => {
    try { await api(`/api/quotes/${b.dataset.vote}`, { method: "POST", body: { action: "vote" } }); quotes(el, sort); } catch (x) { toast(x.message, true); }
  }));
}


/* ---------------- Mayor o menor ---------------- */

async function hilo(el, mode = null) {
  const render = (d, flash = null) => {
    const r = d.run;
    const modeNow = mode || r?.mode || (d.group_ready ? "grupo" : "steam");
    const modes = `<div class="hl-modes">
      <button class="${modeNow === "grupo" ? "primary" : "small-btn"}" data-mode="grupo" ${d.group_ready ? "" : "disabled title=\"" + esc(t("hl.needSteam")) + "\""}>👥 ${t("hl.grupo")}</button>
      <button class="${modeNow === "steam" ? "primary" : "small-btn"}" data-mode="steam">🌍 ${t("hl.steam")}</button></div>`;
    const card = (x, side) => `
      <div class="hl-card">
        <img src="${esc(x.img)}" alt="" onerror="this.style.opacity=0">
        <b>${esc(x.name)}</b>
        ${x.label ? `<span class="hl-val">${esc(x.label)}</span>` : side === "b" && r && !r.done ? `
          <div class="hl-btns"><button class="primary" data-g="higher">▲ ${t("hl.higher")}</button><button class="primary" data-g="lower">▼ ${t("hl.lower")}</button></div>` : ""}
      </div>`;
    el.innerHTML = `
      <p class="muted">${t("hl.intro." + modeNow)}</p>
      ${modes}
      ${r && r.mode === modeNow ? `
        <div class="hl-head"><b>🔥 ${t("hl.streak", { n: r.streak })}</b><span class="small muted">${t("hl.best", { n: d.best[modeNow] || 0 })} · 🪙 ${d.coins_today}/${d.cap} ${t("hl.today")}</span></div>
        ${flash ? `<div class="hl-flash ${flash.right ? "ok" : "bad"}">${flash.right ? "✅" : "❌"} ${esc(flash.text)}</div>` : ""}
        <div class="hl-pair">${card(r.a, "a")}<span class="hl-vs">${t("hl.vs")}</span>${card(r.b, "b")}</div>
        ${r.done ? `<div class="lfg-row" style="justify-content:center"><b>${t("hl.over", { n: r.streak })}</b><button class="primary" data-start>${t("hl.again")}</button></div>` : ""}`
      : `<div class="lfg-row"><button class="primary" data-start>${t("hl.play")}</button></div>`}
      ${d.board.length ? `<h3>${t("hl.board")}</h3><ol class="gg-board">${d.board.filter((b) => b.mode === modeNow).map((b) => `<li>${av(b)} ${esc(b.username)} <b>${b.best}</b></li>`).join("")}</ol>` : ""}`;
    el.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { mode = b.dataset.mode; render(d); }));
    el.querySelectorAll("[data-start]").forEach((b) => (b.onclick = async () => {
      try { render(await api("/api/hilo", { method: "POST", body: { action: "start", mode: modeNow } })); } catch (x) { toast(x.message, true); }
    }));
    el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = async () => {
      el.querySelectorAll("[data-g]").forEach((x) => (x.disabled = true));
      try {
        const res = await api("/api/hilo", { method: "POST", body: { action: "guess", choice: b.dataset.g } });
        render(res, { right: res.right, text: `${r.b.name}: ${res.revealed.label}` });
      } catch (x) { toast(x.message, true); }
    }));
  };
  render(await api("/api/hilo"));
}

/* ---------------- Ruleta de castigos ---------------- */

async function dares(el) {
  const d = await api("/api/dares");
  const lv = (n) => `<span class="dr-lv dr-lv${n}">${esc(d.levels[n].name)} · 🪙 ${d.levels[n].coins}</span>`;
  const allOpen = el.querySelector(".dr-all")?.open, addOpen = el.querySelector(".dr-add")?.open;
  el.innerHTML = `
    <p class="muted">${t("dr.intro")}</p>
    <div class="card dr-spin">
      <div class="dr-wheel" id="dr-wheel">🎡</div>
      <div class="dr-main">
        <label>${t("dr.game")}<select id="dr-game">${d.games.map((g) => `<option>${esc(g)}</option>`).join("")}</select></label>
        <div id="dr-mine">${d.mine ? `
          <div class="dr-card"><div class="small muted">${esc(d.mine.game)} ${lv(d.mine.level)}</div><b>${esc(d.mine.text)}</b>
            ${d.mine.status === "active" ? `<div class="lfg-row"><button class="primary" data-act="done" data-id="${d.mine.id}">✅ ${t("dr.did")}</button><button class="small-btn" data-act="give_up" data-id="${d.mine.id}">${t("dr.giveUp")}</button></div>
              <div class="hint">${t("dr.expires", { when: esc(new Date(d.mine.expires_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })) })}</div>`
            : `<div class="hint">⏳ ${t("dr.waiting")}</div>`}
          </div>` : `
          <div class="lfg-row"><button class="primary" id="dr-go">🎡 ${t("dr.spin")}</button><button class="small-btn" id="dr-group">👥 ${t("dr.spinGroup")}</button></div>
          <div class="hint">${t("dr.how")}</div>`}</div>
      </div>
    </div>
    ${d.pending.length ? `<h3>🤨 ${t("dr.confirmTitle")}</h3><div class="dr-list">${d.pending.map((x) => `
      <div class="card dr-item">${av(x)} <div><b>${esc(x.username)}</b> ${lv(x.level)}<div class="small">${esc(x.text)}</div></div>
        <span><button class="primary small-btn" data-act="confirm" data-id="${x.id}">✅ ${t("dr.yes")}</button> <button class="small-btn" data-act="deny" data-id="${x.id}">❌ ${t("dr.no")}</button></span></div>`).join("")}</div>` : ""}
    ${d.recent.length ? `<h3>${t("dr.recent")}</h3><div class="dr-list">${d.recent.map((x) => `
      <div class="dr-item small">${x.status === "group" ? "👥" : "✅"} <b>${esc(x.username || "?")}</b> · ${esc(x.game)} — ${esc(x.text)}${x.coins ? ` <span class="lfg-ok">+🪙 ${x.coins}</span>` : ""}${x.confirmer ? ` <span class="muted">(${t("dr.confirmedBy", { name: esc(x.confirmer) })})</span>` : ""}</div>`).join("")}</div>` : ""}
    <details class="card dr-add" ${addOpen ? "open" : ""}><summary>➕ ${t("dr.addTitle")}</summary>
      <form id="dr-addf" class="dr-addf">
        <label>${t("dr.game")}<input name="game" list="dr-games" maxlength="40" required><datalist id="dr-games">${d.games.map((g) => `<option value="${esc(g)}">`).join("")}</datalist></label>
        <label>${t("dr.level")}<select name="level">${[1, 2, 3].map((n) => `<option value="${n}">${esc(d.levels[n].name)} · 🪙 ${d.levels[n].coins}</option>`).join("")}</select></label>
        <label class="dr-addtext">${t("dr.text")}<input name="text" maxlength="200" minlength="6" required placeholder="${esc(t("dr.textPh"))}"></label>
        <button class="primary">${t("dr.add")}</button>
      </form>
      <div class="hint">${t(d.staff ? "dr.addHintStaff" : "dr.addHint")}</div>
    </details>
    <details class="dr-all" ${allOpen ? "open" : ""}><summary class="small">${t("dr.seeAll")}</summary>${Object.entries(d.all).map(([g, list]) => `<h4>${esc(g)}</h4><ul class="small">${list.map((x) => {
      const can = x.id ? (x.by === d.me || d.staff) : d.staff;
      return `<li>${lv(x.level)} ${esc(x.text)}${x.author ? ` <span class="muted">· ${esc(x.author)}</span>` : ""}${can ? ` <button class="link dr-del" data-del="${x.id || ""}" data-game="${esc(g)}" data-text="${esc(x.text)}" title="${esc(t("dr.remove"))}">✕</button>` : ""}</li>`;
    }).join("")}</ul>`).join("")}</details>`;
  const addf = el.querySelector("#dr-addf"), sel = el.querySelector("#dr-game");
  addf.game.value = sel.value;
  sel.addEventListener("change", () => { addf.game.value = sel.value; });
  el.querySelector("#dr-addf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await api("/api/dares", { method: "POST", body: { action: "add", game: f.game.value.trim(), level: +f.level.value, text: f.text.value.trim() } }); toast(t("dr.added")); dares(el); }
    catch (x) { toast(x.message, true); }
  });
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!await ask(t("dr.removeQ"), { danger: true })) return;
    try { await api("/api/dares", { method: "POST", body: { action: "remove", id: +b.dataset.del || undefined, game: b.dataset.game, text: b.dataset.text } }); dares(el); }
    catch (x) { toast(x.message, true); }
  }));

  const spinAnim = async (wheel) => { wheel.classList.add("spinning"); await new Promise((ok) => setTimeout(ok, 1600)); wheel.classList.remove("spinning"); };
  el.querySelector("#dr-go")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    const game = el.querySelector("#dr-game").value;
    try { const p = api("/api/dares", { method: "POST", body: { action: "spin", game } }); await spinAnim(el.querySelector("#dr-wheel")); await p; dares(el); }
    catch (x) { toast(x.message, true); dares(el); }
  });
  el.querySelector("#dr-group")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    const game = el.querySelector("#dr-game").value;
    try { const p = api("/api/dares", { method: "POST", body: { action: "group", game } }); await spinAnim(el.querySelector("#dr-wheel")); const r = await p; toast(t("dr.groupPosted")); notice(`🎡 ${r.game}\n\n${r.text}`); dares(el); }
    catch (x) { toast(x.message, true); dares(el); }
  });
  el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.act === "give_up" && !await ask(t("dr.giveUpQ"))) return;
    try { await api(`/api/dares/${b.dataset.id}`, { method: "POST", body: { action: b.dataset.act } }); dares(el); } catch (x) { toast(x.message, true); }
  }));
}
