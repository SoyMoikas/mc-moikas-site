// Shared helpers for every page.
import { t, tErr, lang, locale, setLang, applyStatic } from "./i18n.js";
import { registerApp, isStandalone, canInstall, installApp, isIOS } from "./pwa.js";
import { levelBadge, levelInfo } from "./levels.js";
import { avatarHTML, nameHTML, fromAuthor, loadCatalog, catalogItem, applyTabFx, bgCSS, bgStyle, bgAnimated, bgWall, textAttrs } from "./cosmetics.js";
import { applyTheme, applyCachedTheme } from "./themes.js";
applyCachedTheme();
export { t, lang, levelBadge, avatarHTML, nameHTML, bgStyle, bgAnimated, bgWall, textAttrs };

const RANK = { pending: 0, member: 1, staff: 2, subadmin: 3, admin: 4 };
export const can = (user, role) => !!user && RANK[user.role] >= RANK[role];
// Admin powers (users / servers / store). Admins have all; sub-admins only what they were given.
export const perm = (user, p) => !!user && (user.role === "admin" || (user.role === "subadmin" && (user.permissions || []).includes(p)));

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// Escape text, then turn bare URLs into links.
export function rich(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)"']/g, (u) => `<a href="${u}" target="_blank" rel="noopener nofollow">${u}</a>`);
}

export async function api(path, { method = "GET", body } = {}) {
  const opts = { method, headers: {}, credentials: "same-origin", cache: "no-store" };
  if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(tErr(data.error || `Request failed (${r.status})`));
  return data;
}

// Upload an image file → "/api/uploads/<id>.<ext>". Photos are shrunk (max `maxSide` px) and re-encoded as WebP
// so they stay small; GIFs go up untouched so they keep animating. keepOriginal: send the file as-is when it's small
// enough (store art, pixel textures, frames that must stay exactly 384×384).
export async function uploadImage(file, { maxSide = 1600, keepOriginal = false } = {}) {
  const MAX = 1.4 * 1024 * 1024;
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) throw new Error(t("up.badType"));
  let blob = file;
  const small = file.size <= MAX;
  if (file.type !== "image/gif" && !(keepOriginal && small)) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55]) {
      blob = await new Promise((res) => c.toBlob(res, "image/webp", q));
      if (blob && blob.size <= MAX) break;
    }
    if (small && blob.size > file.size) blob = file; // re-encoding made it bigger: keep the original
  }
  if (blob.size > MAX) throw new Error(t("up.tooBig"));
  const r = await fetch("/api/uploads", { method: "POST", headers: { "content-type": blob.type || file.type }, body: blob, credentials: "same-origin" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(tErr(data.error || `Upload failed (${r.status})`));
  return data.url;
}

export function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}
export function fmtDateTime(v) {
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return t("ago.now");
  const m = Math.round(s / 60); if (m < 60) return t("ago.m", { n: m });
  const h = Math.round(m / 60); if (h < 24) return t("ago.h", { n: h });
  const d = Math.round(h / 24); if (d < 30) return t("ago.d", { n: d });
  return fmtDate(ms);
}

export const roleLabel = (r) => t(`role.${r}`);
export const tagLabel = (tag) => t(`tag.${tag || "Announcement"}`);
export const taskLabel = (s) => t(`task.${s}`);

// Pick the Spanish version of a field when the viewer reads Spanish and it exists.
export const localized = (en, es) => (lang === "es" && es && (!Array.isArray(es) || es.length) ? es : en);

export function statusBadge(s) {
  if (!s.status) return "";
  let label = t(`status.${s.status}`);
  if (s.status === "running" && s.players_online !== null && s.players_online !== undefined) {
    label += ` · ${s.players_online}/${s.players_max ?? "?"}`;
  }
  return `<span class="status ${esc(s.status)}"><span class="dot"></span>${esc(label)}</span>`;
}

// Card dialogs instead of the browser's confirm() / alert() / prompt(). All return promises.
//   await ask("¿Borrar?")                 → true / false      (opts: { ok, danger, icon })
//   notice("¡Listo!")                      → resolves when closed
//   await askText("¿Cuánto?", "20")       → string, or null if cancelled
function cardDialog({ msg, input, def = "", ok, cancel = true, danger = false, icon = "" }) {
  return new Promise((resolve) => {
    const dlg = document.createElement("div");
    dlg.className = "buy-modal ask-modal";
    dlg.innerHTML = `
      <form class="card buy-card ask-card" role="dialog" aria-modal="true">
        ${icon ? `<div class="ask-icon">${icon}</div>` : ""}
        <p class="ask-msg"></p>
        ${input ? `<input name="v" maxlength="500" autocomplete="off">` : ""}
        <div class="actions">${cancel ? `<button type="button" data-no>${t("cancel")}</button>` : ""}
          <button class="primary ${danger ? "danger-fill" : ""}" data-yes>${esc(ok || (cancel ? t("dlg.ok") : t("dlg.gotIt")))}</button></div>
      </form>`;
    dlg.querySelector(".ask-msg").textContent = String(msg ?? "");
    const f = dlg.querySelector("form");
    if (input) f.v.value = def ?? "";
    let closed = false;
    const done = (v) => { if (closed) return; closed = true; removeEventListener("keydown", onKey); dlg.classList.add("closing"); setTimeout(() => dlg.remove(), 150); resolve(v); };
    const no = input ? null : cancel ? false : true;
    const onKey = (e) => { if (e.key === "Escape") done(no); };
    f.onsubmit = (e) => { e.preventDefault(); done(input ? f.v.value : true); };
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-no]")) done(no); });
    addEventListener("keydown", onKey);
    document.body.appendChild(dlg);
    (input ? f.v : f.querySelector("[data-yes]")).focus();
    if (input) f.v.select();
  });
}
export const ask = (msg, opts = {}) => cardDialog({ msg, ...opts });
export const notice = (msg, opts = {}) => cardDialog({ msg, cancel: false, ...opts });
export const askText = (msg, def = "", opts = {}) => cardDialog({ msg, input: true, def, ...opts });

export function toast(msg, error = false) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = error ? "error" : "";
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3000);
}

// Site-wide info loaded on every page: games (for the nav menu) and the like emoji.
export const SITE = { games: [], like_emoji: "❤️" };
export const gameLabel = (g) => (g ? (lang === "es" && g.name_es ? g.name_es : g.name) : "");

// Builds the top bar, translates static text, and returns the logged-in user (or null).
export async function initPage() {
  applyStatic();
  registerApp();
  let user = null;
  const [me, site] = await Promise.allSettled([api("/api/me"), api("/api/site"), loadCatalog()]);
  if (me.status === "fulfilled") user = me.value.user;
  if (user?.tz && validTz(user.tz)) TZ = user.tz;
  if (user && user.role !== "pending" && !user.tz) setTimeout(() => localeBanner(user), 800);
  else if (user && user.role !== "pending") setTimeout(() => appBanner(), 4000);
  if (site.status === "fulfilled") Object.assign(SITE, site.value);
  // visit log for the admin Activity tab (fire-and-forget; admin pages aren't counted)
  if (!location.pathname.startsWith("/admin")) {
    fetch("/api/visit", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: location.pathname + (location.pathname === "/server" || location.pathname === "/game" || location.pathname === "/map" ? location.search : ""), ref: document.referrer || null }) }).catch(() => {});
  }

  const bar = document.createElement("header");
  bar.className = "topbar";
  const here = location.pathname;
  const curGame = here === "/game" ? new URLSearchParams(location.search).get("id") : null;
  const gamesMenu = SITE.games.length ? `
    <details class="nav-games">
      <summary class="${curGame ? "active" : ""}">${curGame ? esc(gameLabel(SITE.games.find((g) => g.id === curGame)) || t("nav.games")) : t("nav.games")} ▾</summary>
      <div class="nav-games-menu">
        ${SITE.games.map((g) => `<a href="/game?id=${encodeURIComponent(g.id)}" class="${g.id === curGame ? "active" : ""}">
          <span class="g-ico">${esc(g.icon || "🎮")}</span>${esc(gameLabel(g))}</a>`).join("")}
      </div>
    </details>` : "";
  const navLink = (href, key) => `<a href="${href}" class="${here === href || (href !== "/" && here.startsWith(href)) ? "active" : ""}">${t(key)}</a>`;
  bar.innerHTML = `
    <div class="wrap">
      <button class="menu-btn" aria-label="${esc(t("nav.menu"))}" aria-expanded="false">☰</button>
      <a class="brand" href="/">Moikas</a>
      <nav>
        ${navLink("/", "nav.home")}
        ${gamesMenu}
        ${navLink("/quests", "nav.quests")}
        ${navLink("/ranking", "nav.ranking")}
        ${navLink("/play", "nav.play")}
        ${navLink("/tournaments", "nav.tournaments")}
        ${user && user.role !== "pending" ? navLink("/juntos", "nav.juntos") + navLink("/casino", "nav.casino") + navLink("/rol", "nav.rol") + navLink("/status", "nav.status") : ""}
        ${navLink("/store", "nav.store")}
        ${["users", "servers", "store"].some((p) => perm(user, p)) ? navLink("/admin", "nav.admin") : ""}
      </nav>
      <div class="userbox">
        <button class="lang" title="${esc(t("lang.switchTitle"))}" data-lang="${lang === "es" ? "en" : "es"}">${t("lang.switch")}</button>
        ${user && user.role !== "pending" ? `<div class="bell-wrap"><button class="bell" aria-label="${esc(t("nt.title"))}">🔔<span class="bell-n hidden"></span></button><div class="bell-panel hidden"></div></div>` : ""}
        ${user
          ? `<a class="me" href="/profile" title="${esc(t("nav.profile"))}">${avatarHTML(user, 28)}
               <span class="me-text"><span class="me-top"><span class="uname">${esc(user.username)}</span>${levelBadge(user.xp)}</span>
                 ${xpMini(user.xp)}</span></a>
             <span class="role ${esc(user.role)}">${esc(roleLabel(user.role))}</span>
             <a class="small muted logout" href="/auth/logout">${t("auth.logout")}</a>`
          : `<a class="btn discord" href="/auth/login?next=${encodeURIComponent(location.pathname + location.search)}">${t("auth.login")}</a>`}
      </div>
    </div>`;
  document.body.prepend(bar);
  bar.querySelector("[data-lang]").onclick = (e) => setLang(e.currentTarget.dataset.lang);
  if (bar.querySelector(".bell")) mountBell(bar.querySelector(".bell-wrap"));

  // Your wallpaper (only you see it).
  const wp = user && catalogItem(user.eq_wallpaper);
  if (wp) {
    document.body.style.setProperty("--wallpaper", bgCSS(wp.visual));
    document.body.classList.add("has-wallpaper");
    if (wp.visual?.animate) document.body.classList.add("wallpaper-anim");
    if (wp.visual?.pixel) document.body.classList.add("wallpaper-pixel");
  }

  // Game pages take on that game's color as the accent.
  const g = SITE.games.find((x) => x.id === curGame);
  if (g && /^#[0-9a-f]{6}$/i.test(g.color || "")) document.documentElement.style.setProperty("--accent", g.color);

  // Your site theme (only you see it). Applied early from the last visit too, so pages don't flash.
  applyTheme(user ? catalogItem(user.eq_theme) : null);
  applyTabFx(user ? catalogItem(user.eq_tabfx) : null);

  // App shell: left rail (nav, games, your level) + the page's <main>. On narrow screens the rail hides
  // and the top bar's nav takes over.
  const main = document.querySelector("main");
  if (main) {
    const isAdmin = ["users", "servers", "store"].some((p) => perm(user, p));
    const railLink = (href, icon, key) => `<a href="${href}" class="${here === href || (href !== "/" && here.startsWith(href)) ? "active" : ""}"><span class="ri">${icon}</span>${t(key)}</a>`;
    const rail = document.createElement("aside");
    rail.className = "rail";
    const l = user ? levelInfo(user.xp) : null;
    rail.innerHTML = `
      <nav class="rail-nav">
        ${railLink("/", "🏠", "nav.home")}
        ${railLink("/quests", "🎯", "nav.quests")}
        ${railLink("/ranking", "🏆", "nav.ranking")}
        ${railLink("/play", "🎮", "nav.play")}
        ${railLink("/tournaments", "⚔️", "nav.tournaments")}
        ${user && user.role !== "pending" ? railLink("/juntos", "🫂", "nav.juntos") + railLink("/casino", "🎰", "nav.casino") + railLink("/rol", "🐉", "nav.rol") + railLink("/status", "🟢", "nav.status") : ""}
        ${railLink("/store", "🪙", "nav.store")}
        ${isAdmin ? railLink("/admin", "⚙️", "nav.admin") : ""}
      </nav>
      ${SITE.games.length ? `
        <div class="rail-title">${t("nav.games")}</div>
        <nav class="rail-games">
          ${SITE.games.map((x) => {
            const gc = esc(/^#[0-9a-f]{6}$/i.test(x.color || "") ? x.color : "#8a93a8");
            const curServer = here === "/server" ? new URLSearchParams(location.search).get("id") : null;
            return `<a href="/game?id=${encodeURIComponent(x.id)}" class="${x.id === curGame ? "active" : ""}" style="--gc:${gc}">
              <span class="gt">${esc(x.icon || "🎮")}</span><span class="gn">${esc(gameLabel(x))}</span></a>
              ${(x.servers || []).map((sv) => `<a class="rail-server ${sv.id === curServer ? "active" : ""}" style="--gc:${gc}" href="/server?id=${encodeURIComponent(sv.id)}"><span class="rs-dot"></span>${esc(sv.name)}</a>`).join("")}`;
          }).join("")}
        </nav>` : ""}
      ${user ? `
        <a class="rail-me ${user.eq_banner ? "has-art" : ""} ${bgAnimated(user.eq_banner) ? "art-anim" : ""}" href="/profile" style="--rank:${l.color};${bgStyle(user.eq_banner)}">
          <div class="rm-top">${avatarHTML(user, 36)}
            <div class="rm-who"><b>${esc(user.username)}</b><span class="rm-rank">${t("lvl.short")} ${l.level} · ${esc(l.rank)}</span></div></div>
          <div class="rm-bar"><span style="width:${l.pct}%"></span></div>
          <div class="rm-foot"><span>${esc(t("xp.toNext", { n: (l.needed - l.into).toLocaleString(), level: l.level + 1 }))}</span><span class="rm-coins">🪙 ${(user.coins || 0).toLocaleString()}</span></div>
        </a>` : ""}
    `;
    const shell = document.createElement("div");
    shell.className = "shell";
    main.replaceWith(shell);
    shell.append(rail, main);
    // On phones/tablets the rail is a slide-out drawer opened by the ☰ button.
    const backdrop = document.createElement("div");
    backdrop.className = "rail-backdrop";
    document.body.append(backdrop);
    const menuBtn = bar.querySelector(".menu-btn");
    const setOpen = (open) => {
      document.body.classList.toggle("rail-open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.textContent = open ? "✕" : "☰";
    };
    menuBtn.onclick = () => setOpen(!document.body.classList.contains("rail-open"));
    backdrop.onclick = () => setOpen(false);
    rail.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
    if (!user) rail.insertAdjacentHTML("beforeend", `<a class="btn discord rail-login" href="/auth/login?next=${encodeURIComponent(location.pathname + location.search)}">${t("auth.login")}</a>`);
    rail.insertAdjacentHTML("beforeend", `<div class="rail-foot">
      ${user ? `<a class="small muted" href="/auth/logout">${t("auth.logout")}</a>` : ""}
      <button class="lang" data-lang2="${lang === "es" ? "en" : "es"}">${t("lang.switch")}</button></div>`);
    rail.querySelector("[data-lang2]").onclick = (e) => setLang(e.currentTarget.dataset.lang2);

    const footer = document.querySelector("body > footer");
    if (footer) main.append(footer);
    main.classList.add("page");
  }

  // Close the games menu when clicking elsewhere.
  document.addEventListener("click", (e) => {
    const d = bar.querySelector(".nav-games");
    if (d?.open && !d.contains(e.target)) d.open = false;
  });

  // Side-rail announcements are clamped to 3 lines; click to expand.
  document.addEventListener("click", (e) => {
    const body = e.target.closest(".col-side .post .body");
    if (body && !e.target.closest("a")) body.closest(".post").classList.toggle("open");
  });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-copy]");
    if (!b) return;
    e.preventDefault();
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = t("copied"); }
    catch { b.textContent = t("copyFail"); }
    setTimeout(() => (b.textContent = t("copy")), 1500);
  });
  return user;
}

// Phones: bottom tab bar. On the home page it mirrors the page's own tabs (Inicio / Jugar / Ocaso / Gratis) + Chat;
// elsewhere it's Feed / Chat. `mirror` = selector of the page's tab row (hidden on phones, kept in sync).
const MPANE_ICON = { inicio: "🏠", jugar: "🎮", ocaso: "🌅", gratis: "🎁" };
export function mountMobileTabs({ mirror = null } = {}) {
  if (document.querySelector(".m-tabs")) return;
  const src = mirror ? [...document.querySelectorAll(`${mirror} [data-pane]`)] : [];
  const bar = document.createElement("nav");
  bar.className = "m-tabs";
  bar.innerHTML = (src.length
    ? src.map((b) => `<button data-mtab="feed" data-mpane="${b.dataset.pane}"><span>${MPANE_ICON[b.dataset.pane] || "•"}</span><em>${esc(b.textContent.trim().replace(/^[^\p{L}\p{N}]+/u, ""))}</em><i class="m-dot hidden"></i></button>`).join("")
    : `<button data-mtab="feed" class="active"><span>📰</span><em>${t("mtab.feed")}</em></button>`)
    + `<button data-mtab="chat"><span>💬</span><em>${t("mtab.chat")}</em><i class="m-dot hidden" data-chatdot></i></button>`;
  bar.style.setProperty("--n", bar.children.length);
  document.body.append(bar);
  document.body.classList.add("has-mtabs", "mtab-feed");
  if (src.length) document.body.classList.add("has-mpanes");
  const dot = bar.querySelector("[data-chatdot]");
  const sync = () => {
    const chat = document.body.classList.contains("mtab-chat");
    for (const b of bar.querySelectorAll("[data-mpane]")) {
      const top = src.find((x) => x.dataset.pane === b.dataset.mpane);
      b.hidden = top.hidden;
      b.classList.toggle("active", !chat && top.classList.contains("on"));
      b.querySelector(".m-dot").classList.toggle("hidden", !top.classList.contains("has-new"));
    }
    if (!src.length) bar.querySelector('[data-mtab="feed"]').classList.toggle("active", !chat);
    bar.querySelector('[data-mtab="chat"]').classList.toggle("active", chat);
  };
  src.forEach((b) => new MutationObserver(sync).observe(b, { attributes: true, attributeFilter: ["class", "hidden"] }));
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mtab]");
    if (!b) return;
    const tab = b.dataset.mtab;
    document.body.classList.toggle("mtab-feed", tab === "feed");
    document.body.classList.toggle("mtab-chat", tab === "chat");
    if (b.dataset.mpane) src.find((x) => x.dataset.pane === b.dataset.mpane)?.click();
    if (tab === "chat") {
      dot.classList.add("hidden");
      const log = document.querySelector(".side-chat .chat-log");
      if (log) log.scrollTop = log.scrollHeight;
    }
    sync();
    window.scrollTo(0, 0);
  });
  sync();
  // Show a dot on the Chat tab when new messages arrive while you're elsewhere.
  const log = document.querySelector(".side-chat .chat-log");
  if (log) new MutationObserver(() => {
    if (document.body.classList.contains("mtab-feed")) dot.classList.remove("hidden");
  }).observe(log, { childList: true });
}

// Thin XP bar with "X XP to level N" tooltip.
export function xpMini(xp) {
  const l = levelInfo(xp);
  const tip = t("xp.toNext", { n: (l.needed - l.into).toLocaleString(), level: l.level + 1 });
  return `<span class="xp-mini" title="${esc(tip)}" style="--rank:${l.color}"><span style="width:${l.pct}%"></span></span>`;
}

export const loginHint = (user) => !user
  ? t("sp.loginToJoin", { href: `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}` })
  : user.role === "pending" ? t("sp.pendingNotice") : "";

// Reads a form into a plain object (checkboxes → booleans).
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  return out;
}

// Wraps a submit handler with busy state + error toast.
export function onSubmit(form, fn) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btns = form.querySelectorAll("button");
    btns.forEach((b) => (b.disabled = true));
    try { await fn(formData(form)); }
    catch (err) { toast(err.message, true); }
    finally { btns.forEach((b) => (b.disabled = false)); }
  });
}

// datetime-local inputs have no timezone: they're read and written in YOUR chosen time zone (TZ),
// and stored as an exact moment, so everyone else sees it in theirs.
export const toISO = (v) => (v ? new Date(inputToMs(v)).toISOString() : null);
export function toLocalInput(v) {
  if (!v) return "";
  const ms = typeof v === "number" ? v : Date.parse(v);
  return isNaN(ms) ? "" : msToInput(ms);
}

export const POST_TAGS = ["Announcement", "Event", "Update", "Maintenance", "Goal"];

export function postForm(values = {}, { servers = null } = {}) {
  const ev = toLocalInput(values.event_at);
  return `
    <form class="stack card">
      ${servers ? `<label>${t("pf.where")}
        <select name="server_id">
          <option value="">${t("pf.everywhere")}</option>
          ${servers.map((s) => `<option value="${esc(s.id)}" ${values.server_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
        </select></label>` : ""}
      <div class="row">
        <label>${t("pf.title")} <input name="title" maxlength="140" required value="${esc(values.title)}"></label>
        <label>${t("pf.type")} <select name="tag">${POST_TAGS.map((tg) => `<option value="${tg}" ${values.tag === tg ? "selected" : ""}>${tagLabel(tg)}</option>`).join("")}</select></label>
        <label>${t("pf.eventTime")} <input type="datetime-local" name="event_at" value="${esc(ev)}"></label>
      </div>
      <label>${t("pf.message")} <textarea name="body" maxlength="8000" required>${esc(values.body)}</textarea></label>
      <div class="actions">
        <label class="check"><input type="checkbox" name="pinned" ${values.pinned ? "checked" : ""}> ${t("pf.pin")}</label>
        <span style="flex:1"></span>
        <button type="button" data-cancel>${t("cancel")}</button>
        <button class="primary">${values.id ? t("save") : t("post")}</button>
      </div>
    </form>`;
}

export function renderPost(p, { user, showServer = false } = {}) {
  const a = p.author ? fromAuthor(p) : null;
  return `
    <article class="card post ${a ? "has-author" : ""}" data-post="${p.id}">
      ${a ? `<div class="post-av">${avatarHTML(a, 44)}</div>` : ""}
      <div class="post-main">
        <div class="meta">
          ${a ? `<span class="post-author">${nameHTML(a)} ${levelBadge(a.xp)}</span>` : ""}
          ${p.pinned ? `<span class="pin">${t("pf.pinned")}</span>` : ""}
          <span class="tag ${esc(p.tag)}">${esc(tagLabel(p.tag))}</span>
          <span>${fmtDate(p.created_at)}</span>
          ${showServer ? (p.server_id
            ? `<a class="server-link" href="/server?id=${encodeURIComponent(p.server_id)}">${esc(p.server_name)}</a>`
            : p.game_id ? `<span class="server-link muted">${esc(p.game_icon || "")} ${t("allServers")}</span>`
            : `<span class="server-link muted">${t("allServers")}</span>`) : ""}
        </div>
        <h3>${esc(p.title)}</h3>
        <div class="body">${rich(p.body)}</div>
        ${p.event_at ? `<div class="event">🗓 ${esc(fmtDateTime(p.event_at))}</div>` : ""}
        ${can(user, "staff") ? `<div class="actions" style="margin-top:10px">
          <button class="link" data-edit-post="${p.id}">${t("edit")}</button>
          <button class="link" data-delete-post="${p.id}">${t("delete")}</button></div>` : ""}
      </div>
    </article>`;
}

// Wires up edit/delete buttons on rendered posts. `reload` re-renders the page section.
export function bindPostActions(root, posts, { user, reload }) {
  root.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delete-post]");
    const edit = e.target.closest("[data-edit-post]");
    if (del) {
      if (!await ask(t("pf.confirmDelete"), { danger: true })) return;
      try { await api(`/api/posts/${del.dataset.deletePost}`, { method: "DELETE" }); toast(t("pf.deleted")); reload(); }
      catch (err) { toast(err.message, true); }
    } else if (edit) {
      const p = posts().find((x) => String(x.id) === edit.dataset.editPost);
      const card = edit.closest("[data-post]");
      const holder = document.createElement("div");
      holder.innerHTML = postForm(p);
      card.replaceWith(holder);
      const form = holder.querySelector("form");
      form.querySelector("[data-cancel]").onclick = reload;
      onSubmit(form, async (d) => {
        await api(`/api/posts/${p.id}`, { method: "PATCH", body: { ...d, event_at: toISO(d.event_at) } });
        toast(t("saved")); reload();
      });
    }
  });
}

// Live updates. The chat's quick poll carries a "pulse" (fingerprints of the feed and the
// announcements); anything on the page can subscribe and refresh only when its part changed.
const pulseLast = {};
export function emitPulse(p) {
  for (const k in p || {}) {
    const changed = k in pulseLast && pulseLast[k] !== p[k];
    pulseLast[k] = p[k];
    if (changed) window.dispatchEvent(new CustomEvent(`pulse:${k}`));
  }
}
export function onPulse(key, fn) { window.addEventListener(`pulse:${key}`, fn); }

// Announcements refresh as soon as the pulse says they changed (plus a slow fallback).
// Skips while the tab is hidden or someone is writing/editing a post.
export function livePosts(fetchPosts, renderList, ms = 60_000) {
  const refresh = async () => {
    const box = document.getElementById("posts");
    if (document.hidden || !box || box.querySelector("form, details[open]") || document.querySelector("#post-form form")) return;
    try { box.innerHTML = renderList(await fetchPosts()); } catch { /* try again later */ }
  };
  onPulse("posts", refresh);
  setInterval(refresh, ms);
}


/* ---------------- Notifications bell ---------------- */

export const NT_KINDS = ["reply", "announce", "game", "night", "free", "quest", "achieve", "fun", "status"];

function mountBell(wrap) {
  const btn = wrap.querySelector(".bell"), badge = wrap.querySelector(".bell-n"), panel = wrap.querySelector(".bell-panel");
  const setCount = (n) => { badge.textContent = n > 9 ? "9+" : n; badge.classList.toggle("hidden", !n); document.title = document.title.replace(/^\(\d+\+?\) /, "") ; if (n) document.title = `(${n > 9 ? "9+" : n}) ${document.title}`; };
  const poll = async () => { if (document.hidden) return; try { setCount((await api("/api/notifications?count=1")).unread); } catch {} };
  poll(); setInterval(poll, 60000);
  document.addEventListener("visibilitychange", poll);

  const list = async () => {
    const d = await api("/api/notifications");
    panel.innerHTML = `
      <div class="bp-head"><b>${t("nt.title")}</b>
        <span>${d.unread ? `<button class="link" data-all>${t("nt.markAll")}</button>` : ""} <button class="link" data-prefs>⚙ ${t("nt.settings")}</button></span></div>
      <div class="bp-list">${d.items.map((n) => `
        <a class="bp-item ${n.read_at ? "" : "unread"}" href="${esc(n.url || "#")}" data-id="${n.id}">
          <b>${esc(n.title)}</b>${n.body ? `<span class="small muted">${esc(n.body).replace(/\{t:(\d{10,14})\}/g, (_, ms) => esc(new Date(+ms).toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" })))}</span>` : ""}<span class="small muted">${esc(ago(n.created_at))}</span></a>`).join("")
        || `<p class="muted small" style="padding:12px">${t("nt.empty")}</p>`}</div>`;
    panel.querySelector("[data-all]")?.addEventListener("click", async () => { await api("/api/notifications", { method: "POST", body: { action: "read" } }); setCount(0); list(); });
    panel.querySelector("[data-prefs]").onclick = () => prefs(d.prefs);
    panel.querySelectorAll(".bp-item").forEach((a) => a.addEventListener("click", () => {
      if (a.classList.contains("unread")) fetch("/api/notifications", { method: "POST", keepalive: true, credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "read", id: +a.dataset.id }) }).catch(() => {});
    }));
  };
  const prefs = (p) => {
    panel.innerHTML = `
      <div class="bp-head"><b>⚙ ${t("nt.settings")}</b><button class="link" data-back>← ${t("nt.back")}</button></div>
      <form class="bp-prefs"><table><thead><tr><th></th><th>${t("nt.onSite")}</th><th>${t("nt.push")}</th><th>${t("nt.dm")}</th></tr></thead><tbody>
        ${NT_KINDS.map((k) => `<tr><td>${t("nt.k." + k)}</td>
          <td><input type="checkbox" name="${k}.site" ${p[k]?.site ? "checked" : ""}></td>
          <td><input type="checkbox" name="${k}.push" ${p[k]?.push ? "checked" : ""}></td>
          <td><input type="checkbox" name="${k}.dm" ${p[k]?.dm ? "checked" : ""}></td></tr>`).join("")}
      </tbody></table><p class="hint">${t("nt.dmHint")}</p><button class="primary">${t("acc.save")}</button></form>`;
    panel.querySelector("[data-back]").onclick = list;
    panel.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const out = {};
      for (const k of NT_KINDS) out[k] = { site: e.target[`${k}.site`].checked, push: e.target[`${k}.push`].checked, dm: e.target[`${k}.dm`].checked };
      try { await api("/api/notifications", { method: "POST", body: { action: "prefs", prefs: out } }); toast("✓"); list(); } catch (x) { toast(x.message, true); }
    };
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    const open = panel.classList.toggle("hidden") === false;
    if (open) { panel.innerHTML = `<p class="muted small" style="padding:12px">${t("loading")}</p>`; list().catch(() => {}); }
  };
  document.addEventListener("click", (e) => {
    if (!e.target.isConnected || wrap.contains(e.target)) return; // (clicks that re-render the panel detach their target)
    panel.classList.add("hidden");
  });
}


/* ---------------- Time zone ---------------- */
// Every date on the site shows in TZ: your saved zone, or your device's until you pick one.

export const DEVICE_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();
export let TZ = DEVICE_TZ;
export function validTz(tz) { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return !!tz; } catch { return false; } }

// Make toLocaleString/DateString/TimeString and Intl.DateTimeFormat use TZ unless a zone is given.
(() => {
  const P = Date.prototype;
  for (const m of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]) {
    const orig = P[m];
    P[m] = function (loc, opts) { return orig.call(this, loc, opts && opts.timeZone ? opts : { ...(opts || {}), timeZone: TZ }); };
  }
  const Orig = Intl.DateTimeFormat;
  const Wrapped = function (loc, opts) { return new Orig(loc, opts && opts.timeZone ? opts : { ...(opts || {}), timeZone: TZ }); };
  Wrapped.prototype = Orig.prototype;
  Wrapped.supportedLocalesOf = Orig.supportedLocalesOf;
  Intl.DateTimeFormat = Wrapped;
})();

// Wall-clock parts of a moment in a zone, and the zone's offset from UTC at that moment (minutes).
function parts(ms, tz) {
  const o = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}
const offsetMin = (ms, tz) => { const o = parts(ms, tz); return (Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second) - Math.floor(ms / 1000) * 1000) / 60000; };
export function inputToMs(v, tz = TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || "");
  if (!m) return NaN;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ms = wall - offsetMin(wall, tz) * 60000;
  ms = wall - offsetMin(ms, tz) * 60000; // second pass settles DST edges
  return ms;
}
export function msToInput(ms, tz = TZ) {
  const o = parts(ms, tz);
  return `${o.year}-${o.month}-${o.day}T${String(+o.hour % 24).padStart(2, "0")}:${o.minute}`;
}
// "Friday 9 pm" style helpers: a Date-like set of fields in TZ (for building default times)
export function zonedNow(tz = TZ) { const o = parts(Date.now(), tz); return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, dow: new Date(Date.UTC(+o.year, +o.month - 1, +o.day)).getUTCDay() }; }
export const wallInput = (y, mo, d, h = 0, mi = 0) => { const x = new Date(Date.UTC(y, mo - 1, d, h, mi)); return x.toISOString().slice(0, 16); };

export const flag = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0))) : "");
const COUNTRIES = "MX US GT SV HN NI CR PA CU DO PR CO VE EC PE BO CL AR UY PY BR ES CA GB FR DE IT PT NL BE CH AT IE SE NO DK FI PL CZ RO GR TR RU UA JP KR CN TW HK PH VN TH ID MY SG IN PK AU NZ ZA EG MA NG KE IL SA AE".split(" ");
const PREFERRED_TZ = ["America/Mexico_City", "America/Monterrey", "America/Tijuana", "America/Hermosillo", "America/Chihuahua", "America/Mazatlan", "America/Cancun",
  "America/Los_Angeles", "America/Denver", "America/Phoenix", "America/Chicago", "America/New_York", "America/Guatemala", "America/Bogota", "America/Lima", "America/Argentina/Buenos_Aires", "Europe/Madrid"];

const zoneLabel = (z) => {
  const city = z.split("/").pop().replace(/_/g, " ");
  let now = "";
  try { now = new Date().toLocaleTimeString(undefined, { timeZone: z, hour: "numeric", minute: "2-digit" }); } catch {}
  return `${city} — ${now}`;
};

/** Opens the time zone / country picker. onSaved(tz, country) after saving. */
export async function openLocalePicker(user, onSaved) {
  const d = await api("/api/locale").catch(() => ({ detected: {} }));
  const all = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : PREFERRED_TZ).filter((z) => z.includes("/"));
  const top = [...new Set([user.tz, DEVICE_TZ, d.detected?.tz, ...PREFERRED_TZ].filter((z) => z && validTz(z)))];
  const names = (() => { try { return new Intl.DisplayNames([lang === "es" ? "es" : "en"], { type: "region" }); } catch { return { of: (c) => c }; } })();
  const cur = user.country || d.detected?.country || "";
  const countries = [...new Set([cur, ...COUNTRIES].filter(Boolean))];
  const wrap = document.createElement("div");
  wrap.className = "modal-back";
  wrap.innerHTML = `
    <form class="card modal locale-modal">
      <h2>🌎 ${t("tz.title")}</h2>
      <p class="small muted">${t("tz.explain")}</p>
      ${d.detected?.city ? `<p class="small">📍 ${t("tz.detected", { place: esc([d.detected.city, d.detected.region, d.detected.country && names.of(d.detected.country)].filter(Boolean).join(", ")) })}</p>` : ""}
      <label>${t("tz.zone")}
        <select name="tz">
          <optgroup label="${esc(t("tz.suggested"))}">${top.map((z) => `<option value="${esc(z)}" ${z === (user.tz || DEVICE_TZ) ? "selected" : ""}>${esc(zoneLabel(z))}${z === DEVICE_TZ ? ` · ${esc(t("tz.device"))}` : ""}</option>`).join("")}</optgroup>
          <optgroup label="${esc(t("tz.all"))}">${all.filter((z) => !top.includes(z)).map((z) => `<option value="${esc(z)}">${esc(z.replace(/_/g, " "))}</option>`).join("")}</optgroup>
        </select></label>
      <label>${t("tz.country")}
        <select name="country"><option value="">—</option>${countries.map((c) => `<option value="${c}" ${c === cur ? "selected" : ""}>${flag(c)} ${esc(names.of(c) || c)}</option>`).join("")}</select></label>
      <p class="hint">${t("tz.privacy")}</p>
      <div class="lfg-row"><button class="primary">${t("acc.save")}</button><button type="button" class="small-btn" data-close>${t("tz.later")}</button></div>
    </form>`;
  document.body.append(wrap);
  const close = () => wrap.remove();
  wrap.querySelector("[data-close]").onclick = close;
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const tz = e.target.tz.value, country = e.target.country.value || null;
    try {
      await api("/api/locale", { method: "POST", body: { tz, country } });
      user.tz = tz; user.country = country; TZ = tz;
      close(); toast(t("tz.saved"));
      onSaved ? onSaved(tz, country) : location.reload();
    } catch (x) { toast(x.message, true); }
  };
}

// First visit without a saved zone: a small bar offering the device's zone (VPN-proof) + the country we see.
async function localeBanner(user) {
  if (sessionStorage.getItem("tzBannerClosed")) return;
  const d = await api("/api/locale").catch(() => ({ detected: {} }));
  const bar = document.createElement("div");
  bar.className = "tz-banner";
  bar.innerHTML = `🌎 ${t("tz.banner", { zone: esc(zoneLabel(DEVICE_TZ)) })}
    <button class="primary" data-ok>${t("tz.ok")}</button><button class="small-btn" data-change>${t("tz.change")}</button><button class="link" data-x aria-label="close">✕</button>`;
  document.body.append(bar);
  bar.querySelector("[data-ok]").onclick = async () => {
    try { await api("/api/locale", { method: "POST", body: { tz: DEVICE_TZ, country: d.detected?.country || null } }); user.tz = DEVICE_TZ; bar.remove(); toast(t("tz.saved")); } catch (x) { toast(x.message, true); }
  };
  bar.querySelector("[data-change]").onclick = () => { bar.remove(); openLocalePicker(user); };
  bar.querySelector("[data-x]").onclick = () => { sessionStorage.setItem("tzBannerClosed", "1"); bar.remove(); };
}

// On phones: "install the app" nudge (once every 2 weeks, until it's installed).
function appBanner() {
  if (isStandalone() || !matchMedia("(max-width: 760px), (pointer: coarse)").matches) return;
  try { if (Date.now() - (+localStorage.getItem("appBannerAt") || 0) < 14 * 86400000) return; } catch { return; }
  const bar = document.createElement("div");
  bar.className = "app-banner";
  bar.innerHTML = `<img src="/icons/icon-192.png" alt=""><div><b>${t("pwa.bannerTitle")}</b><div class="small">${t(isIOS() ? "pwa.bannerIOS" : "pwa.bannerSub")}</div></div>
    ${isIOS() ? "" : `<button class="primary" data-go>${t("pwa.install")}</button>`}<button class="link" data-x aria-label="close">✕</button>`;
  document.body.append(bar);
  const done = () => { try { localStorage.setItem("appBannerAt", Date.now()); } catch { /* */ } bar.remove(); };
  bar.querySelector("[data-x]").onclick = done;
  bar.querySelector("[data-go]")?.addEventListener("click", async () => { if (canInstall()) await installApp(); else location.href = "/profile#ajustes"; done(); });
}
