// Profile → ⚙️ Ajustes: linked accounts (Discord, Minecraft, Steam, Apex, Jellyfin), language, time zone, notifications.
import { ask, api, esc, t, toast, TZ, flag, openLocalePicker, NT_KINDS } from "./common.js";
import { lang, setLang } from "./i18n.js";
import { autoTrOn, setAutoTr } from "./autotr.js";
import { jellyfinInvite } from "./together.js";
import { isStandalone, isIOS, canInstall, installApp, pushState, enablePush, disablePush, makeVapidKeys } from "./pwa.js";

let USER_ROLE = "member";
let LINKED = {}, SUM = () => {};
const ICON = { discord: "💬", minecraft: "⛏️", steam: "🟦", apex: "🎯", jellyfin: "🎞️" };
function drawLinked() {
  const n = Object.values(LINKED).filter(Boolean).length;
  SUM("linked", `${Object.entries(LINKED).map(([k, v]) => `<span class="set-chip ${v ? "on" : v === null ? "wait" : ""}" title="${k}">${ICON[k]}</span>`).join("")}<span>${n}/5</span>`);
}
export async function mountSettings(el, user, me, renderMinecraft) {
  USER_ROLE = user.role;
  const sec = (id, title, body) => `<details class="set-sec" data-sec="${id}"><summary><span class="set-sec-t">${title}</span><span class="set-sec-s" id="sum-${id}"></span><span class="set-chev">▾</span></summary><div class="set-body">${body}</div></details>`;
  el.innerHTML = `
    <div class="set-list">
    ${sec("linked", `🔗 ${t("set.linked")}`, `
      <p class="muted small">${t("set.linkedWhy")}</p>
      <div class="acc-grid">
        <div class="card acc"><h3>💬 Discord</h3>
          <p><img class="soc-av" src="${esc(me.avatar || "")}" alt=""> <b>${esc(me.username)}</b></p>
          <p class="hint">${t("set.discordHint")}</p></div>
        <div class="card acc"><h3>⛏️ Minecraft</h3><div id="link"></div></div>
        <div class="card acc" id="acc-steam"><h3>🟦 Steam</h3><p class="muted small">${t("loading")}</p></div>
        <div class="card acc" id="acc-apex"><h3>🎯 Apex Legends</h3><p class="muted small">${t("loading")}</p></div>
        <div class="card acc" id="acc-jf"><h3>🎞️ Jellyfin</h3><p class="muted small">${t("loading")}</p></div>
      </div>`)}
    ${sec("prefs", `🌎 ${t("set.prefs")}`, `
      <div class="card set-rows">
        <div class="set-row"><div><b>${t("set.lang")}</b></div>
          <div class="lfg-row"><button class="${lang === "es" ? "primary" : "small-btn"}" data-lang="es">Español</button><button class="${lang === "en" ? "primary" : "small-btn"}" data-lang="en">English</button></div></div>
        <div class="set-row"><div><b>${t("set.autotr")}</b><div class="small muted">${t("set.autotrHint")}</div></div>
          <div class="lfg-row"><button class="${autoTrOn() ? "primary" : "small-btn"}" data-autotr="on">${t("set.autotrOn")}</button><button class="${autoTrOn() ? "small-btn" : "primary"}" data-autotr="off">${t("set.autotrOff")}</button></div></div>
        <div class="set-row"><div><b>${t("set.tz")}</b><div class="small muted">${me.country ? `${flag(me.country)} · ` : ""}${esc(TZ)} · ${esc(new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}${me.tz ? "" : ` · ${t("set.tzDevice")}`}</div></div>
          <button class="small-btn" id="set-tz">${t("tz.change")}</button></div>
      </div>`)}
    ${sec("app", `📱 ${t("pwa.title")}`, `<div class="card set-rows" id="set-app"><p class="muted small">${t("loading")}</p></div>`)}
    ${sec("notifs", `🔔 ${t("set.notifs")}`, `<form class="card bp-prefs" id="set-nt"><p class="muted small">${t("loading")}</p></form>`)}
    </div>
    <p class="actions"><a class="btn" href="/auth/logout">${t("auth.logout")}</a></p>`;
  // collapsed by default; remember which ones you opened
  let opened = [];
  try { opened = JSON.parse(localStorage.getItem("set.open") || "[]"); } catch { /* */ }
  if (new URLSearchParams(location.search).get("steam")) opened.push("linked");
  el.querySelectorAll(".set-sec").forEach((d) => {
    d.open = opened.includes(d.dataset.sec);
    d.addEventListener("toggle", () => {
      const now = [...el.querySelectorAll(".set-sec[open]")].map((x) => x.dataset.sec);
      try { localStorage.setItem("set.open", JSON.stringify(now)); } catch { /* */ }
    });
  });
  LINKED = { discord: true, minecraft: !!me.mc_name, steam: null, apex: null, jellyfin: null };
  SUM = (id, html) => { const x = el.querySelector(`#sum-${id}`); if (x) x.innerHTML = html; };
  drawLinked();
  SUM("prefs", `${lang === "es" ? "Español" : "English"} · ${esc(TZ.split("/").pop().replace(/_/g, " "))}`);
  el.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
  el.querySelectorAll("[data-autotr]").forEach((b) => (b.onclick = () => setAutoTr(b.dataset.autotr === "on")));
  el.querySelector("#set-tz").onclick = () => openLocalePicker(user, () => location.reload());
  renderMinecraft?.();
  steam(el.querySelector("#acc-steam")).catch(fail(el, "#acc-steam"));
  apex(el.querySelector("#acc-apex")).catch(fail(el, "#acc-apex"));
  jellyfin(el.querySelector("#acc-jf")).catch(fail(el, "#acc-jf"));
  notifications(el.querySelector("#set-nt")).catch(() => {});
  appCard(el.querySelector("#set-app"), user).catch(() => {});
}

async function appCard(box, user) {
  const [st, cfg] = await Promise.all([pushState(), api("/api/push").catch(() => ({ configured: false, devices: 0 }))]);
  const installed = isStandalone();
  SUM("app", `${installed ? "✓ App" : ""}${installed ? " · " : ""}${st === "on" ? "🔔 " + t("pwa.on") : "🔕 " + t("pwa.off")}`);
  const pushTxt = { on: t("pwa.pushOn"), off: t("pwa.pushOff"), denied: t("pwa.pushDenied"), unsupported: t("pwa.pushUnsupported"), "ios-needs-install": t("pwa.pushIOS") }[st];
  box.innerHTML = `
    <div class="set-row"><div><b>${t("pwa.install")}</b><div class="small muted">${installed ? "✓ " + t("pwa.installed") : isIOS() ? t("pwa.iosHow") : t("pwa.installWhy")}</div></div>
      ${!installed && !isIOS() ? `<button class="primary" id="app-install" ${canInstall() ? "" : "disabled"}>${t("pwa.install")}</button>` : ""}</div>
    <div class="set-row"><div><b>${t("pwa.push")}</b><div class="small muted">${cfg.configured ? pushTxt : t("pwa.notConfigured")}${cfg.devices ? ` · ${t("pwa.devices", { n: cfg.devices })}` : ""}</div></div>
      <div class="lfg-row">${cfg.configured && st === "off" ? `<button class="primary" id="push-on">🔔 ${t("pwa.enable")}</button>` : ""}
        ${cfg.configured && st === "on" ? `<button class="small-btn" id="push-test">${t("pwa.test")}</button><button class="link small" id="push-off">${t("pwa.disable")}</button>` : ""}</div></div>
    ${!cfg.configured && user.role === "admin" ? `<div class="set-row"><div class="small"><b>🛠 ${t("pwa.adminTitle")}</b><div class="muted">${t("pwa.adminHow")}</div><div id="vapid-out"></div></div>
      <button class="small-btn" id="vapid-gen">${t("pwa.genKeys")}</button></div>` : ""}`;
  const again = () => appCard(box, user);
  addEventListener("moikas:installable", again, { once: true });
  box.querySelector("#app-install")?.addEventListener("click", async () => { if (await installApp()) toast("✓"); again(); });
  box.querySelector("#push-on")?.addEventListener("click", async () => {
    try { await enablePush(); toast(t("pwa.enabled")); } catch (x) { toast(x.message === "push-denied" ? t("pwa.pushDenied") : x.message, true); }
    again();
  });
  box.querySelector("#push-off")?.addEventListener("click", async () => { await disablePush(); again(); });
  box.querySelector("#push-test")?.addEventListener("click", async () => {
    try { const r = await api("/api/push", { method: "POST", body: { action: "test" } }); toast(r.sent ? t("pwa.testSent") : t("pwa.testNone"), !r.sent); } catch (x) { toast(x.message, true); }
  });
  box.querySelector("#vapid-gen")?.addEventListener("click", async () => {
    const k = await makeVapidKeys();
    box.querySelector("#vapid-out").innerHTML = `<p>VAPID_PUBLIC_KEY<br><code class="copy">${esc(k.publicKey)}</code></p><p>VAPID_PRIVATE_KEY (${t("pwa.secret")})<br><code class="copy">${esc(k.privateKey)}</code></p>`;
  });
}
const fail = (el, sel) => (x) => { const b = el.querySelector(sel); if (b) b.insertAdjacentHTML("beforeend", `<p class="muted small">${esc(x.message)}</p>`); };

async function steam(box) {
  const s = await api("/api/steam");
  LINKED.steam = !!s.me; drawLinked();
  box.innerHTML = `<h3>🟦 Steam</h3>${!s.configured ? `<p class="muted">${t("play.noSteamKey")}</p>` : s.me ? `
    <p>${s.me.steam_avatar ? `<img class="soc-av" src="${esc(s.me.steam_avatar)}" alt="">` : ""} <b>${esc(s.me.persona || "Steam")}</b> · ${t("sg.nGames", { n: s.me.game_count })}</p>
    ${s.me.public ? "" : `<p class="hint">⚠ ${t("sg.privateHelp")}</p>`}
    <div class="lfg-row"><button class="small-btn" data-st="refresh">${t("acc.refresh")}</button><button class="small-btn danger" data-st="unlink">${t("acc.unlink")}</button></div>`
    : `<p class="muted small">${t("acc.steamWhy")}</p><a class="primary btn" href="/api/steam/link">${t("play.linkSteam")}</a><p class="hint">${t("acc.steamSafe")}</p>`}`;
  box.querySelectorAll("[data-st]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.st === "unlink" && !await ask(t("acc.unlinkQ"), { danger: true })) return;
    try { await api("/api/steam", { method: "POST", body: { action: b.dataset.st } }); toast("✓"); await steam(box); } catch (x) { toast(x.message, true); }
  }));
}

async function apex(box) {
  const a = await api("/api/apex");
  const ap = a.players.find((p) => p.mine);
  LINKED.apex = !!ap; drawLinked();
  box.innerHTML = `<h3>🎯 Apex Legends</h3>${!a.configured ? `<p class="muted">${t("play.noApexKey")}</p>` : `
    ${ap ? `<p><b>${esc(ap.apex_name)}</b> · ${esc(ap.platform)} ${ap.rank?.name ? `· ${esc(ap.rank.name)} ${ap.rank.div || ""}` : ""}</p>` : `<p class="muted small">${t("acc.apexWhy")}</p>`}
    <form class="lfg-row" id="ap-form"><input name="name" maxlength="40" placeholder="${esc(t("acc.apexName"))}" value="${esc(ap?.apex_name || "")}" required>
      <select name="platform">${["PC", "PS4", "X1", "SWITCH"].map((p) => `<option value="${p}" ${ap?.platform === p ? "selected" : ""}>${{ PC: "PC (EA/Steam)", PS4: "PlayStation", X1: "Xbox", SWITCH: "Switch" }[p]}</option>`).join("")}</select>
      <button class="primary">${ap ? t("acc.save") : t("ap.link")}</button></form>
    <p class="hint">${t("acc.apexHint")}</p>
    ${ap ? `<div class="lfg-row"><button class="small-btn" data-ap="refresh">${t("acc.refresh")}</button><button class="small-btn danger" data-ap="unlink">${t("acc.unlink")}</button></div>` : ""}`}`;
  box.querySelectorAll("[data-ap]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.ap === "unlink" && !await ask(t("acc.unlinkQ"), { danger: true })) return;
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
  LINKED.jellyfin = !!j.name; drawLinked();
  box.innerHTML = `<h3>🎞️ Jellyfin</h3>
    <p class="muted small">${t("set.jfWhy")}</p>
    <form class="lfg-row" id="jf-f"><input name="n" maxlength="40" placeholder="${esc(t("cn.jfName"))}" value="${esc(j.name || "")}"><button class="primary">${t("acc.save")}</button></form>
    ${j.url ? `<p class="small"><a href="${esc(j.url)}" target="_blank" rel="noopener">${t("cn.open")} ↗</a></p>` : ""}
    <div id="jf-inv"></div>`;
  jellyfinInvite(box.querySelector("#jf-inv"), { ...j, staff: null }, () => jellyfin(box));
  box.querySelector("#jf-f").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("/api/juntos/jellyfin", { method: "POST", body: { name: e.target.n.value } }); toast("✓"); } catch (x) { toast(x.message, true); }
  };
}

async function notifications(form) {
  const d = await api("/api/notifications");
  const p = d.prefs || {};
  const cnt = (ch) => NT_KINDS.filter((k) => p[k]?.[ch]).length;
  SUM("notifs", `🔔 ${cnt("site")} · 📱 ${cnt("push")} · 💬 ${cnt("dm")}`);
  form.innerHTML = `<table><thead><tr><th></th><th>${t("nt.onSite")}</th><th>${t("nt.push")}</th><th>${t("nt.dm")}</th></tr></thead><tbody>
      ${NT_KINDS.filter((k) => k !== "status" || ["staff", "subadmin", "admin"].includes(USER_ROLE)).map((k) => `<tr><td>${t("nt.k." + k)}</td>
        <td><input type="checkbox" name="${k}.site" ${p[k]?.site ? "checked" : ""}></td>
        <td><input type="checkbox" name="${k}.push" ${p[k]?.push ? "checked" : ""}></td>
        <td><input type="checkbox" name="${k}.dm" ${p[k]?.dm ? "checked" : ""}></td></tr>`).join("")}
    </tbody></table><p class="hint">${t("nt.dmHint")}</p><button class="primary">${t("acc.save")}</button>`;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const out = {};
    for (const k of NT_KINDS) if (form[`${k}.site`]) out[k] = { site: form[`${k}.site`].checked, push: form[`${k}.push`].checked, dm: form[`${k}.dm`].checked };
    try { await api("/api/notifications", { method: "POST", body: { action: "prefs", prefs: out } }); toast("✓"); } catch (x) { toast(x.message, true); }
  };
}
