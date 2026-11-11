// /status: is the NAS up? Services checked by the bot every minute, uptime bars, game servers, NAS load.
import { api, esc, t, initPage, ago, toast } from "./common.js";

const user = await initPage();
const main = document.getElementById("main");
if (!user || user.role === "pending") main.innerHTML = `<section><h1>🟢 ${t("stt.title")}</h1><p class="muted">${t("lfg.emptyGuest")}</p></section>`;
else {
  main.innerHTML = `<section><h1>🟢 ${t("stt.title")}</h1>
    <div class="play-tabs"><a href="#servicios" data-t="servicios">🟢 ${t("stt.tabServices")}</a><a href="#espacio" data-t="espacio">💾 ${t("sp.tab")}</a></div>
    <div id="st-body"></div></section>`;
  const body = main.querySelector("#st-body");
  let timer = null;
  const go = () => {
    const tab = location.hash === "#espacio" ? "espacio" : "servicios";
    main.querySelectorAll("[data-t]").forEach((a) => a.classList.toggle("active", a.dataset.t === tab));
    clearInterval(timer);
    const fn = tab === "espacio" ? espacio : draw;
    fn(body).catch((x) => (body.innerHTML = `<p class="muted">${esc(x.message)}</p>`));
    if (tab === "servicios") timer = setInterval(() => draw(body).catch(() => {}), 60000);
  };
  addEventListener("hashchange", go);
  go();
}

async function draw(main) {
  const d = await api("/api/status");
  const allOk = !d.stale && d.checks.length && d.checks.every((c) => c.ok);
  const downN = d.checks.filter((c) => !c.ok).length;
  const pct = (v) => (v === null ? "—" : `${v}%`);
  const h = d.host;
  main.innerHTML = `
    <section>
      <div class="card stt-sum ${d.stale ? "warn" : allOk ? "ok" : "bad"}">
        <span class="stt-dot big"></span>
        <div><b>${d.stale ? t("stt.stale") : allOk ? t("stt.allOk") : t("stt.someDown", { n: downN })}</b>
          <div class="small muted">${d.last_report ? t("stt.checked", { ago: esc(ago(d.last_report)) }) : t("stt.never")}</div></div>
        ${h ? `<div class="stt-host small">${h.load != null ? `<span>⚙️ CPU <b>${Math.round((h.load / (h.cpus || 1)) * 100)}%</b></span>` : ""}${h.mem_pct != null ? `<span>🧠 RAM <b>${h.mem_pct}%</b></span>` : ""}${h.disk_pct != null ? `<span>💾 ${t("stt.disk")} <b>${h.disk_pct}%</b></span>` : ""}</div>` : ""}
      </div>
      <h3>${t("stt.services")}</h3>
      <div class="stt-list">${d.checks.map((c) => `
        <div class="card stt ${c.ok ? "ok" : "bad"}">
          <div class="stt-top"><span class="stt-dot"></span><b>${esc(c.name)}</b>
            <span class="small muted">${c.ok ? (c.ms != null ? `${c.ms} ms` : "OK") : esc(c.detail || t("stt.down"))}</span>
            <span class="small muted stt-since">${t(c.ok ? "stt.upSince" : "stt.downSince", { ago: esc(ago(c.changed_at)) })}</span></div>
          <div class="stt-bars" title="${esc(t("stt.bars"))}">${c.bars.map((v) => `<i class="${v === null ? "na" : v >= 99 ? "g" : v >= 80 ? "y" : "r"}" title="${v === null ? "—" : v + "%"}"></i>`).join("")}</div>
          <div class="small muted">${t("stt.uptime")}: 24 h <b>${pct(c.up24)}</b> · 7 d <b>${pct(c.up7)}</b> · 30 d <b>${pct(c.up30)}</b></div>
        </div>`).join("") || `<p class="muted">${t("stt.none")}</p>`}</div>
      ${d.servers.length ? `<h3>${t("stt.games")}</h3><div class="stt-list">${d.servers.map((s) => `
        <a class="card stt ${s.status === "running" ? "ok" : ["offline", "stopping"].includes(s.status) ? "bad" : ""}" href="/server?id=${encodeURIComponent(s.id)}"><div class="stt-top"><span class="stt-dot"></span><b>${esc(s.name)}</b>
          <span class="small muted">${esc(s.game || "")} · ${s.status === "running" ? (s.players != null ? t("stt.players", { n: s.players, max: s.max ?? "?" }) : "online") : s.status === "unknown" || !s.status ? "—" : esc(s.status)}</span></div></a>`).join("")}</div>` : ""}
      <p class="hint">${t("stt.hint")}</p>
    </section>`;
}

/* ---------------- 💾 Espacio: disk, growth, biggest titles, Limpieza ---------------- */

const size = (b) => (b == null ? "—" : b >= 1e12 ? `${(b / 1e12).toFixed(2)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const since = (ms) => (ms ? ago(ms) : t("sp.never"));

async function espacio(el) {
  const d = await api("/api/storage");
  const k = d.disk, s = d.settings, pct = k ? Math.round((k.used / k.total) * 100) : null;
  const other = k ? Math.max(0, k.used - (k.movies || 0) - (k.shows || 0)) : 0;
  const seg = (v, cls, label) => (k && v ? `<i class="${cls}" style="width:${(v / k.total) * 100}%" title="${esc(label)}: ${size(v)}"></i>` : "");
  const hist = d.history.slice(-60), maxU = Math.max(1, ...hist.map((h) => h.total || h.used));
  const groups = { due: [], approved: [], failed: [], pending: [], kept: [], deleted: [] };
  for (const i of d.items) (groups[i.status] || groups.kept).push(i);
  const card = (i) => `
    <div class="card sp-item ${i.status}">
      ${i.poster ? `<img src="${esc(i.poster)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
      <div class="sp-info"><b>${i.type === "Series" ? "📺" : "🎬"} ${esc(i.title)}</b> <span class="small muted">${i.year || ""}${i.type === "Series" ? " · " + t("sp.endedSeries") : ""}</span>
        <div class="small">💾 ${size(i.size)} · 👁 ${t("sp.lastSeen")}: ${since(i.last_played)}</div>
        <div class="small ${i.status === "due" || i.status === "approved" ? "warn" : "muted"}">${{
          pending: `⏳ ${t("sp.st.pending", { when: new Date(i.delete_after).toLocaleDateString(undefined, { month: "short", day: "numeric" }) })}`,
          due: `⚠️ ${t("sp.st.due")}`, approved: `🗑 ${t("sp.st.approved")}`, failed: `😕 ${t("sp.st.failed")} ${esc(i.detail || "")}`,
          kept: i.protected ? `🔒 ${t("sp.st.protected")}` : `🛡 ${t("sp.st.kept")}${i.voters ? ` · ${esc(i.voters)}` : i.detail === "watched" ? ` · ${t("sp.watchedAgain")}` : ""}`,
          deleted: `✅ ${t("sp.st.deleted")}` }[i.status] || ""}</div>
        <div class="lfg-row">
          ${["pending", "due"].includes(i.status) ? `<button class="primary" data-a="keep" data-id="${esc(i.jf_id)}">🛡 ${t("sp.keep")}</button>` : ""}
          ${i.url && i.status !== "deleted" ? `<a class="small-btn btn" href="${esc(i.url)}" target="_blank" rel="noopener">▶ ${t("sp.watch")}</a>` : ""}
          ${d.staff && ["pending", "due", "failed", "kept"].includes(i.status) && !i.protected ? `<button class="small-btn danger" data-a="delete_now" data-id="${esc(i.jf_id)}">🗑 ${t("sp.deleteNow")}</button>` : ""}
          ${d.staff && i.status === "approved" ? `<button class="link small" data-a="restore" data-id="${esc(i.jf_id)}">↺ ${t("sp.undo")}</button>` : ""}
          ${d.staff && i.status !== "deleted" ? `<button class="link small" data-a="${i.protected ? "unprotect" : "protect"}" data-id="${esc(i.jf_id)}">${i.protected ? t("sp.unprotect") : "🔒 " + t("sp.protect")}</button>` : ""}
        </div></div>
    </div>`;
  const active = [...groups.due, ...groups.approved, ...groups.failed, ...groups.pending];
  const toFree = active.reduce((x, i) => x + (i.size || 0), 0);
  el.innerHTML = `
    ${k ? `
    <div class="card sp-disk">
      <div class="sp-top"><div><div class="sp-big">${size(k.free)}</div><div class="small muted">${t("sp.free")} · ${t("sp.of", { total: size(k.total) })}</div></div>
        <div class="sp-pct ${pct >= 90 ? "bad" : pct >= 75 ? "warn" : ""}">${pct}%<span class="small muted"> ${t("sp.used")}</span></div></div>
      <div class="sp-bar">${seg(k.movies, "mv", t("sp.movies"))}${seg(k.shows, "tv", t("sp.shows"))}${seg(other, "ot", t("sp.other"))}</div>
      <div class="sp-legend small"><span><i class="mv"></i>${t("sp.movies")} ${size(k.movies)}</span><span><i class="tv"></i>${t("sp.shows")} ${size(k.shows)}</span><span><i class="ot"></i>${t("sp.other")} ${size(other)}</span><span><i class="fr"></i>${t("sp.free")} ${size(k.free)}</span></div>
      <div class="small">${d.per_day != null ? (d.per_day > 1e8 ? t("sp.growth", { gb: (d.per_day * 30 / 1e9).toFixed(0) }) + (d.full_in_days ? " · " + t("sp.fullIn", { d: d.full_in_days }) : "") : t("sp.flat")) : t("sp.noHistory")}
        ${d.library?.n ? ` · 🎞️ ${t("sp.lib", { n: d.library.n, m: d.library.movies })}` : ""}${d.freed?.n ? ` · 🧹 ${t("sp.freed", { size: size(d.freed.b), n: d.freed.n })}` : ""}</div>
      ${hist.length > 1 ? `<div class="sp-chart" title="${esc(t("sp.chart"))}">${hist.map((h) => `<i style="height:${(h.used / maxU) * 100}%" title="${esc(h.day)}: ${size(h.used)}"></i>`).join("")}</div>` : ""}
    </div>` : `<div class="card"><p class="muted">${t("sp.noData")}</p></div>`}

    <h2>🧹 ${t("sp.cleanup")}</h2>
    <p class="muted small">${s.enabled ? t("sp.how", { idle: s.idle_days, added: s.added_days, grace: s.grace_days, keep: s.keep_days }) : t("sp.off")}
      ${s.min_used_pct ? " " + t("sp.onlyWhen", { pct: s.min_used_pct }) : ""} ${s.auto ? `<b>${t("sp.autoOn")}</b>` : t("sp.manual")}</p>
    ${active.length ? `<p><b>${t("sp.wouldFree", { size: size(toFree), n: active.length })}</b>
      ${d.staff && groups.due.length ? ` <button class="danger" data-a="approve_due">🗑 ${t("sp.approveDue", { n: groups.due.length })}</button>` : ""}</p>` : `<p class="muted">${t("sp.none")}</p>`}
    <div class="sp-list">${active.map(card).join("")}</div>
    ${groups.kept.length ? `<details class="sp-more"><summary class="small">🛡 ${t("sp.keptList", { n: groups.kept.length })}</summary><div class="sp-list">${groups.kept.map(card).join("")}</div></details>` : ""}
    ${groups.deleted.length ? `<details class="sp-more"><summary class="small">✅ ${t("sp.deletedList", { n: groups.deleted.length })}</summary><div class="sp-list">${groups.deleted.map(card).join("")}</div></details>` : ""}

    ${d.biggest.length ? `<h2>🐘 ${t("sp.biggest")}</h2><div class="sp-big-list">${d.biggest.map((b) => `
      <div class="sp-row"><span>${b.type === "Movie" ? "🎬" : "📺"} <b>${esc(b.title)}</b> <span class="muted small">${b.year || ""}</span></span>
        <span class="small">${size(b.size)}</span><span class="small muted">👁 ${since(b.last_played)}${b.plays ? ` · ${t("sp.plays", { n: b.plays })}` : ""}</span></div>`).join("")}</div>` : ""}

    ${d.staff ? `<details class="card sp-settings"><summary>⚙️ ${t("sp.settings")}</summary>
      <form id="sp-set" class="lfg-form">
        <label class="small"><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""}> ${t("sp.s.enabled")}</label>
        <div class="lfg-row">
          <label>${t("sp.s.idle")}<input type="number" name="idle_days" min="14" max="3650" value="${s.idle_days}"></label>
          <label>${t("sp.s.added")}<input type="number" name="added_days" min="7" max="3650" value="${s.added_days}"></label>
          <label>${t("sp.s.grace")}<input type="number" name="grace_days" min="1" max="90" value="${s.grace_days}"></label>
          <label>${t("sp.s.keep")}<input type="number" name="keep_days" min="7" max="365" value="${s.keep_days}"></label>
          <label>${t("sp.s.minUsed")}<input type="number" name="min_used_pct" min="0" max="99" value="${s.min_used_pct}"></label>
        </div>
        <label class="small"><input type="checkbox" name="series" ${s.series ? "checked" : ""}> ${t("sp.s.series")}</label>
        <label class="small"><input type="checkbox" name="auto" ${s.auto ? "checked" : ""}> ${t("sp.s.auto")}</label>
        <button class="primary">${t("acc.save")}</button>
      </form></details>` : ""}`;
  el.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a;
    if (a === "delete_now" && !confirm(t("sp.deleteQ"))) return;
    if (a === "approve_due" && !confirm(t("sp.approveQ", { n: groups.due.length }))) return;
    try { await api("/api/storage", { method: "POST", body: { action: a, id: b.dataset.id } }); toast(a === "keep" ? t("sp.kept", { d: s.keep_days }) : "✓"); espacio(el); }
    catch (x) { toast(x.message, true); }
  }));
  el.querySelector("#sp-set")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.auto.checked && !s.auto && !confirm(t("sp.autoQ"))) return;
    try {
      await api("/api/storage", { method: "POST", body: { action: "settings", enabled: f.enabled.checked, series: f.series.checked, auto: f.auto.checked, idle_days: +f.idle_days.value, added_days: +f.added_days.value,
        grace_days: +f.grace_days.value, keep_days: +f.keep_days.value, min_used_pct: +f.min_used_pct.value } });
      toast("✓"); espacio(el);
    } catch (x) { toast(x.message, true); }
  });
}
