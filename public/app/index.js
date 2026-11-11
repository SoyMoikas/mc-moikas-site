import { mountChat } from "./chat.js";
import { mountFeed } from "./feed.js";
import { mountDaily, mountOcasoHome } from "./ocaso.js";
import { preguntaCard, recuerdosCard, nuevoStrip } from "./together.js";
import { mountCuandoHome } from "./cuando.js";
import { mountPlaying, mountLfg, mountFreeHome, mountNightHome, mountRecapHome } from "./social.js";
import { api, esc, can, t, initPage, mountMobileTabs, livePosts, renderPost, postForm, bindPostActions, onSubmit, toast, toISO, gameLabel, localized } from "./common.js";

const user = await initPage();
let posts = [], games = [];

async function loadGames() {
  const el = document.getElementById("games");
  try { ({ games } = await api("/api/games")); }
  catch (e) { el.innerHTML = `<p class="muted">${esc(t("couldntLoad", { msg: e.message }))}</p>`; return; }
  el.innerHTML = games.map((g) => `
    <a class="game-tile" href="/game?id=${encodeURIComponent(g.id)}" style="--gc:${esc(g.color || "#8a93a8")}">
      <span class="gt-icon"${g.image ? ` style="background-image:url('${esc(g.image)}')"` : ""}>${g.image ? "" : esc(g.icon || "🎮")}</span>
      <span class="gt-text">
        <b>${esc(gameLabel(g))}${g.active ? "" : ` <span class="draft">${t("q.inactive")}</span>`}</b>
        <span class="gt-desc">${esc(localized(g.description, g.description_es) || "")}</span>
      </span>
      <span class="gt-count">${t("home.serverCount", { n: g.servers })}</span>
    </a>`).join("");
}

async function loadPosts() {
  const el = document.getElementById("posts");
  try { ({ posts } = await api("/api/posts?scope=site&limit=5")); }
  catch (e) { el.innerHTML = `<p class="muted">${esc(t("couldntLoad", { msg: e.message }))}</p>`; return; }
  el.innerHTML = posts.length ? posts.map((p) => renderPost(p, { user })).join("") : `<p class="muted">${t("home.noAnnouncements")}</p>`;
}

bindPostActions(document.getElementById("posts"), () => posts, { user, reload: loadPosts });

if (can(user, "staff")) {
  const btn = document.getElementById("new-post");
  const holder = document.getElementById("post-form");
  btn.classList.remove("hidden");
  btn.onclick = () => {
    holder.innerHTML = postForm({});
    const form = holder.querySelector("form");
    form.querySelector("[data-cancel]").onclick = () => (holder.innerHTML = "");
    onSubmit(form, async (d) => {
      await api("/api/posts", { method: "POST", body: { ...d, server_id: null, game_id: null, event_at: toISO(d.event_at) } });
      holder.innerHTML = ""; toast(t("pf.posted")); loadPosts();
livePosts(async () => (posts = (await api("/api/posts?scope=site&limit=5")).posts),
  (ps) => ps.length ? ps.map((p) => renderPost(p, { user })).join("") : `<p class="muted">${t("home.noAnnouncements")}</p>`);
    });
  };
}

mountPlaying(document.getElementById("playing-now"), user);
mountDaily(document.getElementById("daily"), user);
mountFeed(document.getElementById("feed"), user);
mountRecapHome(document.getElementById("recap-home"), user);
// December–January: "your Moikas Wrapped is here"
{
  const el = document.getElementById("wrapped-home"), mo = new Date().getMonth();
  if (user && user.role !== "pending" && (mo === 11 || mo === 0)) {
    const y = new Date().getFullYear() - (mo === 0 ? 1 : 0);
    el.innerHTML = `<a class="card wr-banner" href="/wrapped?year=${y}"><span class="wr-b-ico">🎁</span><div><b>${esc(t("wr.banner", { y }))}</b><div class="small">${esc(t("wr.bannerSub"))}</div></div><span class="primary btn">${esc(t("wr.open"))}</span></a>`;
  } else el.remove();
}
if (user && user.role !== "pending") {
  preguntaCard(document.getElementById("qotd-home"), true).catch(() => document.getElementById("qotd-home").remove());
  recuerdosCard(document.getElementById("memories-home"));
  nuevoStrip(document.getElementById("jfnew-home"));
} else { document.getElementById("qotd-home").remove(); document.getElementById("memories-home").remove(); document.getElementById("jfnew-home").remove(); }
homeTabs();

/* ---------------- Home tabs (switch without reloading) ---------------- */

async function homeTabs() {
  const tabs = [...document.querySelectorAll(".home-tabs [data-pane]")];
  const panes = [...document.querySelectorAll(".home-pane")];
  const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
                  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const seen = store.get("home.seen", { ocaso: 0, gratis: [] });
  let free = null;
  const show = (name) => {
    tabs.forEach((b) => { const on = b.dataset.pane === name; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); if (on) b.classList.remove("has-new"); });
    panes.forEach((p) => (p.hidden = p.dataset.pane !== name));
    document.body.dataset.hpane = name;
    store.set("home.tab", name);
    if (name === "ocaso") { seen.ocaso = Date.now(); store.set("home.seen", seen); }
    if (name === "gratis" && free) { seen.gratis = free.map((g) => g.id); store.set("home.seen", seen); }
  };
  tabs.forEach((b) => (b.onclick = () => show(b.dataset.pane)));
  const tab = (n) => tabs.find((b) => b.dataset.pane === n);
  show(store.get("home.tab", "inicio"));

  // fill the other panes in the background; hide a tab as soon as we know it has nothing
  const hideIfEmpty = (name) => (data) => {
    if (!data) { tab(name).hidden = true; if (store.get("home.tab", "inicio") === name) show("inicio"); }
    return data;
  };
  if (user && user.role !== "pending") mountCuandoHome(document.getElementById("cuando-home"));
  else document.getElementById("cuando-home").remove();
  const [nights, lfg, oc, fg] = await Promise.all([
    mountNightHome(document.getElementById("night-home"), user),
    mountLfg(document.getElementById("lfg-home"), user),
    mountOcasoHome(document.getElementById("ocaso-home")).then(hideIfEmpty("ocaso")),
    mountFreeHome(document.getElementById("free-home")).then(hideIfEmpty("gratis")),
  ]);
  free = fg;
  const member = user && user.role !== "pending";
  const newPlay = member && (
    (lfg || []).some((p) => p.open && !p.full && !p.joined) ||
    (nights || []).some((n) => (n.status === "voting" && !n.options.some((o) => o.mine)) || (n.status === "locked" && !n.my_rsvp)));
  const newOcaso = oc && (oc.servers[0]?.lunasangre || oc.servers[0]?.faltan === 1 || (oc.deaths[0]?.created_at || 0) > (seen.ocaso || 0));
  const newFree = fg && fg.some((g) => !g.upcoming && !(seen.gratis || []).includes(g.id));
  const current = store.get("home.tab", "inicio");
  for (const [n, flag] of [["jugar", newPlay], ["ocaso", newOcaso], ["gratis", newFree]]) if (flag && n !== current) tab(n).classList.add("has-new");
  if (current === "gratis" && fg) { seen.gratis = fg.map((g) => g.id); store.set("home.seen", seen); }
  // someone's looking for players or a vote is open → open "Jugar" so nobody misses it
  if (newPlay && current !== "jugar") show("jugar");
}
mountChat(document.getElementById("chat"), "general", user);
mountMobileTabs({ mirror: ".home-tabs" });
loadGames();
announcementsToggle();
loadPosts();
livePosts(async () => (posts = (await api("/api/posts?scope=site&limit=5")).posts),
  (ps) => ps.length ? ps.map((p) => renderPost(p, { user })).join("") : `<p class="muted">${t("home.noAnnouncements")}</p>`);

// Phones: announcements show only the newest one until you tap "ver todos".
function announcementsToggle() {
  const block = document.querySelector(".col-side > .side-block:first-child");
  if (!block) return;
  block.classList.add("ann-short");
  const btn = document.createElement("button");
  btn.className = "link small ann-more";
  btn.textContent = t("home.annMore");
  btn.onclick = () => { const short = block.classList.toggle("ann-short"); btn.textContent = t(short ? "home.annMore" : "home.annLess"); };
  block.append(btn);
}
