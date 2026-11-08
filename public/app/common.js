// Shared helpers for every page.
import { t, tErr, lang, locale, setLang, applyStatic } from "./i18n.js";
import { levelBadge, levelInfo } from "./levels.js";
import { avatarHTML, nameHTML, fromAuthor, loadCatalog, catalogItem, bgCSS, bgStyle, bgAnimated } from "./cosmetics.js";
export { t, lang, levelBadge, avatarHTML, nameHTML, bgStyle, bgAnimated };

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
  let user = null;
  const [me, site] = await Promise.allSettled([api("/api/me"), api("/api/site"), loadCatalog()]);
  if (me.status === "fulfilled") user = me.value.user;
  if (site.status === "fulfilled") Object.assign(SITE, site.value);

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
        ${navLink("/store", "nav.store")}
        ${["users", "servers", "store"].some((p) => perm(user, p)) ? navLink("/admin", "nav.admin") : ""}
      </nav>
      <div class="userbox">
        <button class="lang" title="${esc(t("lang.switchTitle"))}" data-lang="${lang === "es" ? "en" : "es"}">${t("lang.switch")}</button>
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

  // Your wallpaper (only you see it).
  const wp = user && catalogItem(user.eq_wallpaper);
  if (wp) {
    document.body.style.setProperty("--wallpaper", bgCSS(wp.visual));
    document.body.classList.add("has-wallpaper");
    if (wp.visual?.animate) document.body.classList.add("wallpaper-anim");
  }

  // Game pages take on that game's color as the accent.
  const g = SITE.games.find((x) => x.id === curGame);
  if (g && /^#[0-9a-f]{6}$/i.test(g.color || "")) document.documentElement.style.setProperty("--accent", g.color);

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

// Phones: bottom tab bar switching between the feed (announcements + posts) and a full-screen chat.
export function mountMobileTabs() {
  if (document.querySelector(".m-tabs")) return;
  const bar = document.createElement("nav");
  bar.className = "m-tabs";
  bar.innerHTML = `
    <button data-mtab="feed" class="active"><span>📰</span>${t("mtab.feed")}</button>
    <button data-mtab="chat"><span>💬</span>${t("mtab.chat")}<i class="m-dot hidden"></i></button>`;
  document.body.append(bar);
  document.body.classList.add("has-mtabs", "mtab-feed");
  const dot = bar.querySelector(".m-dot");
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mtab]");
    if (!b) return;
    const tab = b.dataset.mtab;
    document.body.classList.toggle("mtab-feed", tab === "feed");
    document.body.classList.toggle("mtab-chat", tab === "chat");
    bar.querySelectorAll("[data-mtab]").forEach((x) => x.classList.toggle("active", x === b));
    if (tab === "chat") {
      dot.classList.add("hidden");
      const log = document.querySelector(".side-chat .chat-log");
      if (log) log.scrollTop = log.scrollHeight;
    }
    window.scrollTo(0, 0);
  });
  // Show a dot on the Chat tab when new messages arrive while you're on the feed.
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

// datetime-local inputs have no timezone; store ISO (UTC) so everyone sees their own local time.
export const toISO = (v) => (v ? new Date(v).toISOString() : null);
export function toLocalInput(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
      if (!confirm(t("pf.confirmDelete"))) return;
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
