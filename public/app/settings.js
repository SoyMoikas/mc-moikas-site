// Profile → ⚙️ Ajustes: linked accounts (Discord, Minecraft, Steam, Apex, Jellyfin), language, time zone, notifications.
import { api, esc, t, toast, TZ, flag, openLocalePicker, NT_KINDS } from "./common.js";
import { lang, setLang } from "./i18n.js";

export async function mountSettings(el, user, me, renderMinecraft) {
  el.innerHTML = `
    <section>
      <div class="section-head"><h2>🔗 ${t("set.linked")}</h2></div>
      <p class="muted small">${t("set.linkedWhy")}</p>
      <div class="acc-grid">
        <div class="card acc"><h3>💬 Discord</h3>
          <p><img class="soc-av" src="${esc(me.avatar || "")}" alt=""> <b>${esc(me.username)}</b></p>
          <p class="hint">${t("set.discordHint")}</p></div>
        <div class="card acc"><h3>⛏️ Minecraft</h3><div id="link"></div></div>
        <div class="card acc" id="acc-steam"><h3>🟦 Steam</h3><p class="muted small">${t("loading")}</p></div>
        <div class="card acc" id="acc-apex"><h3>🎯 Apex Legends</h3><p class="muted small">${t("loading")}</p></div>
        <div class="card acc" id="acc-jf"><h3>🎞️ Jellyfin</h3><p class="muted small">${t("loading")}</p></div>
      </div>
    </section>
    <section>
      <div class="section-head"><h2>🌎 ${t("set.prefs")}</h2></div>
      <div class="card set-rows">
        <div class="set-row"><div><b>${t("set.lang")}</b></div>
          <div class="lfg-row"><button class="${lang === "es" ? "primary" : "small-btn"}" data-lang="es">Español</button><button class="${lang === "en" ? "primary" : "small-btn"}" data-lang="en">English</button></div></div>
        <div class="set-row"><div><b>${t("set.tz")}</b><div class="small muted">${me.country ? `${flag(me.country)} · ` : ""}${esc(TZ)} · ${esc(new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}${me.tz ? "" : ` · ${t("set.tzDevice")}`}</div></div>
          <button class="small-btn" id="set-tz">${t("tz.change")}</button></div>
      </div>
    </section>
    <section>
      <div class="section-head"><h2>🔔 ${t("set.notifs")}</h2></div>
      <form class="card bp-prefs" id="set-nt"><p class="muted small">${t("loading")}</p></form>
    </section>
    <p class="actions"><a class="btn" href="/auth/logout">${t("auth.logout")}</a></p>`;
  el.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
  el.querySelector("#set-tz").onclick = () => openLocalePicker(user, () => location.reload());
  renderMinecraft?.();
  steam(el.querySelector("#acc-steam")).catch(fail(el, "#acc-steam"));
  apex(el.querySelector("#acc-apex")).catch(fail(el, "#acc-apex"));
  jellyfin(el.querySelector("#acc-jf")).catch(fail(el, "#acc-jf"));
  notifications(el.querySelector("#set-nt")).catch(() => {});
}
const fail = (el, sel) => (x) => { const b = el.querySelector(sel); if (b) b.insertAdjacentHTML("beforeend", `<p class="muted small">${esc(x.message)}</p>`); };

async function steam(box) {
  const s = await api("/api/steam");
  box.innerHTML = `<h3>🟦 Steam</h3>${!s.configured ? `<p class="muted">${t("play.noSteamKey")}</p>` : s.me ? `
    <p>${s.me.steam_avatar ? `<img class="soc-av" src="${esc(s.me.steam_avatar)}" alt="">` : ""} <b>${esc(s.me.persona || "Steam")}</b> · ${t("sg.nGames", { n: s.me.game_count })}</p>
    ${s.me.public ? "" : `<p class="hint">⚠ ${t("sg.privateHelp")}</p>`}
    <div class="lfg-row"><button class="small-btn" data-st="refresh">${t("acc.refresh")}</button><button class="small-btn danger" data-st="unlink">${t("acc.unlink")}</button></div>`
    : `<p class="muted small">${t("acc.steamWhy")}</p><a class="primary btn" href="/api/steam/link">${t("play.linkSteam")}</a><p class="hint">${t("acc.steamSafe")}</p>`}`;
  box.querySelectorAll("[data-st]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.st === "unlink" && !confirm(t("acc.unlinkQ"))) return;
    try { await api("/api/steam", { method: "POST", body: { action: b.dataset.st } }); toast("✓"); await steam(box); } catch (x) { toast(x.message, true); }
  }));
}

async function apex(box) {
  const a = await api("/api/apex");
  const ap = a.players.find((p) => p.mine);
  box.innerHTML = `<h3>🎯 Apex Legends</h3>${!a.configured ? `<p class="muted">${t("play.noApexKey")}</p>` : `
    ${ap ? `<p><b>${esc(ap.apex_name)}</b> · ${esc(ap.platform)} ${ap.rank?.name ? `· ${esc(ap.rank.name)} ${ap.rank.div || ""}` : ""}</p>` : `<p class="muted small">${t("acc.apexWhy")}</p>`}
    <form class="lfg-row" id="ap-form"><input name="name" maxlength="40" placeholder="${esc(t("acc.apexName"))}" value="${esc(ap?.apex_name || "")}" required>
      <select name="platform">${["PC", "PS4", "X1", "SWITCH"].map((p) => `<option value="${p}" ${ap?.platform === p ? "selected" : ""}>${{ PC: "PC (EA/Steam)", PS4: "PlayStation", X1: "Xbox", SWITCH: "Switch" }[p]}</option>`).join("")}</select>
      <button class="primary">${ap ? t("acc.save") : t("ap.link")}</button></form>
    <p class="hint">${t("acc.apexHint")}</p>
    ${ap ? `<div class="lfg-row"><button class="small-btn" data-ap="refresh">${t("acc.refresh")}</button><button class="small-btn danger" data-ap="unlink">${t("acc.unlink")}</button></div>` : ""}`}`;
  box.querySelectorAll("[data-ap]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.ap === "unlink" && !confirm(t("acc.unlinkQ"))) return;
    try { await api("/api/apex", { method: "POST", body: { action: b.dataset.ap } }); toast("✓"); await apex(box); } catch (x) { toast(x.message, true); }
  }));
  const f = box.querySelector("#ap-form");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector("button"); btn.disabled = true;
    try { await api("/api/apex", { method: "POST", body: { action: "link", name: f.name.value.trim(), platform: f.platform.value } }); toast(t("acc.apexOk")); await apex(box); }
    catch (x) { toast(x.message, true); btn.disabled = false; }
  };
}

async function jellyfin(box) {
  const j = await api("/api/juntos/jellyfin");
  box.innerHTML = `<h3>🎞️ Jellyfin</h3>
    <p class="muted small">${t("set.jfWhy")}</p>
    <form class="lfg-row" id="jf-f"><input name="n" maxlength="40" placeholder="${esc(t("cn.jfName"))}" value="${esc(j.name || "")}"><button class="primary">${t("acc.save")}</button></form>
    ${j.url ? `<p class="small"><a href="${esc(j.url)}" target="_blank" rel="noopener">${t("cn.open")} ↗</a></p>` : ""}`;
  box.querySelector("#jf-f").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("/api/juntos/jellyfin", { method: "POST", body: { name: e.target.n.value } }); toast("✓"); } catch (x) { toast(x.message, true); }
  };
}

async function notifications(form) {
  const d = await api("/api/notifications");
  const p = d.prefs || {};
  form.innerHTML = `<table><thead><tr><th></th><th>${t("nt.onSite")}</th><th>${t("nt.dm")}</th></tr></thead><tbody>
      ${NT_KINDS.map((k) => `<tr><td>${t("nt.k." + k)}</td>
        <td><input type="checkbox" name="${k}.site" ${p[k]?.site ? "checked" : ""}></td>
        <td><input type="checkbox" name="${k}.dm" ${p[k]?.dm ? "checked" : ""}></td></tr>`).join("")}
    </tbody></table><p class="hint">${t("nt.dmHint")}</p><button class="primary">${t("acc.save")}</button>`;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const out = {};
    for (const k of NT_KINDS) out[k] = { site: form[`${k}.site`].checked, dm: form[`${k}.dm`].checked };
    try { await api("/api/notifications", { method: "POST", body: { action: "prefs", prefs: out } }); toast("✓"); } catch (x) { toast(x.message, true); }
  };
}
