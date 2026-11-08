import { mountChat } from "./chat.js";
import { mountFeed } from "./feed.js";
import {
  api, esc, rich, can, t, initPage, statusBadge, renderPost, postForm, bindPostActions, onSubmit, toast, toISO, gameLabel, localized,
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
  const card = (s) => {
    const sub = [s.modpack || s.game, s.mc_version, s.loader].filter(Boolean).join(" · ");
    return `<a class="server-card" href="/server?id=${encodeURIComponent(s.id)}">
      <h3>${esc(s.name)}${s.hidden ? `<span class="draft">${t("draft")}</span>` : ""}</h3>
      <div class="sub">${esc(sub)}</div>
      <code class="connect">${esc(s.connect || "—")}</code>
      <div class="foot"><span>${statusBadge(s)}</span></div></a>`;
  };

  main.innerHTML = `
    <section class="game-hero" style="--gc:${esc(g.color || "#6fcf5a")}">
      ${g.image ? `<div class="gh-img" style="background-image:url('${esc(g.image)}')"></div>` : ""}
      <div class="gh-body">
        <h1>${esc(g.icon || "🎮")} ${esc(gameLabel(g))}</h1>
        ${localized(g.description, g.description_es) ? `<p class="muted">${rich(localized(g.description, g.description_es))}</p>` : ""}
      </div>
    </section>
    <section>
      <div class="section-head"><h2>${t("home.servers")}</h2></div>
      <div class="grid">${servers.map(card).join("") || `<p class="muted">${t("home.noServers")}</p>`}</div>
    </section>
    <div class="home-cols">
      <section class="col-main">
        <div class="section-head"><h2>${t("feed.gamePosts", { game: gameLabel(g) })}</h2></div>
        <div id="feed"></div>
      </section>
      <aside class="col-side">
        <section>
          <div class="section-head"><h2>${t("home.announcements")}</h2>
            ${can(user, "staff") ? `<button id="new-post">${t("home.newAnnouncement")}</button>` : ""}</div>
          <div id="post-form"></div>
          <div id="posts">${posts.length ? posts.map((p) => renderPost(p, { user, showServer: true })).join("") : `<p class="muted">${t("home.noAnnouncements")}</p>`}</div>
        </section>
        <section>
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
}

load();
