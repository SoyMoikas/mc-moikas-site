// /status: is the NAS up? Services checked by the bot every minute, uptime bars, game servers, NAS load.
import { api, esc, t, initPage, ago } from "./common.js";

const user = await initPage();
const main = document.getElementById("main");
if (!user || user.role === "pending") main.innerHTML = `<section><h1>🟢 ${t("stt.title")}</h1><p class="muted">${t("lfg.emptyGuest")}</p></section>`;
else { await draw(); setInterval(() => draw().catch(() => {}), 60000); }

async function draw() {
  const d = await api("/api/status");
  const allOk = !d.stale && d.checks.length && d.checks.every((c) => c.ok);
  const downN = d.checks.filter((c) => !c.ok).length;
  const pct = (v) => (v === null ? "—" : `${v}%`);
  const h = d.host;
  main.innerHTML = `
    <section>
      <h1>🟢 ${t("stt.title")}</h1>
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
