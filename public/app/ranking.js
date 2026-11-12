import { api, esc, t, initPage, avatarHTML, nameHTML, bgStyle } from "./common.js";
import { mountApex } from "./apex-board.js";
import { levelInfo, levelBadge, fmtHours, RANKS, xpForLevel } from "./levels.js";

const user = await initPage();
const main = document.getElementById("main");
document.title = `${t("nav.ranking")} · Moikas`;

let players = [];
try { ({ players } = await api("/api/leaderboard")); }
catch (e) { main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}</p>`; throw e; }

const medal = (i) => ["🥇", "🥈", "🥉"][i] || `#${i + 1}`;

const TABS = [["moikas", "rk.tab.moikas"], ["apex", "play.tab.apex"]];
let tab = location.hash === "#apex" ? "apex" : "moikas";
main.innerHTML = `
  <div class="play-tabs rk-tabs">${TABS.map(([k, key]) => `<a href="#${k}" data-tab="${k}">${t(key)}</a>`).join("")}</div>
  <div id="rk-apex"></div>
  <div id="rk-moikas">
  <section>
    <div class="section-head"><h2>${t("rk.title")}</h2></div>
    <p class="hint">${t("rk.explain")}</p>
    ${user ? (() => { const l = levelInfo(user.xp); return `
      <div class="card my-progress" style="--rank:${l.color}">
        ${avatarHTML(user, 48)}
        <div class="mp-main">
          <div class="mp-top"><b>${t("rk.yourProgress")}</b> ${levelBadge(user.xp)} <span class="rank-name" style="color:${l.color}">${esc(l.rank)}</span></div>
          <div class="xpbar"><div style="width:${l.pct}%"></div></div>
          <div class="small muted">${t("pf2.toNext", { into: l.into.toLocaleString(), needed: l.needed.toLocaleString(), next: l.level + 1 })} · <b>${esc(t("xp.toNext", { n: (l.needed - l.into).toLocaleString(), level: l.level + 1 }))}</b></div>
        </div>
      </div>`; })() : ""}
    ${players.length ? `
    <div class="card table-wrap"><table class="ranking">
      <thead><tr><th>${t("rk.player")}</th><th>${t("rk.level")}</th><th>XP</th><th>${t("rk.hours")}</th><th>${t("rk.site")}</th><th>${t("rk.quests")}</th></tr></thead>
      <tbody>${players.map((p, i) => {
        const l = levelInfo(p.xp);
        return `<tr class="${user && p.id === user.id ? "me-row" : ""} ${i < 3 ? "top" : ""} ${p.eq_banner ? "has-banner" : ""}" style="${bgStyle(p.eq_banner)}">
          <td class="primary-cell"><span class="pos">${medal(i)}</span>
            <a class="who-cell" href="/profile?id=${p.id}">${avatarHTML(p, 34)}<span>${nameHTML(p)}
              ${p.mc_name ? `<span class="hint">${esc(p.mc_name)}</span>` : ""}</span></a></td>
          <td data-label="${esc(t("rk.level"))}"><div class="lvl-cell">${levelBadge(p.xp)} <span class="rank-name" style="color:${l.color}">${esc(l.rank)}</span>
            <span class="xp-row" style="--rank:${l.color}" title="${esc(t("xp.toNext", { n: (l.needed - l.into).toLocaleString(), level: l.level + 1 }))}"><span style="width:${l.pct}%"></span></span>
            <span class="hint">${esc(t("xp.toNext", { n: (l.needed - l.into).toLocaleString(), level: l.level + 1 }))}</span></div></td>
          <td data-label="XP">${l.xp.toLocaleString()}</td>
          <td data-label="${esc(t("rk.hours"))}">${fmtHours(p.play_minutes)}</td>
          <td data-label="${esc(t("rk.site"))}">${(p.site_xp || 0).toLocaleString()}</td>
          <td data-label="${esc(t("rk.quests"))}">${p.quests}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>` : `<p class="muted">${t("rk.empty")}</p>`}
  </section>
  <section>
    <div class="section-head"><h2>${t("rk.ranks")}</h2></div>
    <div class="ranks">${RANKS.map((r) => `
      <div class="rank-chip" style="--rank:${r.color}"><b>${t(`rank.${r.key}`)}</b>
        <span class="small muted">${t("rk.fromLevel", { n: r.min })} · ${xpForLevel(r.min).toLocaleString()} XP</span></div>`).join("")}
    </div>
  </section>
  </div>`;

let apexLoaded = false;
function show() {
  main.querySelectorAll("[data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  main.querySelector("#rk-moikas").hidden = tab !== "moikas";
  const box = main.querySelector("#rk-apex");
  box.hidden = tab !== "apex";
  if (tab === "apex" && !apexLoaded) {
    apexLoaded = true;
    if (!user || user.role === "pending") { box.innerHTML = `<p class="muted">${t("lfg.emptyGuest")}</p>`; return; }
    box.innerHTML = `<p class="muted">${t("loading")}</p>`;
    mountApex(box).catch((x) => (box.innerHTML = `<p class="muted">${esc(x.message)}</p>`));
  }
}
main.querySelectorAll("[data-tab]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); tab = a.dataset.tab; history.replaceState(null, "", tab === "moikas" ? "/ranking" : "/ranking#apex"); show(); }));
addEventListener("hashchange", () => { tab = location.hash === "#apex" ? "apex" : "moikas"; show(); });
show();
