// Small "Juntos" widgets shared by the home page and /juntos.
import { api, esc, t, toast } from "./common.js";
const av = (u) => `<img class="soc-av" src="${esc(u.avatar || "")}" alt="" title="${esc(u.username || "")}" loading="lazy" onerror="this.style.visibility='hidden'">`;

export async function preguntaCard(el, compact = false) {
  const d = await api("/api/juntos/qotd");
  el.innerHTML = `
    <div class="card qd">
      <div class="small muted">💭 ${t("qd.title")}</div>
      <h2 class="qd-q">${esc(d.question)}</h2>
      ${d.answered ? `<div class="qd-list">${d.answers.slice(0, compact ? 4 : 99).map((a) => `<div class="qd-a">${av(a)} <div><b>${esc(a.username)}</b><div>${esc(a.answer)}</div></div></div>`).join("")}
          ${compact && d.answers.length > 4 ? `<a class="small" href="/juntos#pregunta">${t("qd.more", { n: d.answers.length - 4 })}</a>` : ""}</div>`
        : `<form class="lfg-row" id="qd-form"><input name="a" maxlength="500" required placeholder="${esc(t("qd.ph"))}"><button class="primary">${t("qd.send")}</button></form>
           <div class="hint">${t("qd.hidden", { n: d.count })}</div>`}
    </div>`;
  el.querySelector("#qd-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/juntos/qotd", { method: "POST", body: { answer: e.target.a.value } }); toast(t("qd.thanks")); preguntaCard(el, compact); } catch (x) { toast(x.message, true); }
  });
}

// "Un día como hoy": posts, nights, tournaments, quotes from 1 week / 1 month / N years ago. Removes itself when empty.
export async function recuerdosCard(el) {
  let d;
  try { d = await api("/api/juntos/memories"); } catch { el.remove(); return; }
  if (!d.groups.length) { el.remove(); return; }
  const label = (g) => g.key === "w1" ? t("me.week") : g.key === "m1" ? t("me.month") : t("me.years", { n: g.n });
  el.innerHTML = `<div class="card me"><div class="small muted">📸 ${t("me.title")}</div>${d.groups.map((g) => `
    <div class="me-g"><b class="small">${label(g)}</b>${g.items.map((i) => `<${i.url ? `a href="${esc(i.url)}"` : "div"} class="me-i">${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy">` : `<span>${i.icon}</span>`}<span>${esc(i.text)}</span></${i.url ? "a" : "div"}>`).join("")}</div>`).join("")}</div>`;
}
