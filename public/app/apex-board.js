// Apex Legends board (linked players' rank, RP this week, live state). Lives in Ranking → Apex.
import { api, esc, t, ago } from "./common.js";
const av = (u) => `<img class="soc-av" src="${esc(u.avatar || "")}" alt="" title="${esc(u.username)}" loading="lazy" onerror="this.style.visibility='hidden'">`;

export async function mountApex(el) {
  const d = await api("/api/apex");
  if (!d.configured) { el.innerHTML = `<p class="muted">${t("play.noApexKey")}</p>`; return; }
  const mine = d.players.find((p) => p.mine);
  const weekly = [...d.players].filter((p) => p.week_rp != null).sort((a, b) => b.week_rp - a.week_rp);
  el.innerHTML = `
    ${!mine ? `<div class="card play-cta">🎯 ${t("ap.linkCta")} <a class="primary btn" href="/profile#ajustes">${t("ap.link")}</a></div>` : ""}
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
}
