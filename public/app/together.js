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

// Jellyfin: "ask for an invite" for people without an account + staff panel to paste Wizarr invite links.
export function jellyfinInvite(el, jf, onChange) {
  const staff = Array.isArray(jf.staff);
  const free = staff ? jf.staff.filter((i) => !i.claimed_name || i.multi).length : 0;
  el.innerHTML = `
    ${!jf.name ? `<div class="card jf-ask">
      <div><b>🎞️ ${t("jf.noAccount")}</b><div class="small muted">${t("jf.noAccountSub")}</div></div>
      ${jf.invite ? `<a class="primary btn" href="${esc(jf.invite)}" target="_blank" rel="noopener">✨ ${t("jf.create")} ↗</a>`
        : `<button class="primary" data-jf="claim" ${jf.available ? "" : ""}>🙋 ${t(jf.available ? "jf.ask" : "jf.askStaff")}</button>`}
    </div>` : ""}
    ${staff ? `<details class="card jf-staff" ${free === 0 ? "open" : ""}><summary>🛠 ${t("jf.staffTitle")} · <b class="${free ? "" : "warn"}">${t("jf.free", { n: free })}</b></summary>
      <p class="small muted">${t("jf.staffHow")}</p>
      <form id="jf-add"><textarea name="urls" rows="3" placeholder="https://unirse.moikas.cc/j/XXXXXXXXXX"></textarea>
        <div class="lfg-row"><label class="small"><input type="checkbox" name="multi"> ${t("jf.multi")}</label><button class="primary">${t("jf.add")}</button></div></form>
      <div class="jf-list">${jf.staff.map((i) => `<div class="jf-row small"><code>${esc(i.url.replace(/^https?:\/\//, ""))}</code>
        <span class="${i.claimed_name && !i.multi ? "muted" : "lfg-ok"}">${i.multi ? `♾ ${t("jf.shared")}` : i.claimed_name ? `✓ ${esc(i.claimed_name)}` : t("jf.unused")}</span>
        <button class="link small" data-jfdel="${i.id}">✕</button></div>`).join("") || `<p class="small muted">${t("jf.none")}</p>`}</div>
    </details>` : ""}`;
  el.querySelector("[data-jf=claim]")?.addEventListener("click", async () => {
    try {
      const r = await api("/api/juntos/jellyfin", { method: "POST", body: { action: "claim" } });
      if (r.invite) { window.open(r.invite, "_blank", "noopener"); toast(t("jf.claimed")); } else toast(t("jf.asked"));
      onChange();
    } catch (x) { toast(x.message, true); }
  });
  el.querySelector("#jf-add")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { const r = await api("/api/juntos/jellyfin", { method: "POST", body: { action: "add", urls: e.target.urls.value, multi: e.target.multi.checked } }); toast(t("jf.added", { n: r.added })); onChange(); }
    catch (x) { toast(x.message, true); }
  });
  el.querySelectorAll("[data-jfdel]").forEach((b) => (b.onclick = async () => {
    if (!confirm(t("jf.delQ"))) return;
    await api("/api/juntos/jellyfin", { method: "POST", body: { action: "delete", id: +b.dataset.jfdel } }).catch((x) => toast(x.message, true));
    onChange();
  }));
}

// "Nuevo en Jellyfin": posters of the latest additions (removes itself when there's nothing / no public Jellyfin URL).
export async function nuevoStrip(el) {
  let d;
  try { d = await api("/api/juntos/nuevo"); } catch { el.remove(); return; }
  if (!d.items.length) { el.remove(); return; }
  el.innerHTML = `<div class="jf-new"><div class="section-head"><b>🎞️ ${t("jfn.title")}</b></div><div class="jf-strip">${d.items.map((i) => `
    <a class="jf-tile" href="${esc(i.url || "#")}" target="_blank" rel="noopener" title="${esc(i.title)}">
      <img src="${esc(i.poster)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'jf-noimg',textContent:'${i.type === "Movie" ? "🎬" : "📺"}'}))">
      <span>${esc(i.title)}</span><span class="small muted">${i.year || ""}${i.added_at && Date.now() - i.added_at < 3 * 86400000 ? ` · <b class="lfg-ok">${t("jfn.new")}</b>` : ""}</span></a>`).join("")}</div></div>`;
}
