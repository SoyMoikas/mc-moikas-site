import { api, esc, t, initPage, onSubmit, toast, fmtDate, roleLabel, localized } from "./common.js";
import { levelInfo, fmtHours } from "./levels.js";

const user = await initPage();
const main = document.getElementById("main");
const param = new URLSearchParams(location.search).get("id");
const id = param || user?.id;

async function load() {
  if (!id) {
    main.innerHTML = `<p style="padding:40px 0"><a href="/auth/login?next=/profile">${t("auth.login")}</a></p>`;
    return;
  }
  let p;
  try { p = await api(`/api/profile/${encodeURIComponent(id)}`); }
  catch (e) { main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}</p>`; return; }
  const own = user && p.user.id === user.id;
  const l = levelInfo(p.user.xp);
  document.title = `${p.user.username} · Moikas MC`;

  main.innerHTML = `
    <section>
      <div class="card profile-card" style="--rank:${l.color}">
        <div class="pc-head">
          <img src="${esc(p.user.avatar)}" alt="">
          <div>
            <h2 style="margin:0">${esc(p.user.username)}</h2>
            <div class="small muted">${p.user.mc_name ? `⛏ ${esc(p.user.mc_name)} · ` : ""}<span class="role ${esc(p.user.role)}">${esc(roleLabel(p.user.role))}</span></div>
          </div>
          <div class="pc-level"><span class="big">${l.level}</span><span class="small">${t("lvl.level")}</span></div>
        </div>
        <div class="pc-rank" style="color:${l.color}">${esc(l.rank)}</div>
        <div class="xpbar"><div style="width:${l.pct}%"></div></div>
        <div class="small muted pc-xp">${t("pf2.toNext", { into: l.into.toLocaleString(), needed: l.needed.toLocaleString(), next: l.level + 1 })}</div>
        <div class="specs" style="margin-top:14px">
          <div class="spec"><span>XP</span><strong>${l.xp.toLocaleString()}</strong></div>
          <div class="spec"><span>${t("rk.hours")}</span><strong>${fmtHours(p.user.play_minutes)}</strong></div>
          <div class="spec"><span>${t("rk.quests")}</span><strong>${p.quests.length}</strong></div>
          <div class="spec"><span>${t("pf2.position")}</span><strong>${p.position ? `#${p.position}` : "—"}</strong></div>
        </div>
      </div>
    </section>

    ${own ? `<section><div class="section-head"><h2>${t("pf2.mcAccount")}</h2></div><div id="link" class="card"></div></section>` : ""}

    <section>
      <div class="section-head"><h2>${t("pf2.perServer")}</h2></div>
      ${p.servers.length ? `<div class="card">${p.servers.map((s) => `
        <div class="kv"><span>${s.server_id ? `<a href="/server?id=${encodeURIComponent(s.server_id)}">${esc(s.name)}</a>` : esc(s.name)}</span>
          <b>${fmtHours(s.minutes)} h</b></div>`).join("")}</div>`
        : `<p class="muted">${p.user.linked ? t("pf2.noPlaytime") : t("pf2.notLinked")}</p>`}
    </section>

    <section>
      <div class="section-head"><h2>${t("pf2.questsDone")}</h2><a class="btn" href="/quests">${t("nav.quests")} →</a></div>
      ${p.quests.length ? `<div class="card">${p.quests.map((q) => `
        <div class="kv"><span>✓ ${esc(localized(q.title, q.title_es))}</span><b class="q-xp">+${q.xp} XP</b></div>`).join("")}</div>`
        : `<p class="muted">${t("pf2.noQuests")}</p>`}
    </section>

    ${own ? `<p style="margin-top:24px"><a class="btn" href="/auth/logout">${t("auth.logout")}</a></p>` : ""}`;

  if (own) renderLink();
}

async function renderLink() {
  const box = main.querySelector("#link");
  const st = await api("/api/link");
  if (st.mc_name) {
    box.innerHTML = `
      <p style="margin-top:0">${t("lk.linked", { name: esc(st.mc_name) })}</p>
      <button class="danger" data-unlink>${t("lk.unlink")}</button>`;
    box.querySelector("[data-unlink]").onclick = async () => {
      if (!confirm(t("lk.confirmUnlink"))) return;
      try { await api("/api/link", { method: "DELETE" }); toast(t("lk.unlinked")); load(); } catch (e) { toast(e.message, true); }
    };
    return;
  }
  if (st.pending) {
    box.innerHTML = `
      <p style="margin-top:0">${t("lk.codeSent", { name: esc(st.pending.mc_name) })}</p>
      <form class="stack link-code">
        <div class="actions">
          <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required style="max-width:160px;letter-spacing:4px;font-size:1.3rem">
          <button class="primary">${t("lk.verify")}</button>
        </div>
      </form>
      <p class="hint">${t("lk.codeHelp")} <button class="link" data-restart>${t("lk.otherName")}</button></p>`;
    onSubmit(box.querySelector("form"), async (d) => {
      const r = await api("/api/link/verify", { method: "POST", body: d });
      toast(t("lk.done", { name: r.mc_name })); setTimeout(() => location.reload(), 800);
    });
    box.querySelector("[data-restart]").onclick = () => startForm(box);
    return;
  }
  startForm(box);
}

function startForm(box) {
  box.innerHTML = `
    <p style="margin-top:0">${t("lk.intro")}</p>
    <form class="stack">
      <div class="actions">
        <input name="mc_name" maxlength="16" required placeholder="${esc(t("lk.namePh"))}" style="max-width:240px" autocapitalize="off" autocomplete="off" spellcheck="false">
        <button class="primary">${t("lk.start")}</button>
      </div>
    </form>
    <p class="hint">${t("lk.introHelp")}</p>`;
  onSubmit(box.querySelector("form"), async (d) => {
    await api("/api/link", { method: "POST", body: d });
    renderLink();
  });
}

load();
