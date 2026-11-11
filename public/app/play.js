// "Jugar": game nights (vote), games we all own (Steam), Apex stats, free games, and linking accounts.
import { api, esc, t, initPage, toast, ago } from "./common.js";

const user = await initPage();
const main = document.getElementById("main");
const q = new URLSearchParams(location.search);
const TABS = ["noches", "comun", "apex", "gratis", "cuentas"];
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : q.get("night") ? "noches" : "noches";
const fmt = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const av = (u) => `<img class="soc-av" src="${esc(u.avatar || "")}" alt="" title="${esc(u.username)}" loading="lazy" onerror="this.style.visibility='hidden'">`;
const hrs = (min) => (min >= 60 ? `${Math.round(min / 6) / 10} h` : `${min} min`);

if (!user || user.role === "pending") {
  main.innerHTML = `<section><h1>🎮 ${t("play.title")}</h1><p class="muted">${t("lfg.emptyGuest")}</p></section>`;
} else {
  if (q.get("steam")) toast(t("play.steam." + q.get("steam")), q.get("steam") !== "ok");
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
  ({ noches: nights, comun: common, apex, gratis: free, cuentas: accounts })[tab](body).catch((x) => (body.innerHTML = `<p class="muted">${esc(x.message)}</p>`));
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
  el.querySelectorAll("[data-lock]").forEach((b) => (b.onclick = () => confirm(t("gn.lockQ")) && nightAct(b.dataset.lock, { action: "lock" }, el)));
  el.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => confirm(t("gn.cancelQ")) && nightAct(b.dataset.cancel, { action: "cancel" }, el)));
  if (focus) el.querySelector(`#gn-${focus}`)?.scrollIntoView({ block: "center" });
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
        <p class="hint">${t("gn.voteHint")}</p>` : ""}
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
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const fri = new Date(); fri.setDate(fri.getDate() + ((5 - fri.getDay() + 7) % 7 || 7)); fri.setHours(21, 0, 0, 0);
  const sat = new Date(fri); sat.setDate(fri.getDate() + 1);
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
    const times = [...box.querySelectorAll("#gn-times input")].map((i) => (i.value ? new Date(i.value).getTime() : null)).filter(Boolean);
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
    <p class="muted">${t("st.intro")}</p>
    <div class="st-people">${d.people.map((p) => `
      <label class="st-person ${p.public ? "" : "off"}" title="${p.public ? "" : esc(t("st.private"))}">
        <input type="checkbox" value="${p.user_id}" ${p.public ? "checked" : "disabled"}> ${av(p)} ${esc(p.username)}
        <span class="small muted">${p.public ? t("st.nGames", { n: p.game_count }) : "🔒"}</span></label>`).join("") || `<p class="muted">${t("st.nobody")}</p>`}</div>
    <label class="small"><input type="checkbox" id="st-mp" checked> ${t("st.onlyMp")}</label>
    <div id="st-games"></div>
    ${d.people.some((p) => p.recent.length) ? `<h3>${t("st.recent")}</h3><div class="st-recent">${d.people.filter((p) => p.recent.length).map((p) => `
      <div class="card st-r"><div>${av(p)} <b>${esc(p.username)}</b></div>${p.recent.map((g) => `<div class="small">🎮 ${esc(g.name || g.appid)} <span class="muted">· ${hrs(g.playtime_2w)} ${t("st.last2w")}</span></div>`).join("")}</div>`).join("")}</div>` : ""}`;
  const run = async () => {
    const ids = [...el.querySelectorAll(".st-person input:checked")].map((i) => i.value);
    const box = el.querySelector("#st-games");
    if (ids.length < 2) { box.innerHTML = `<p class="hint">${t("st.pick2")}</p>`; return; }
    box.innerHTML = `<p class="muted">${t("loading")}</p>`;
    const r = await api(`/api/steam?common=${ids.join(",")}`);
    const only = el.querySelector("#st-mp").checked;
    const games = r.games.filter((g) => !only || g.multiplayer !== 0);
    box.innerHTML = `<h3>${t("st.allOwn", { n: games.length, p: ids.length })}</h3>
      <div class="st-grid">${games.map((g) => `
        <a class="card st-game" href="https://store.steampowered.com/app/${g.appid}" target="_blank" rel="noopener">
          <img src="${esc(g.img)}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div><b>${esc(g.name || g.appid)}</b><div class="small muted">${t("st.together", { h: hrs(g.total) })}${g.recent ? ` · 🔥 ${hrs(g.recent)} ${t("st.last2w")}` : ""}${g.multiplayer === 1 ? " · 👥" : ""}</div></div>
        </a>`).join("") || `<p class="muted">${t("st.none")}</p>`}</div>`;
  };
  el.querySelectorAll(".st-person input, #st-mp").forEach((i) => (i.onchange = run));
  void pick;
  await run();
}

/* ---------------- Apex ---------------- */

async function apex(el) {
  const d = await api("/api/apex");
  if (!d.configured) { el.innerHTML = `<p class="muted">${t("play.noApexKey")}</p>`; return; }
  const mine = d.players.find((p) => p.mine);
  const weekly = [...d.players].filter((p) => p.week_rp != null).sort((a, b) => b.week_rp - a.week_rp);
  el.innerHTML = `
    ${!mine ? `<div class="card play-cta">🎯 ${t("ap.linkCta")} <a class="primary btn" href="#cuentas" data-go="cuentas">${t("ap.link")}</a></div>` : ""}
    <div class="ap-grid">${d.players.map((p, i) => `
      <div class="card ap-card ${p.mine ? "mine" : ""}">
        <div class="ap-top"><span class="ap-pos">#${i + 1}</span>
          ${p.rank?.img ? `<img class="ap-rank" src="${esc(p.rank.img)}" alt="" loading="lazy">` : ""}
          <div><b>${esc(p.username)}</b> <span class="small muted">${esc(p.apex_name)} · ${esc(p.platform)}</span>
            <div class="small">${p.rank?.name ? `${esc(p.rank.name)} ${p.rank.div || ""} · <b>${p.rank.score ?? "?"} RP</b>` : t("ap.unranked")}${p.rank?.pred ? ` · 🔺 Pred #${p.rank.pred}` : ""}</div></div></div>
        <div class="ap-stats small">
          <span>⭐ ${t("ap.level")} ${p.level ?? "?"}</span>
          ${p.legend ? `<span>🧑‍🚀 ${esc(p.legend)}</span>` : ""}
          ${p.week_rp != null ? `<span class="${p.week_rp >= 0 ? "lfg-ok" : "bad"}">${p.week_rp >= 0 ? "▲" : "▼"} ${Math.abs(p.week_rp)} RP ${t("ap.thisWeek")}</span>` : ""}
          ${p.week_kills ? `<span>💀 ${p.week_kills} ${t("ap.killsWeek")}</span>` : ""}
          ${p.online ? `<span class="lfg-ok">🟢 ${esc(p.state || t("ap.online"))}</span>` : ""}
        </div>
        ${p.trackers?.length ? `<div class="ap-trk small muted">${p.trackers.map((x) => `${esc(x.name)}: <b>${x.value}</b>`).join(" · ")}</div>` : ""}
        ${p.error ? `<div class="hint">⚠ ${esc(p.error)}</div>` : `<div class="hint">${t("ap.updated", { ago: ago(p.updated_at) })}</div>`}
      </div>`).join("") || `<p class="muted">${t("ap.none")}</p>`}</div>
    ${weekly.length > 1 ? `<h3>📈 ${t("ap.weekBoard")}</h3><div class="card"><ol class="ap-week">${weekly.map((p) => `<li>${av(p)} <b>${esc(p.username)}</b> <span class="${p.week_rp >= 0 ? "lfg-ok" : "bad"}">${p.week_rp >= 0 ? "+" : ""}${p.week_rp} RP</span></li>`).join("")}</ol></div>` : ""}`;
  el.querySelector("[data-go]")?.addEventListener("click", (e) => { e.preventDefault(); tab = "cuentas"; history.replaceState(null, "", "/play#cuentas"); frame(); });
}

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

async function accounts(el) {
  const [s, a] = await Promise.all([api("/api/steam"), api("/api/apex")]);
  const ap = a.players.find((p) => p.mine);
  el.innerHTML = `
    <div class="acc-grid">
      <div class="card acc"><h3>🟦 Steam</h3>
        ${!s.configured ? `<p class="muted">${t("play.noSteamKey")}</p>` : s.me ? `
          <p>${s.me.steam_avatar ? `<img class="soc-av" src="${esc(s.me.steam_avatar)}" alt="">` : ""} <b>${esc(s.me.persona || "Steam")}</b> · ${t("st.nGames", { n: s.me.game_count })}</p>
          ${s.me.public ? "" : `<p class="hint">⚠ ${t("st.privateHelp")}</p>`}
          <div class="lfg-row"><button class="small-btn" data-st="refresh">${t("acc.refresh")}</button><button class="small-btn danger" data-st="unlink">${t("acc.unlink")}</button></div>`
        : `<p class="muted">${t("acc.steamWhy")}</p><a class="primary btn" href="/api/steam/link">${t("play.linkSteam")}</a><p class="hint">${t("acc.steamSafe")}</p>`}
      </div>
      <div class="card acc"><h3>🎯 Apex Legends</h3>
        ${!a.configured ? `<p class="muted">${t("play.noApexKey")}</p>` : `
          ${ap ? `<p><b>${esc(ap.apex_name)}</b> · ${esc(ap.platform)} ${ap.rank?.name ? `· ${esc(ap.rank.name)} ${ap.rank.div || ""}` : ""}</p>` : `<p class="muted">${t("acc.apexWhy")}</p>`}
          <form class="lfg-row" id="ap-form"><input name="name" maxlength="40" placeholder="${esc(t("acc.apexName"))}" value="${esc(ap?.apex_name || "")}" required>
            <select name="platform">${["PC", "PS4", "X1", "SWITCH"].map((p) => `<option value="${p}" ${ap?.platform === p ? "selected" : ""}>${{ PC: "PC (EA/Steam)", PS4: "PlayStation", X1: "Xbox", SWITCH: "Switch" }[p]}</option>`).join("")}</select>
            <button class="primary">${ap ? t("acc.save") : t("ap.link")}</button></form>
          <p class="hint">${t("acc.apexHint")}</p>
          ${ap ? `<div class="lfg-row"><button class="small-btn" data-ap="refresh">${t("acc.refresh")}</button><button class="small-btn danger" data-ap="unlink">${t("acc.unlink")}</button></div>` : ""}`}
      </div>
    </div>`;
  el.querySelectorAll("[data-st]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.st === "unlink" && !confirm(t("acc.unlinkQ"))) return;
    try { await api("/api/steam", { method: "POST", body: { action: b.dataset.st } }); toast("✓"); await accounts(el); } catch (x) { toast(x.message, true); }
  }));
  el.querySelectorAll("[data-ap]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.ap === "unlink" && !confirm(t("acc.unlinkQ"))) return;
    try { await api("/api/apex", { method: "POST", body: { action: b.dataset.ap } }); toast("✓"); await accounts(el); } catch (x) { toast(x.message, true); }
  }));
  const f = el.querySelector("#ap-form");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector("button"); btn.disabled = true;
    try { await api("/api/apex", { method: "POST", body: { action: "link", name: f.name.value.trim(), platform: f.platform.value } }); toast(t("acc.apexOk")); await accounts(el); }
    catch (x) { toast(x.message, true); btn.disabled = false; }
  };
}
