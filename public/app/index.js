import { mountChat } from "./chat.js";
import { api, esc, can, t, initPage, statusBadge, renderPost, postForm, bindPostActions, onSubmit, toast, toISO } from "./common.js";

const user = await initPage();
let servers = [];
let posts = [];

async function loadServers() {
  const el = document.getElementById("servers");
  try {
    ({ servers } = await api("/api/servers"));
  } catch (e) {
    el.innerHTML = `<p class="muted">${esc(t("couldntLoad", { msg: e.message }))}</p>`;
    return;
  }
  el.innerHTML = servers.length ? servers.map(card).join("") : `<p class="muted">${t("home.noServers")}</p>`;
}

function card(s) {
  const sub = [s.modpack || s.game, s.mc_version, s.loader].filter(Boolean).join(" · ");
  const tasks = s.tasks_total ? t("home.tasksDone", { done: s.tasks_done, total: s.tasks_total }) : "";
  return `
    <a class="server-card" href="/server?id=${encodeURIComponent(s.id)}">
      <h3>${esc(s.name)}${s.hidden ? `<span class="draft">${t("draft")}</span>` : ""}</h3>
      <div class="sub">${esc(sub)}</div>
      <code class="connect">${esc(s.connect || "—")}</code>
      <div class="foot"><span>${statusBadge(s)}</span><span>${esc(tasks)}</span></div>
    </a>`;
}

async function loadPosts() {
  const el = document.getElementById("posts");
  try {
    ({ posts } = await api("/api/posts?limit=15"));
  } catch (e) {
    el.innerHTML = `<p class="muted">${esc(t("couldntLoad", { msg: e.message }))}</p>`;
    return;
  }
  el.innerHTML = posts.length
    ? posts.map((p) => renderPost(p, { user, showServer: true })).join("")
    : `<p class="muted">${t("home.noAnnouncements")}</p>`;
}

bindPostActions(document.getElementById("posts"), () => posts, { user, reload: loadPosts });

if (can(user, "staff")) {
  const btn = document.getElementById("new-post");
  const holder = document.getElementById("post-form");
  btn.classList.remove("hidden");
  btn.onclick = () => {
    holder.innerHTML = postForm({}, { servers });
    const form = holder.querySelector("form");
    form.querySelector("[data-cancel]").onclick = () => (holder.innerHTML = "");
    onSubmit(form, async (d) => {
      await api("/api/posts", { method: "POST", body: { ...d, server_id: d.server_id || null, event_at: toISO(d.event_at) } });
      holder.innerHTML = "";
      toast(t("pf.posted"));
      loadPosts();
    });
  };
}

mountChat(document.getElementById("chat"), "general", user);
await loadServers();
loadPosts();
setInterval(loadServers, 60_000); // keep status fresh
