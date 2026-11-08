import { mountChat } from "./chat.js";
import { mountFeed } from "./feed.js";
import {
  api, esc, rich, can, t, initPage, mountMobileTabs, statusBadge, renderPost, postForm, bindPostActions, onSubmit, toast, toISO, gameLabel, localized, livePosts,
} from "./common.js";

const user = await initPage();
const id = new URLSearchParams(location.search).get("id");
const main = document.getElementById("main");
let data = null;

async function load() {
  try { data = await api(`/api/games/${encodeURIComponent(id || "")}`); }
  catch (e) { main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}. <a href="/">${t("nav.home")}</a></p>`; return; }
  const { game: g, servers, posts } = data;
  document.title = `${gameLabel(g)} · Moikas`;
  const row = (s) => `
    <div class="srv-row">
      <a class="srv-name" href="/server?id=${encodeURIComponent(s.id)}">
        <b>${esc(s.name)}${s.hidden ? ` <span class="draft">${t("draft")}</span>` : ""}</b>
        <span class="small muted">${esc([s.modpack || s.game, s.mc_version, s.loader].filter(Boolean).join(" · "))}</span>
      </a>
      <span class="srv-status">${statusBadge(s)}</span>
      <span class="srv-connect"><code>${esc(s.connect || "—")}</code>${s.connect ? `<button class="small-btn" data-copy="${esc(s.connect)}">${t("copy")}</button>` : ""}</span>
    </div>`;

  main.innerHTML = `
    <header class="game-head"${g.image ? ` style="--banner:url('${esc(g.image)}')"` : ""}>
      <span class="gh-icon">${esc(g.icon || "🎮")}</span>
      <div class="gh-text">
        <h1>${esc(gameLabel(g))}</h1>
        ${localized(g.description, g.description_es) ? `<p>${rich(localized(g.description, g.description_es))}</p>` : ""}
      </div>
    </header>
    <div class="home-cols">
      <section class="col-main">

        <details class="srv-collapse" ${window.innerWidth > 860 ? "open" : ""}>
          <summary>${t("home.servers")} <span class="muted">(${servers.length})</span></summary>
          <div class="srv-list">${servers.map(row).join("") || `<p class="muted">${t("home.noServers")}</p>`}</div>
        </details>
        <div class="section-head"><h2>${t("feed.gamePosts", { game: gameLabel(g) })}</h2></div>
        <div id="feed"></div>
      </section>
      <aside class="col-side">
        <section class="side-block">
          <div class="section-head"><h2>${t("home.announcements")}</h2>
            ${can(user, "staff") ? `<button id="new-post" class="small-btn">${t("home.newAnnouncementShort")}</button>` : ""}</div>
          <div id="post-form"></div>
          <div id="posts">${posts.length ? posts.map((p) => renderPost(p, { user, showServer: true })).join("") : `<p class="muted small">${t("home.noAnnouncements")}</p>`}</div>
        </section>
        <section class="side-block side-chat">
          <div class="section-head"><h2>${t("chat.gameChat", { game: gameLabel(g) })}</h2></div>
          <div id="chat"></div>
        </section>
      </aside>
    </div>`;

  bindPostActions(main.querySelector("#posts"), () => data.posts, { user, reload: load });
  const np = main.querySelector("#new-post");
  if (np) np.onclick = () => {
    const holder = main.querySelector("#post-form");
    holder.innerHTML = postForm({});
    const form = holder.querySelector("form");
    form.querySelector("[data-cancel]").onclick = () => (holder.innerHTML = "");
    onSubmit(form, async (d) => {
      await api("/api/posts", { method: "POST", body: { ...d, server_id: null, game_id: g.id, event_at: toISO(d.event_at) } });
      toast(t("pf.posted")); load();
    });
  };
  mountFeed(main.querySelector("#feed"), user, { game: g.id, modes: false });
  mountChat(main.querySelector("#chat"), `game:${g.id}`, user);
  mountMobileTabs();
}

await load();
livePosts(async () => (data.posts = (await api(`/api/games/${encodeURIComponent(id || "")}`)).posts),
  (ps) => ps.length ? ps.map((p) => renderPost(p, { user, showServer: true })).join("") : `<p class="muted small">${t("home.noAnnouncements")}</p>`);
