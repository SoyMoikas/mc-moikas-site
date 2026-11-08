import { api, esc, t, initPage } from "./common.js";
import { levelInfo, levelBadge, fmtHours, RANKS, xpForLevel } from "./levels.js";

const user = await initPage();
const main = document.getElementById("main");
document.title = `${t("nav.ranking")} · Moikas MC`;

let players = [];
try { ({ players } = await api("/api/leaderboard")); }
catch (e) { main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}</p>`; throw e; }

const medal = (i) => ["🥇", "🥈", "🥉"][i] || `#${i + 1}`;

main.innerHTML = `
  <section>
    <div class="section-head"><h2>${t("rk.title")}</h2></div>
    <p class="hint">${t("rk.explain")}</p>
    ${players.length ? `
    <div class="card table-wrap"><table class="ranking">
      <thead><tr><th>${t("rk.player")}</th><th>${t("rk.level")}</th><th>XP</th><th>${t("rk.hours")}</th><th>${t("rk.quests")}</th></tr></thead>
      <tbody>${players.map((p, i) => {
        const l = levelInfo(p.xp);
        return `<tr class="${user && p.id === user.id ? "me-row" : ""} ${i < 3 ? "top" : ""}">
          <td class="primary-cell"><span class="pos">${medal(i)}</span>
            <a class="who-cell" href="/profile?id=${p.id}"><img src="${esc(p.avatar)}" alt=""><span><b>${esc(p.username)}</b>
              ${p.mc_name ? `<span class="hint">${esc(p.mc_name)}</span>` : ""}</span></a></td>
          <td data-label="${esc(t("rk.level"))}">${levelBadge(p.xp)} <span class="rank-name" style="color:${l.color}">${esc(l.rank)}</span></td>
          <td data-label="XP">${l.xp.toLocaleString()}</td>
          <td data-label="${esc(t("rk.hours"))}">${fmtHours(p.play_minutes)}</td>
          <td data-label="${esc(t("rk.quests"))}">${p.quests}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>` : `<p class="muted">${t("rk.empty")}</p>`}
  </section>
  <section>
    <div class="section-head"><h2>${t("rk.ranks")}</h2></div>
    <div class="ranks">${RANKS.map((r) => `
      <div class="rank-chip" style="--rank:${r.color}"><b>${t(`rank.${r.key}`)}</b>
        <span class="small muted">${t("rk.fromLevel", { n: r.min })} · ${t("rk.aboutHours", { h: Math.round(xpForLevel(r.min) / 60) })}</span></div>`).join("")}
    </div>
  </section>`;
