import { ask, api, esc, t, initPage, onSubmit, toast, fmtDate, roleLabel, localized, avatarHTML, nameHTML, bgStyle, bgAnimated, flag, openLocalePicker } from "./common.js";
import { levelInfo, fmtHours } from "./levels.js";
import { itemName } from "./cosmetics.js";
import { mountFeed } from "./feed.js";
import { mountOcasoProfile } from "./ocaso.js";
import { mountAvatarEditor } from "./avatar-editor.js";
import { mountSettings } from "./settings.js";

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
  document.title = `${p.user.username} · Moikas`;

  main.innerHTML = `
    <section>
      <div class="card profile-card" style="--rank:${l.color}">
        <div class="pc-banner ${p.user.eq_banner ? "has-art" : ""} ${bgAnimated(p.user.eq_banner) ? "art-anim" : ""}" style="${bgStyle(p.user.eq_banner)}"></div>
        <div class="pc-head">
          ${avatarHTML(p.user, 64)}
          <div>
            <h2 style="margin:0">${nameHTML(p.user)} ${p.user.country ? `<span title="${esc(p.user.country)}">${flag(p.user.country)}</span>` : ""}</h2>
            ${p.user.tz ? `<div class="small muted">🕒 ${esc(new Date().toLocaleTimeString(undefined, { timeZone: p.user.tz, hour: "numeric", minute: "2-digit" }))} ${t("tz.theirTime")}${own ? ` · <button class="link" id="tz-edit">${t("tz.change")}</button>` : ""}</div>` : own ? `<div class="small"><button class="link" id="tz-edit">🌎 ${t("tz.set")}</button></div>` : ""}
            <div class="small muted">${p.user.mc_name ? `⛏ ${esc(p.user.mc_name)} · ` : ""}<span class="role ${esc(p.user.role)}">${esc(roleLabel(p.user.role))}</span></div>
          </div>
          <div class="pc-level"><span class="big">${l.level}</span><span class="small">${t("lvl.level")}</span></div>
        </div>
        <div class="pc-rank" style="color:${l.color}">${esc(l.rank)}</div>
        <div class="xpbar"><div style="width:${l.pct}%"></div></div>
        <div class="small muted pc-xp">${t("pf2.toNext", { into: l.into.toLocaleString(), needed: l.needed.toLocaleString(), next: l.level + 1 })} · <b>${esc(t("xp.toNext", { n: (l.needed - l.into).toLocaleString(), level: l.level + 1 }))}</b></div>
        ${p.next_reward ? `<div class="next-reward small">🎁 ${t("pf2.nextReward", { level: p.next_reward.level })}:
          <b>+🪙 ${p.next_reward.coins}</b>${p.next_reward.items.map((i) => ` · <b>${esc(itemName(i))}</b>`).join("")}</div>` : ""}
        <div class="specs" style="margin-top:14px">
          <div class="spec"><span>XP</span><strong>${l.xp.toLocaleString()}</strong></div>
          <div class="spec"><span>${t("rk.hours")}</span><strong>${fmtHours(p.user.play_minutes)}</strong></div>
          <div class="spec"><span>${t("rk.quests")}</span><strong>${p.quests.length}</strong></div>
          <div class="spec"><span>${t("pf2.position")}</span><strong>${p.position ? `#${p.position}` : "—"}</strong></div>
        </div>
      </div>
    </section>

    <nav class="home-tabs pf-tabs" role="tablist">
      <button role="tab" data-pane="posts">📝 ${t("pft.posts")}</button>
      <button role="tab" data-pane="logros">🏅 ${t("pft.logros")}</button>
      <button role="tab" data-pane="juegos">🎮 ${t("pft.juegos")}</button>
      ${own ? `<button role="tab" data-pane="editar">🎨 ${t("pft.editar")}</button><button role="tab" data-pane="ajustes">⚙️ ${t("pft.ajustes")}</button>` : ""}
    </nav>

    <div class="home-pane" data-pane="posts">
      <section><div id="user-feed"></div></section>
    </div>

    <div class="home-pane" data-pane="logros" hidden>
      <section id="trophies" hidden></section>
      <section id="achievements"></section>
      <section id="rival"></section>
      ${user && user.role !== "pending" ? `<p class="small"><a href="/wrapped?user=${p.user.id}">🎁 ${t(own ? "pft.myWrapped" : "pft.theirWrapped", { name: esc(p.user.username) })}</a></p>` : ""}
    </div>

    <div class="home-pane" data-pane="juegos" hidden>
      <section id="ocaso-profile"></section>
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
    </div>

    ${own ? `<div class="home-pane" data-pane="editar" hidden>
      <section id="avatar"><div class="section-head"><h2>${t("cz.title")}</h2></div><div id="avatar-editor"></div></section>
      <p style="margin-top:24px" class="actions"><a class="btn primary" href="/store">🪙 ${t("nav.store")}</a></p>
    </div>
    <div class="home-pane" data-pane="ajustes" hidden id="settings"></div>` : ""}`;

  main.querySelector("#tz-edit")?.addEventListener("click", () => openLocalePicker(user));
  mountOcasoProfile(main.querySelector("#ocaso-profile"), p.user.id);
  mountAchievements(main.querySelector("#achievements"), p.user.id, own);
  if (user && user.role !== "pending") mountRival(main.querySelector("#rival"), p.user, own);
  api(`/api/tournaments?user=${p.user.id}`).then(({ trophies }) => {
    if (!trophies.length) return;
    const el = main.querySelector("#trophies");
    el.hidden = false;
    el.innerHTML = `<div class="section-head"><h2>🏆 ${t("tr.trophies")}</h2></div><div class="tr-trophies">${trophies.map((x) =>
      `<a class="card tr-trophy" href="/tournaments?id=${x.id}">${x.place === 1 ? "🏆" : "🥈"} <b>${esc(x.title)}</b><span class="small muted">${esc(x.game)} · ${t(x.place === 1 ? "tr.place1" : "tr.place2")}</span></a>`).join("")}</div>`;
  }).catch(() => {});
  mountFeed(main.querySelector("#user-feed"), user, { userId: p.user.id, composer: own, modes: false });
  if (own) {
    mountSettings(main.querySelector("#settings"), user, p.user, renderLink);
    const sq = new URLSearchParams(location.search).get("steam");
    if (sq) { toast(t("play.steam." + sq), sq !== "ok"); history.replaceState(null, "", `${location.pathname}#ajustes`); }
    mountAvatarEditor(main.querySelector("#avatar-editor"), { ...user, ...p.user });
  }
  profileTabs();
}

async function renderLink() {
  const box = main.querySelector("#link");
  const st = await api("/api/link");
  if (st.mc_name) {
    box.innerHTML = `
      <p style="margin-top:0">${t("lk.linked", { name: esc(st.mc_name) })}</p>
      <button class="danger" data-unlink>${t("lk.unlink")}</button>`;
    box.querySelector("[data-unlink]").onclick = async () => {
      if (!await ask(t("lk.confirmUnlink"), { danger: true })) return;
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


/* ---------------- Achievements + birthday ---------------- */

async function mountAchievements(el, uid, own) {
  let d;
  try { d = await api(`/api/achievements?user=${uid}`); } catch { el.remove(); return; }
  const got = d.achievements.filter((a) => a.unlocked_at).length;
  el.innerHTML = `
    <div class="section-head"><h2>🏅 ${t("ach.title")} <span class="muted small">${got}/${d.achievements.length}</span></h2>${own ? `<span id="bday-box"></span>` : ""}</div>
    <div class="ach-grid">${d.achievements.map((a) => `
      <div class="ach ${a.unlocked_at ? "on" : ""} ${a.secret && !a.unlocked_at ? "secret" : ""}" title="${esc(a.desc)}${a.unlocked_at ? ` · ${esc(new Date(a.unlocked_at).toLocaleDateString())}` : ""}">
        <span class="ach-i">${a.icon}</span><b>${esc(a.name)}</b><span class="small muted">${esc(a.desc)}</span>
        <span class="small muted">${t("ach.holders", { n: a.holders })}</span></div>`).join("")}</div>`;
  if (own) {
    const box = el.querySelector("#bday-box");
    const { birthday } = await api("/api/birthday").catch(() => ({ birthday: null }));
    const months = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: "short" }));
    const [mm, dd] = (birthday || "-").split("-");
    box.innerHTML = `<span class="small">🎂 ${t("bd.label")}</span>
      <select id="bd-m"><option value="">—</option>${months.map((m, i) => `<option value="${String(i + 1).padStart(2, "0")}" ${mm === String(i + 1).padStart(2, "0") ? "selected" : ""}>${m}</option>`).join("")}</select>
      <select id="bd-d"><option value="">—</option>${Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((x) => `<option ${dd === x ? "selected" : ""}>${x}</option>`).join("")}</select>`;
    const save = async () => {
      const m = box.querySelector("#bd-m").value, dday = box.querySelector("#bd-d").value;
      if (!!m !== !!dday) return;
      try { await api("/api/birthday", { method: "POST", body: { birthday: m ? `${m}-${dday}` : null } }); toast(t("bd.saved")); } catch (x) { toast(x.message, true); }
    };
    box.querySelectorAll("select").forEach((s) => (s.onchange = save));
  }
}

/* ---------------- Rivalries ---------------- */

async function mountRival(el, them, own) {
  const ROWS = [["hours", "⏱️"], ["hours_week", "📅"], ["xp", "⭐"], ["apex_rp", "🎯"], ["apex_week", "📈"], ["deaths", "💀", true], ["trophies", "🏆"],
    ["nights", "🎉"], ["quests", "🗺️"], ["streak", "🔥"], ["guesses", "🧩"], ["bets_won", "🤑"], ["achievements", "🏅"]];
  const show = async (a, b) => {
    el.innerHTML = `<p class="muted">${t("loading")}</p>`;
    let d;
    try { d = await api(`/api/rivals?a=${a}&b=${b}`); } catch (x) { el.innerHTML = `<p class="muted">${esc(x.message)}</p>`; return; }
    let wa = 0, wb = 0;
    const rows = ROWS.map(([k, ico, lowWins]) => {
      const x = d.a.stats[k], y = d.b.stats[k];
      if (x == null && y == null) return "";
      let win = 0;
      if (x != null && y != null && x !== y) win = (lowWins ? x < y : x > y) ? 1 : 2;
      if (win === 1) wa++; else if (win === 2) wb++;
      const fmtv = (v) => (v == null ? "—" : k === "apex_week" && v > 0 ? `+${v}` : v);
      return `<tr><td class="${win === 1 ? "rv-win" : ""}">${fmtv(x)}</td><td>${ico} ${t("rv." + k)}</td><td class="${win === 2 ? "rv-win" : ""}">${fmtv(y)}</td></tr>`;
    }).join("");
    el.innerHTML = `
      <div class="section-head"><h2>⚔️ ${t("rv.title")}</h2>${own ? "" : ""}</div>
      <div class="card rv">
        <div class="rv-head"><div>${avatarHTML(d.a, 40)}<b>${esc(d.a.username)}</b><span class="rv-score">${wa}</span></div><span class="muted">vs</span>
          <div><span class="rv-score">${wb}</span><b>${esc(d.b.username)}</b>${avatarHTML(d.b, 40)}</div></div>
        <table class="rv-table"><tbody>${rows}</tbody></table>
        <p class="hint" style="text-align:center">${wa === wb ? t("rv.tie") : t("rv.leads", { name: esc(wa > wb ? d.a.username : d.b.username) })}</p>
      </div>`;
  };
  if (!own) { show(user.id, them.id); return; }
  // your own profile: pick someone to compare with
  const { players } = await api("/api/leaderboard").catch(() => ({ players: [] }));
  const others = (players || []).filter((u) => u.id !== user.id);
  if (!others.length) { el.remove(); return; }
  el.innerHTML = `<div class="section-head"><h2>⚔️ ${t("rv.title")}</h2>
    <select id="rv-pick"><option value="">${t("rv.pick")}</option>${others.map((u) => `<option value="${u.id}">${esc(u.username)}</option>`).join("")}</select></div>`;
  el.querySelector("#rv-pick").onchange = (e) => e.target.value && show(user.id, +e.target.value);
}

/* ---------------- Tabs (switch without reloading; #logros, #juegos, #editar in the URL) ---------------- */

function profileTabs() {
  const tabs = [...main.querySelectorAll(".pf-tabs [data-pane]")], panes = [...main.querySelectorAll(".home-pane")];
  const alias = { avatar: "editar", link: "ajustes", cuentas: "ajustes", settings: "ajustes", achievements: "logros" };
  const pick = () => { const h = location.hash.slice(1), n = alias[h] || h; return tabs.some((b) => b.dataset.pane === n) ? n : "posts"; };
  const show = (name, save) => {
    tabs.forEach((b) => { const on = b.dataset.pane === name; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    panes.forEach((p) => (p.hidden = p.dataset.pane !== name));
    if (save) history.replaceState(null, "", `${location.pathname}${location.search}${name === "posts" ? "" : "#" + name}`);
  };
  tabs.forEach((b) => (b.onclick = () => show(b.dataset.pane, true)));
  addEventListener("hashchange", () => show(pick()));
  show(pick());
}
