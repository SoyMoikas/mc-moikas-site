// "Juntos": movie nights, watchlist, music, clubs, personal goals, question of the day, calendar, Secret Santa.
import { api, esc, t, initPage, toast, ago, inputToMs, zonedNow, wallInput, msToInput } from "./common.js";
import { mountFeed } from "./feed.js";
import { preguntaCard, jellyfinInvite } from "./together.js";

const user = await initPage();
const main = document.getElementById("main");
const q = new URLSearchParams(location.search);
const TABS = ["cine", "lista", "musica", "clubs", "retos", "pregunta", "calendario", "intercambio"];
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : q.get("club") ? "clubs" : "cine";
const av = (u) => `<img class="soc-av" src="${esc(u.avatar || "")}" alt="" title="${esc(u.username || "")}" loading="lazy" onerror="this.style.visibility='hidden'">`;
const fmt = (ms, o = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) => new Date(ms).toLocaleString(undefined, o);
const staff = user && ["staff", "subadmin", "admin"].includes(user.role);

if (!user || user.role === "pending") main.innerHTML = `<section><h1>🫂 ${t("jt.title")}</h1><p class="muted">${t("lfg.emptyGuest")}</p></section>`;
else {
  frame();
  addEventListener("hashchange", () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== tab) { tab = h; frame(); } });
}

function frame() {
  main.innerHTML = `
    <section>
      <h1>🫂 ${t("jt.title")}</h1>
      <div class="play-tabs">${TABS.map((k) => `<a href="#${k}" class="${k === tab ? "active" : ""}">${t("jt.tab." + k)}</a>`).join("")}</div>
      <div id="jt-body"><p class="muted">${t("loading")}</p></div>
    </section>`;
  const body = main.querySelector("#jt-body");
  ({ cine, lista, musica, clubs, retos, pregunta, calendario, intercambio })[tab](body).catch((x) => (body.innerHTML = `<p class="muted">${esc(x.message)}</p>`));
}
const reload = (el, fn) => () => fn(el).catch((x) => toast(x.message, true));

/* ---------------- Cine (movie nights with Jellyfin SyncPlay) ---------------- */

async function cine(el) {
  const [{ nights }, jf, wl] = await Promise.all([api("/api/nights?kind=watch"), api("/api/juntos/jellyfin"), api("/api/juntos/watch")]);
  const focus = +q.get("night") || null;
  const card = (n) => {
    const titles = n.options.filter((o) => o.kind === "game"), times = n.options.filter((o) => o.kind === "time");
    const max = (l) => Math.max(1, ...l.map((o) => o.votes.length));
    const opt = (o, label, list) => `<button class="gn-opt ${o.mine ? "mine" : ""}" data-vote="${o.id}" data-n="${n.id}" ${n.status !== "voting" ? "disabled" : ""}>
      <span class="gn-fill" style="width:${(o.votes.length / max(list)) * 100}%"></span><span class="gn-lbl">${o.mine ? "✓ " : ""}${label}</span><span class="gn-avs">${o.votes.slice(0, 5).map(av).join("")}</span><b>${o.votes.length}</b></button>`;
    const yes = n.rsvp.filter((r) => r.status === "yes");
    return `
      <div class="card gn ${n.id === focus ? "focus" : ""} gn-${n.status}" id="gn-${n.id}">
        <div class="gn-head"><div><b>🎬 ${esc(n.title)}</b> <span class="small muted">· ${t("lfg.by", { name: esc(n.host_name) })}</span>
          <div class="small">${n.status === "voting" ? `🗳️ ${t("gn.voting", { when: fmt(n.vote_until) })}` : n.status === "locked" ? `🍿 ${esc(n.game)} · ${fmt(n.starts_at)}` : n.status === "done" ? `🏁 ${t("gn.done")}` : `✖ ${t("gn.cancelled")}`}</div>
          ${n.note ? `<div class="small muted">${esc(n.note)}</div>` : ""}</div>
          <div class="gn-boss">${n.status === "voting" && (n.mine || staff) ? `<button class="small-btn" data-lock="${n.id}">${t("gn.lock")}</button>` : ""}</div></div>
        ${n.status === "voting" ? `<div class="gn-cols"><div><div class="small muted">${t("cn.what")}</div>${titles.map((o) => opt(o, esc(o.label), titles)).join("")}</div>
          <div><div class="small muted">${t("gn.when")}</div>${times.map((o) => opt(o, esc(fmt(o.value)), times)).join("")}</div></div>` : ""}
        ${n.status === "locked" ? `
          <div class="gn-rsvp">${["yes", "maybe", "no"].map((s) => `<button class="${n.my_rsvp === s ? "primary" : "small-btn"}" data-rsvp="${s}" data-n="${n.id}">${t("gn.rsvp." + s)}</button>`).join("")}
            <span class="small">${t("gn.going", { n: yes.length })} ${yes.map(av).join("")}</span></div>
          <div class="card cn-how small">${t("cn.how", { name: esc(n.title) })} ${jf.url ? `<a class="primary btn" href="${esc(jf.url)}" target="_blank" rel="noopener">▶ ${t("cn.open")}</a>` : ""}</div>` : ""}
      </div>`;
  };
  const wantList = wl.items.filter((i) => !i.watched_at).slice(0, 12);
  el.innerHTML = `
    <div class="section-head"><p class="muted" style="margin:0">${t("cn.intro")}</p><button class="primary" id="cn-new">+ ${t("cn.new")}</button></div>
    ${!jf.name ? `<div class="card play-cta">🎞️ ${t("cn.haveJf")} <form id="jf-form" class="lfg-row"><input name="n" placeholder="${esc(t("cn.jfName"))}" required><button class="small-btn">${t("acc.save")}</button></form></div>`
      : `<p class="small muted">🎞️ Jellyfin: <b>${esc(jf.name)}</b> <button class="link small" id="jf-change">${t("cn.change")}</button>${jf.url ? ` · <a href="${esc(jf.url)}" target="_blank" rel="noopener">${t("cn.open")} ↗</a>` : ""}</p>`}
    <div id="jf-invite"></div>
    <div id="cn-form"></div>
    <div class="gn-list">${nights.map(card).join("") || `<p class="muted">${t("cn.none")}</p>`}</div>`;
  const back = reload(el, cine);
  el.querySelector("#jf-form")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("/api/juntos/jellyfin", { method: "POST", body: { name: e.target.n.value } }); toast("✓"); back(); } catch (x) { toast(x.message, true); } });
  jellyfinInvite(el.querySelector("#jf-invite"), jf, back);
  el.querySelector("#jf-change")?.addEventListener("click", async () => {
    const n = prompt(t("cn.jfName"), jf.name);
    if (n === null) return;
    try { await api("/api/juntos/jellyfin", { method: "POST", body: { name: n } }); back(); } catch (x) { toast(x.message, true); }
  });
  el.querySelectorAll("[data-vote]").forEach((b) => (b.onclick = () => api(`/api/nights/${b.dataset.n}`, { method: "POST", body: { action: "vote", option_id: +b.dataset.vote } }).then(back, (x) => toast(x.message, true))));
  el.querySelectorAll("[data-rsvp]").forEach((b) => (b.onclick = () => api(`/api/nights/${b.dataset.n}`, { method: "POST", body: { action: "rsvp", status: b.dataset.rsvp } }).then(back, (x) => toast(x.message, true))));
  el.querySelectorAll("[data-lock]").forEach((b) => (b.onclick = () => confirm(t("gn.lockQ")) && api(`/api/nights/${b.dataset.lock}`, { method: "POST", body: { action: "lock" } }).then(back, (x) => toast(x.message, true))));
  el.querySelector("#cn-new").onclick = () => {
    const box = el.querySelector("#cn-form");
    if (box.innerHTML) { box.innerHTML = ""; return; }
    const n = zonedNow(), ahead = (6 - n.dow + 7) % 7 || 7;
    box.innerHTML = `
      <form class="card lfg-form">
        <label>${t("gn.fTitle")}<input name="title" maxlength="80" value="${esc(t("cn.defaultTitle"))}"></label>
        <div class="small">${t("cn.pick")}</div>
        <div class="lfg-quick">${wantList.map((i) => `<button type="button" class="chip" data-g="${esc(i.title)}">${esc(i.title)} <span class="muted">· ${i.wants}❤</span></button>`).join("") || `<span class="hint">${t("cn.emptyList")}</span>`}</div>
        <div class="gn-chosen" id="cn-chosen"></div>
        <div class="lfg-row"><input id="cn-other" maxlength="60" placeholder="${esc(t("cn.other"))}"><button type="button" class="small-btn" id="cn-add">+</button></div>
        <div class="small">${t("gn.fTimes")}</div>
        <div id="gn-times"><input type="datetime-local" value="${wallInput(n.y, n.mo, n.d + ahead, 21)}"><input type="datetime-local" value="${wallInput(n.y, n.mo, n.d + ahead + 1, 21)}"></div>
        <label>${t("lfg.note")}<input name="note" maxlength="300" placeholder="${esc(t("cn.notePh"))}"></label>
        <div class="lfg-row"><button class="primary">${t("gn.create")}</button></div>
      </form>`;
    const chosen = new Set();
    const draw = () => (box.querySelector("#cn-chosen").innerHTML = [...chosen].map((g) => `<span class="chip on">${esc(g)}</span>`).join("") || `<span class="hint">${t("gn.pickGames")}</span>`);
    box.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => { chosen.has(b.dataset.g) ? chosen.delete(b.dataset.g) : chosen.add(b.dataset.g); draw(); }));
    box.querySelector("#cn-add").onclick = () => { const v = box.querySelector("#cn-other").value.trim(); if (v) { chosen.add(v); box.querySelector("#cn-other").value = ""; draw(); } };
    draw();
    box.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const times = [...box.querySelectorAll("#gn-times input")].map((i) => inputToMs(i.value)).filter((x) => x && !isNaN(x));
      try { await api("/api/nights", { method: "POST", body: { kind: "watch", title: e.target.title.value, note: e.target.note.value, games: [...chosen], times } }); toast(t("gn.created")); back(); }
      catch (x) { toast(x.message, true); }
    };
  };
  if (focus) el.querySelector(`#gn-${focus}`)?.scrollIntoView({ block: "center" });
}

/* ---------------- Lista (group watchlist) ---------------- */

async function lista(el, filter = "want") {
  const { items } = await api("/api/juntos/watch");
  const shown = items.filter((i) => (filter === "want" ? !i.watched_at : i.watched_at));
  const stars = (n) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
  el.innerHTML = `
    <form id="wl-search" class="lfg-row"><input name="q" placeholder="${esc(t("wl.searchPh"))}" required><button class="primary">${t("wl.search")}</button></form>
    <div id="wl-results"></div>
    <div class="lfg-row" style="margin:12px 0"><button class="${filter === "want" ? "primary" : "small-btn"}" data-f="want">🍿 ${t("wl.want")}</button><button class="${filter === "seen" ? "primary" : "small-btn"}" data-f="seen">✅ ${t("wl.seen")}</button></div>
    <div class="wl-grid">${shown.map((i) => `
      <div class="card wl">
        ${i.poster ? `<img src="${esc(i.poster)}" alt="" loading="lazy">` : `<div class="wl-noimg">${i.kind === "movie" ? "🎬" : "📺"}</div>`}
        <div class="wl-info"><b>${esc(i.title)}</b> <span class="small muted">${esc(i.year || "")} · ${t("wl.kind." + i.kind)}</span>
          ${i.avg ? `<div class="wl-stars" title="${i.n_ratings}">${stars(i.avg)} <span class="small muted">${i.avg}/5 · ${i.n_ratings}</span></div>` : ""}
          ${i.ratings.slice(0, 3).map((r) => `<div class="small">${av(r)} ${esc(r.username)} ${"★".repeat(Math.round(r.stars / 2))}${r.comment ? ` — <span class="muted">${esc(r.comment)}</span>` : ""}</div>`).join("")}
          <div class="lfg-row">
            <button class="small-btn ${i.i_want ? "on" : ""}" data-want="${i.id}">❤ ${i.wants}</button>
            <select data-rate="${i.id}" title="${esc(t("wl.rate"))}"><option value="">⭐ ${t("wl.rate")}</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n * 2}" ${i.my_stars === n * 2 ? "selected" : ""}>${"★".repeat(n)}</option>`).join("")}</select>
            <button class="link small" data-watched="${i.id}">${i.watched_at ? t("wl.unseen") : t("wl.markSeen")}</button>
          </div></div>
      </div>`).join("") || `<p class="muted">${t("wl.empty")}</p>`}</div>`;
  const back = () => lista(el, filter).catch((x) => toast(x.message, true));
  el.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => lista(el, b.dataset.f)));
  el.querySelectorAll("[data-want]").forEach((b) => (b.onclick = () => api("/api/juntos/watch", { method: "POST", body: { action: "want", id: +b.dataset.want } }).then(back)));
  el.querySelectorAll("[data-watched]").forEach((b) => (b.onclick = () => api("/api/juntos/watch", { method: "POST", body: { action: "watched", id: +b.dataset.watched } }).then(back)));
  el.querySelectorAll("[data-rate]").forEach((s) => (s.onchange = async () => {
    if (!s.value) return;
    const comment = prompt(t("wl.commentQ")) || null;
    await api("/api/juntos/watch", { method: "POST", body: { action: "rate", id: +s.dataset.rate, stars: +s.value, comment } }).catch((x) => toast(x.message, true));
    back();
  }));
  el.querySelector("#wl-search").onsubmit = async (e) => {
    e.preventDefault();
    const box = el.querySelector("#wl-results");
    box.innerHTML = `<p class="muted small">${t("loading")}</p>`;
    const { results } = await api(`/api/juntos/watch?q=${encodeURIComponent(e.target.q.value)}`);
    box.innerHTML = `<div class="wl-results">${results.map((r, i) => `
      <button class="wl-r" data-add="${i}">${r.poster ? `<img src="${esc(r.poster)}" alt="">` : ""}<span><b>${esc(r.title)}</b><br><span class="small muted">${esc(r.year || "")} · ${t("wl.kind." + r.kind)}</span></span></button>`).join("")
      || `<p class="muted small">${t("wl.noResults")}</p>`}
      <button class="small-btn" data-manual>+ ${t("wl.manual", { q: esc(e.target.q.value) })}</button></div>`;
    box.querySelectorAll("[data-add]").forEach((b) => (b.onclick = async () => {
      const r = results[+b.dataset.add];
      const res = await api("/api/juntos/watch", { method: "POST", body: { action: "add", ...r } });
      toast(res.existed ? t("wl.existed") : t("wl.added")); lista(el, "want");
    }));
    box.querySelector("[data-manual]").onclick = async () => { await api("/api/juntos/watch", { method: "POST", body: { action: "add", title: e.target.q.value, kind: "movie" } }); lista(el, "want"); };
  };
}

/* ---------------- Música (Spotify + Jellyfin now, top artists) ---------------- */

async function musica(el) {
  const d = await api("/api/juntos/music");
  const music = d.now.filter((x) => x.kind === "music"), watch = d.now.filter((x) => x.kind === "watch");
  el.innerHTML = `
    <p class="muted">${t("mu.intro")}</p>
    ${d.playlist ? `<a class="card play-cta" href="${esc(d.playlist)}" target="_blank" rel="noopener">🎶 <b>${t("mu.playlist")}</b> <span class="primary btn">${t("mu.open")} ↗</span></a>` : ""}
    ${staff ? `<form id="pl-form" class="lfg-row small"><input name="u" placeholder="${esc(t("mu.playlistPh"))}" value="${esc(d.playlist || "")}"><button class="small-btn">${t("acc.save")}</button></form>` : ""}
    <h3>🎵 ${t("mu.now")}</h3>
    <div class="mu-grid">${music.map((m) => `
      <a class="card mu" ${m.url ? `href="${esc(m.url)}" target="_blank" rel="noopener"` : ""}>${m.cover ? `<img src="${esc(m.cover)}" alt="">` : ""}
        <div><b>${esc(m.title)}</b><div class="small muted">${esc(m.artist || "")}</div><div class="small">${av(m)} ${esc(m.username)}</div></div></a>`).join("") || `<p class="muted small">${t("mu.nobody")}</p>`}</div>
    ${watch.length ? `<h3>🎞️ ${t("mu.watching")}</h3><div class="mu-grid">${watch.map((w) => `<div class="card mu"><div><b>${esc(w.artist ? `${w.artist}: ${w.title}` : w.title)}</b><div class="small">${av(w)} ${esc(w.username)}</div></div></div>`).join("")}</div>` : ""}
    <div class="act-two">
      <div><h3>🔥 ${t("mu.top")}</h3><ol class="gg-board">${d.top.map((a) => `<li><b>${esc(a.artist)}</b> <span class="muted small">${t("mu.plays", { n: a.plays, p: a.people })}</span></li>`).join("") || `<li class="muted small">—</li>`}</ol></div>
      <div><h3>🕒 ${t("mu.recent")}</h3><ul class="small mu-recent">${d.recent.map((s) => `<li>${esc(s.title)} — <span class="muted">${esc(s.artist || "")}</span> · ${esc(s.username)}</li>`).join("") || `<li class="muted">—</li>`}</ul></div>
    </div>`;
  el.querySelector("#pl-form")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("/api/juntos/music", { method: "POST", body: { playlist: e.target.u.value } }); musica(el); } catch (x) { toast(x.message, true); } });
}

/* ---------------- Clubs ---------------- */

async function clubs(el) {
  const { clubs: list } = await api("/api/juntos/clubs");
  const open = q.get("club");
  if (open && list.find((c) => c.slug === open)) return clubPage(el, list.find((c) => c.slug === open));
  el.innerHTML = `
    <div class="section-head"><p class="muted" style="margin:0">${t("cl.intro")}</p><button class="small-btn" id="cl-new">+ ${t("cl.new")}</button></div>
    <div id="cl-form"></div>
    <div class="cl-grid">${list.map((c) => `
      <div class="card cl ${c.mine ? "mine" : ""}">
        <a class="cl-top" href="/juntos?club=${encodeURIComponent(c.slug)}#clubs"><span class="cl-ico">${esc(c.icon)}</span><b>${esc(c.name)}</b></a>
        <span class="small muted">${esc(c.description || "")}</span>
        <span class="small">${t("cl.members", { n: c.members })} ${c.people.map(av).join("")}${c.week_posts ? ` · ${t("cl.weekPosts", { n: c.week_posts })}` : ""}</span>
        <button class="${c.mine ? "small-btn" : "primary"}" data-cl="${c.mine ? "leave" : "join"}" data-slug="${esc(c.slug)}">${c.mine ? t("cl.leave") : t("cl.join")}</button>
      </div>`).join("")}</div>`;
  el.querySelectorAll("[data-cl]").forEach((b) => (b.onclick = () => api("/api/juntos/clubs", { method: "POST", body: { action: b.dataset.cl, slug: b.dataset.slug } }).then(() => clubs(el))));
  el.querySelector("#cl-new").onclick = () => {
    const box = el.querySelector("#cl-form");
    box.innerHTML = box.innerHTML ? "" : `<form class="card lfg-form"><div class="lfg-row"><label style="max-width:90px">${t("cl.icon")}<input name="icon" maxlength="4" value="✨"></label><label>${t("cl.name")}<input name="name" maxlength="40" required></label></div>
      <label>${t("cl.desc")}<input name="description" maxlength="160"></label><button class="primary">${t("cl.create")}</button></form>`;
    box.querySelector("form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const r = await api("/api/juntos/clubs", { method: "POST", body: { action: "create", name: e.target.name.value, icon: e.target.icon.value, description: e.target.description.value } }); location.href = `/juntos?club=${r.slug}#clubs`; }
      catch (x) { toast(x.message, true); }
    });
  };
}
function clubPage(el, c) {
  el.innerHTML = `
    <p><a href="/juntos#clubs">← ${t("jt.tab.clubs")}</a></p>
    <div class="card cl-head"><span class="cl-ico big">${esc(c.icon)}</span><div><h2>${esc(c.name)}</h2><div class="small muted">${esc(c.description || "")}</div>
      <div class="small">${t("cl.members", { n: c.members })} ${c.people.map(av).join("")}</div></div>
      ${c.mine ? "" : `<button class="primary" id="cl-join">${t("cl.join")}</button>`}</div>
    <div id="cl-feed"></div>`;
  el.querySelector("#cl-join")?.addEventListener("click", () => api("/api/juntos/clubs", { method: "POST", body: { action: "join", slug: c.slug } }).then(() => location.reload()));
  mountFeed(el.querySelector("#cl-feed"), user, { club: c.slug, modes: false });
}

/* ---------------- Retos personales ---------------- */

async function retos(el) {
  const d = await api("/api/juntos/goals");
  const dayName = (day) => new Date(day + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" });
  const mineCount = d.goals.filter((g) => g.mine).length;
  el.innerHTML = `
    <div class="section-head"><p class="muted" style="margin:0">${t("gl.intro")}</p>${mineCount < 3 ? `<button class="primary" id="gl-new">+ ${t("gl.new")}</button>` : ""}</div>
    <div id="gl-form"></div>
    <div class="gl-grid">${d.goals.map((g) => `
      <div class="card gl ${g.mine ? "mine" : ""}">
        <div class="gl-head"><span class="gl-ico">${esc(g.icon || "🎯")}</span><div><b>${esc(g.title)}</b><div class="small muted">${av(g)} ${esc(g.username)} · ${t("gl.perWeek", { n: g.per_week })}</div></div>
          ${g.streak ? `<span class="gl-streak" title="${esc(t("gl.streakT"))}">🔥 ${g.streak}</span>` : ""}</div>
        <div class="gl-week">${d.week.map((day, i) => `<span class="gl-day ${g.week[i] ? "on" : ""} ${day === d.today ? "today" : ""}">${esc(dayName(day))}</span>`).join("")}
          <span class="small ${g.done_week >= g.per_week ? "lfg-ok" : "muted"}">${g.done_week}/${g.per_week}</span></div>
        ${g.last_note ? `<div class="small muted">“${esc(g.last_note)}”</div>` : ""}
        <div class="lfg-row">
          ${g.mine ? (g.checked_today ? `<button class="small-btn" data-g="uncheck" data-id="${g.id}">✓ ${t("gl.doneToday")}</button>` : `<button class="primary" data-g="check" data-id="${g.id}">✅ ${t("gl.check")}</button>`)
            : `<button class="small-btn" data-g="cheer" data-id="${g.id}">👏 ${t("gl.cheer")}</button>`}
          ${g.cheers.length ? `<span class="small muted">👏 ${g.cheers.map(esc).join(", ")}</span>` : ""}
          ${g.mine ? `<button class="link small" data-g="archive" data-id="${g.id}">${t("gl.archive")}</button>` : ""}
        </div>
      </div>`).join("") || `<p class="muted">${t("gl.none")}</p>`}</div>`;
  el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = async () => {
    const action = b.dataset.g;
    if (action === "archive" && !confirm(t("gl.archiveQ"))) return;
    const note = action === "check" ? prompt(t("gl.noteQ")) || null : null;
    try { await api("/api/juntos/goals", { method: "POST", body: { action, id: +b.dataset.id, note } }); if (action === "check") toast(t("gl.checked")); retos(el); } catch (x) { toast(x.message, true); }
  }));
  el.querySelector("#gl-new")?.addEventListener("click", () => {
    const box = el.querySelector("#gl-form");
    box.innerHTML = box.innerHTML ? "" : `<form class="card lfg-form"><div class="lfg-row"><label style="max-width:90px">${t("cl.icon")}<input name="icon" maxlength="4" value="💪"></label>
      <label>${t("gl.what")}<input name="title" maxlength="80" required placeholder="${esc(t("gl.whatPh"))}"></label>
      <label style="max-width:140px">${t("gl.times")}<input type="number" name="per" min="1" max="7" value="3"></label></div><button class="primary">${t("gl.create")}</button></form>`;
    box.querySelector("form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("/api/juntos/goals", { method: "POST", body: { action: "create", title: e.target.title.value, icon: e.target.icon.value, per_week: +e.target.per.value } }); retos(el); } catch (x) { toast(x.message, true); }
    });
  });
}

/* ---------------- Pregunta del día ---------------- */

async function pregunta(el) { await preguntaCard(el); }

/* ---------------- Calendario ---------------- */

async function calendario(el, offset = 0) {
  const n = zonedNow();
  const first = new Date(Date.UTC(n.y, n.mo - 1 + offset, 1));
  const y = first.getUTCFullYear(), mo = first.getUTCMonth() + 1;
  const from = inputToMs(wallInput(y, mo, 1)), to = inputToMs(wallInput(y, mo + 1, 1));
  const d = await api(`/api/juntos/calendar?from=${from}&to=${to}`);
  const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate(), lead = (first.getUTCDay() + 6) % 7;
  const dayOf = (ms) => +msToInput(ms).slice(8, 10);
  const ICON = { event: "📅", night: "🎮", movie: "🎬", tourney: "🏆", lfg: "🙋", birthday: "", exchange: "" };
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<div class="cal-c empty"></div>`);
  for (let day = 1; day <= daysIn; day++) {
    const its = d.items.filter((x) => (x.all_day ? +new Date(x.at).toISOString().slice(8, 10) : dayOf(x.at)) === day);
    const today = offset === 0 && day === n.d;
    cells.push(`<div class="cal-c ${today ? "today" : ""}"><span class="cal-n">${day}</span>${its.map((x) => `<a class="cal-i cal-${x.type}" ${x.url ? `href="${esc(x.url)}"` : `href="#ev-${x.id}"`} title="${esc(x.title)}">${ICON[x.type]}${esc(x.title)}</a>`).join("")}</div>`);
  }
  const upcoming = d.items.filter((x) => x.type === "event" && x.at > Date.now() - 3 * 3600000);
  el.innerHTML = `
    <div class="section-head"><div class="lfg-row"><button class="small-btn" data-m="-1">◀</button><h2 style="margin:0">${esc(first.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }))}</h2><button class="small-btn" data-m="1">▶</button></div>
      <button class="primary" id="ev-new">+ ${t("ca.new")}</button></div>
    <div id="ev-form"></div>
    <div class="cal">${[1, 2, 3, 4, 5, 6, 0].map((w) => `<div class="cal-h">${esc(new Date(Date.UTC(2024, 0, w === 0 ? 7 : w)).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }))}</div>`).join("")}${cells.join("")}</div>
    ${upcoming.length ? `<h3>📅 ${t("ca.plans")}</h3>${upcoming.map((x) => `
      <div class="card ev" id="ev-${x.id}"><div><b>${esc(x.title)}</b><div class="small">${fmt(x.at)}${x.place ? ` · 📍 ${esc(x.place)}` : ""} · ${t("lfg.by", { name: esc(x.by || "?") })}</div>
        ${x.description ? `<div class="small muted">${esc(x.description)}</div>` : ""}</div>
        <div class="lfg-row">${["yes", "maybe", "no"].map((s) => `<button class="${x.mine === s ? "primary" : "small-btn"}" data-rsvp="${s}" data-id="${x.id}">${t("gn.rsvp." + s)}</button>`).join("")}
          <span class="small">${t("gn.going", { n: x.going })}</span>${x.can_delete ? `<button class="link small" data-del="${x.id}">✕</button>` : ""}</div></div>`).join("")}` : ""}`;
  el.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => calendario(el, offset + +b.dataset.m)));
  el.querySelectorAll("[data-rsvp]").forEach((b) => (b.onclick = () => api("/api/juntos/calendar", { method: "POST", body: { action: "rsvp", id: +b.dataset.id, status: b.dataset.rsvp } }).then(() => calendario(el, offset))));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => confirm(t("ca.delQ")) && api("/api/juntos/calendar", { method: "POST", body: { action: "delete", id: +b.dataset.del } }).then(() => calendario(el, offset))));
  el.querySelector("#ev-new").onclick = () => {
    const box = el.querySelector("#ev-form");
    box.innerHTML = box.innerHTML ? "" : `<form class="card lfg-form">
      <label>${t("ca.what")}<input name="title" maxlength="80" required placeholder="${esc(t("ca.whatPh"))}"></label>
      <div class="lfg-row"><label>${t("lfg.time")}<input type="datetime-local" name="at" required value="${wallInput(n.y, n.mo, n.d + 3, 18)}"></label><label>${t("ca.place")}<input name="place" maxlength="80"></label></div>
      <label>${t("ca.desc")}<input name="description" maxlength="400"></label><button class="primary">${t("ca.create")}</button></form>`;
    box.querySelector("form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("/api/juntos/calendar", { method: "POST", body: { action: "create", title: e.target.title.value, place: e.target.place.value, description: e.target.description.value, starts_at: inputToMs(e.target.at.value) } }); toast(t("ca.created")); calendario(el, offset); }
      catch (x) { toast(x.message, true); }
    });
  };
}

/* ---------------- Intercambio navideño ---------------- */

async function intercambio(el) {
  const d = await api("/api/juntos/exchange");
  const ex = d.exchange;
  if (!ex) {
    el.innerHTML = `<p class="muted">${t("ix.none")}</p>${d.staff ? createForm() : ""}`;
    bindCreate(); return;
  }
  const joined = !!d.me;
  const status = { signup: t("ix.st.signup", { when: fmt(ex.signup_until) }), drawn: t("ix.st.drawn", { when: fmt(ex.reveal_at) }), revealed: t("ix.st.revealed") }[ex.status];
  el.innerHTML = `
    <div class="card ix-head"><span class="ix-ico">🎁</span><div><h2>${esc(ex.title)}</h2><div class="small">${ex.budget ? `💰 ${esc(ex.budget)} · ` : ""}${status}</div><div class="small muted">${t("ix.count", { n: ex.count })}</div></div></div>
    ${d.giftee ? `
      <div class="card ix-match"><div class="small muted">🤫 ${t("ix.youGive")}</div><h2>${av(d.giftee)} ${esc(d.giftee.username)}</h2>
        <div><b>${t("ix.wishlist")}:</b> ${esc(d.giftee.wishlist || t("ix.noWishlist"))}</div>
        ${d.giftee.notes ? `<div class="small"><b>${t("ix.notes")}:</b> ${esc(d.giftee.notes)}</div>` : ""}
        <div class="lfg-row"><button class="${d.me.sent ? "small-btn" : "primary"}" data-ix="sent">${d.me.sent ? "✓ " + t("ix.sent") : "📦 " + t("ix.markSent")}</button>
          <button class="small-btn" data-ix="received">${d.me.received ? "✓ " + t("ix.gotIt") : "🎉 " + t("ix.markGot")}</button></div></div>` : ""}
    ${ex.status === "signup" ? `
      <form class="card lfg-form" id="ix-form"><b>${joined ? t("ix.yours") : t("ix.join")}</b>
        <label>${t("ix.wishlist")}<textarea name="wishlist" rows="3" maxlength="600" placeholder="${esc(t("ix.wishPh"))}">${esc(d.me?.wishlist || "")}</textarea></label>
        <label>${t("ix.notesL")}<input name="notes" maxlength="300" value="${esc(d.me?.notes || "")}" placeholder="${esc(t("ix.notesPh"))}"></label>
        <div class="lfg-row"><button class="primary">${joined ? t("acc.save") : t("ix.signup")}</button>${joined ? `<button type="button" class="link" data-ix="leave">${t("tr.leave")}</button>` : ""}</div>
      </form>` : ""}
    <h3>${t("ix.people")}</h3>
    <div class="ix-list">${d.members.map((m) => `<div class="card ix-p">${av(m)} <div><b>${esc(m.username)}</b>${m.santa ? ` <span class="small">← 🎅 ${esc(m.santa)}</span>` : ""}
      <div class="small muted">${esc(m.wishlist || "—")}</div></div><span class="small">${m.sent ? "📦" : ""}${m.received ? "🎉" : ""}</span></div>`).join("")}</div>
    ${d.staff && ex.status === "signup" ? `<div class="card tr-staff"><b>🛠 Staff</b><button class="primary" data-ix="draw">🎲 ${t("ix.draw")}</button><button class="danger" data-ix="cancel">${t("tr.delete")}</button></div>` : ""}
    ${d.staff && ex.status === "revealed" ? createForm() : ""}`;
  el.querySelector("#ix-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/juntos/exchange", { method: "POST", body: { action: joined ? "update" : "join", wishlist: e.target.wishlist.value, notes: e.target.notes.value } }); toast(t("ix.saved")); intercambio(el); }
    catch (x) { toast(x.message, true); }
  });
  el.querySelectorAll("[data-ix]").forEach((b) => (b.onclick = async () => {
    const a = b.dataset.ix;
    if ((a === "draw" && !confirm(t("ix.drawQ"))) || (a === "cancel" && !confirm(t("tr.deleteQ"))) || (a === "leave" && !confirm(t("tr.leaveQ")))) return;
    try { await api("/api/juntos/exchange", { method: "POST", body: { action: a } }); intercambio(el); } catch (x) { toast(x.message, true); }
  }));
  bindCreate();

  function createForm() {
    const n = zonedNow();
    return `<form class="card lfg-form" id="ix-new"><b>🛠 ${t("ix.create")}</b>
      <div class="lfg-row"><label>${t("gn.fTitle")}<input name="title" value="${esc(t("ix.defaultTitle"))}"></label><label>${t("ix.budget")}<input name="budget" placeholder="$300 MXN / $20 USD"></label></div>
      <div class="lfg-row"><label>${t("ix.signupUntil")}<input type="datetime-local" name="su" value="${wallInput(n.y, 12, 1, 20)}"></label><label>${t("ix.revealAt")}<input type="datetime-local" name="ra" value="${wallInput(n.y, 12, 24, 20)}"></label></div>
      <button class="primary">${t("ix.create")}</button></form>`;
  }
  function bindCreate() {
    el.querySelector("#ix-new")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try { await api("/api/juntos/exchange", { method: "POST", body: { action: "create", title: f.title.value, budget: f.budget.value, signup_until: inputToMs(f.su.value), reveal_at: inputToMs(f.ra.value) } }); intercambio(el); }
      catch (x) { toast(x.message, true); }
    });
  }
}
