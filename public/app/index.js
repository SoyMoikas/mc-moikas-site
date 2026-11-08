import { mountChat } from "./chat.js";
import { mountFeed } from "./feed.js";
import { api, esc, can, t, initPage, mountMobileTabs, renderPost, postForm, bindPostActions, onSubmit, toast, toISO, gameLabel, localized } from "./common.js";

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
    });
  };
}

mountFeed(document.getElementById("feed"), user);
mountChat(document.getElementById("chat"), "general", user);
mountMobileTabs();
loadGames();
loadPosts();
