import { mountChat } from "./chat.js";
import {
  api, esc, rich, can, t, initPage, SITE, gameLabel, statusBadge, renderPost, postForm, bindPostActions,
  onSubmit, toast, toISO, ago, fmtDate, loginHint, roleLabel, taskLabel, localized, levelBadge, avatarHTML, nameHTML, livePosts,
} from "./common.js";

const user = await initPage();
const id = new URLSearchParams(location.search).get("id");
const main = document.getElementById("main");
let data = null;
const openTasks = new Set(); // keep expanded tasks open across reloads
let chatEl = null;
let mapEl = null; // the embedded live map is created once, so re-rendering the page doesn't reload it

const STATUSES = ["open", "in_progress", "done"];

async function load() {
  if (!id) { main.innerHTML = `<p style="padding:40px 0">${t("sp.noServer")} <a href="/">${t("sp.seeAll")}</a></p>`; return; }
  try {
    data = await api(`/api/servers/${encodeURIComponent(id)}`);
  } catch (e) {
    main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}. <a href="/">${t("sp.seeAll")}</a></p>`;
    return;
  }
  render();
}

function render() {
  const { server: s, posts, tasks } = data;
  document.title = `${s.name} · Moikas`;
  const done = tasks.filter((x) => x.status === "done").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const spec = (label, val) => val ? `<div class="spec"><span>${label}</span><strong>${esc(val)}</strong></div>` : "";
  const description = localized(s.description, s.description_es);
  const steps = localized(s.join_steps, s.join_steps_es) || [];

  main.innerHTML = `
    <section>
      ${(() => { const g = SITE.games.find((x) => x.id === s.game_id); return g ? `<a class="crumb" href="/game?id=${encodeURIComponent(g.id)}">← ${esc(g.icon || "")} ${esc(gameLabel(g))}</a>` : ""; })()}
      ${s.hidden ? `<div class="notice warn">${t("sp.draftNotice")}</div>` : ""}
      <div class="section-head">
        <h2 style="font-size:1.8rem;color:var(--accent)">${esc(s.name)}</h2>
        <div>${statusBadge(s)}</div>
      </div>
      ${description ? `<p class="body" style="white-space:pre-wrap">${rich(description)}</p>` : ""}
      <div class="card">
        <div class="addr"><code>${esc(s.connect || "—")}</code><button class="primary" data-copy="${esc(s.connect)}">${t("copy")}</button></div>
        <div class="specs">
          ${spec(t("sp.game"), s.game)}
          ${spec(t("sp.modpack"), s.modpack)}
          ${spec(t("sp.packVersion"), s.modpack_version)}
          ${spec(t("sp.minecraft"), s.mc_version)}
          ${spec(t("sp.loader"), [s.loader, s.loader_version].filter(Boolean).join(" "))}
          ${spec(t("sp.ram"), s.ram)}
        </div>
        ${s.modpack_url ? `<a class="btn" href="${esc(s.modpack_url)}" target="_blank" rel="noopener">${t("sp.getModpack")}</a>` : ""}
        ${s.map_url ? `<a class="btn" href="#live-map">🗺️ ${t("map.open")}</a>` : ""}
        ${steps.length ? `<ol class="steps">${steps.map((x) => `<li>${rich(x)}</li>`).join("")}</ol>` : ""}
        ${s.synced_at ? `<p class="hint" style="margin:12px 0 0">${esc(t("sp.liveInfo", { ago: ago(s.synced_at) }))}</p>` : ""}
      </div>
    </section>

    ${s.map_url ? `
    <section id="live-map">
      <div class="section-head">
        <h2>🗺️ ${t("map.open")}</h2>
        <a class="btn" href="${esc(s.map_url)}" target="_blank" rel="noopener">⛶ ${t("map.fullscreen")}</a>
      </div>
      <p class="hint">${t("map.hint")}</p>
      <div id="map-slot"></div>
    </section>` : ""}

    <section>
      <div class="section-head">
        <h2>${t("sp.announcements")}</h2>
        ${can(user, "staff") ? `<button id="new-post">${t("home.newAnnouncement")}</button>` : ""}
      </div>
      <div id="post-form"></div>
      <div id="posts">${posts.length ? posts.map((p) => renderPost(p, { user })).join("") : `<p class="muted">${t("sp.noAnnouncements")}</p>`}</div>
    </section>

    <section>
      <div class="section-head"><h2>${t("chat.title")}</h2></div>
      <div id="chat-slot"></div>
    </section>

    <section>
      <div class="section-head">
        <h2>${t("sp.tasks")}</h2>
        ${can(user, "staff") ? `<button id="new-task">${t("sp.newTask")}</button>` : ""}
      </div>
      ${tasks.length ? `<div class="small muted">${t("sp.progress", { done, total: tasks.length })}</div><div class="progress"><div style="width:${pct}%"></div></div>` : ""}
      <div id="task-form"></div>
      <div id="tasks">${tasks.length ? tasks.map(taskRow).join("") : `<p class="muted">${t("sp.noTasks")}</p>`}</div>
      ${!can(user, "member") ? `<p class="hint">${loginHint(user)}</p>` : ""}
    </section>`;

  // Keep one chat instance alive across re-renders so it doesn't reset or double-poll.
  if (!chatEl) { chatEl = document.createElement("div"); mountChat(chatEl, id, user); }
  main.querySelector("#chat-slot").replaceWith(chatEl);
  const slot = main.querySelector("#map-slot");
  if (slot) {
    if (!mapEl || mapEl.dataset.url !== s.map_url) {
      mapEl = document.createElement("div");
      mapEl.className = "map-frame card";
      mapEl.dataset.url = s.map_url;
      mapEl.innerHTML = `<iframe src="${esc(s.map_url)}" title="${esc(t("map.open"))}" loading="lazy" allowfullscreen referrerpolicy="no-referrer"></iframe>`;
    }
    slot.replaceWith(mapEl);
  }

  wire();
  for (const tid of openTasks) {
    const el = main.querySelector(`details[data-task="${tid}"]`);
    if (el) { el.open = true; loadTask(el); }
  }
}

function taskRow(x) {
  return `
    <details class="task ${esc(x.status)}" data-task="${x.id}">
      <summary>
        <span class="pill ${esc(x.status)}">${esc(taskLabel(x.status))}</span>
        <span class="title">${esc(x.title)}</span>
        <span class="count">💬 ${x.comment_count}</span>
      </summary>
      <div class="inner"><p class="muted">${t("loading")}</p></div>
    </details>`;
}

const statusOptions = (current) =>
  STATUSES.map((k) => `<option value="${k}" ${current === k ? "selected" : ""}>${esc(taskLabel(k))}</option>`).join("");

async function loadTask(el) {
  const inner = el.querySelector(".inner");
  let task, comments;
  try {
    ({ task, comments } = await api(`/api/tasks/${el.dataset.task}`));
  } catch (e) { inner.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }

  const staff = can(user, "staff");
  const added = task.created_by_name
    ? t("sp.addedBy", { date: fmtDate(task.created_at), name: task.created_by_name })
    : t("sp.added", { date: fmtDate(task.created_at) });

  inner.innerHTML = `
    ${task.body ? `<div class="task-body">${rich(task.body)}</div>` : ""}
    <p class="hint">${esc(added)}</p>
    ${staff ? `<div class="actions" style="margin:8px 0 14px">
        <select data-status style="width:auto">${statusOptions(task.status)}</select>
        <button class="link" data-edit-task>${t("edit")}</button>
        <button class="link" data-delete-task>${t("delete")}</button>
      </div>` : ""}
    <div class="comments">
      ${comments.length ? comments.map((c) => `
        <div class="comment">
          ${avatarHTML(c, 32)}
          <div class="main">
            <div class="who">${nameHTML(c, t("deletedUser"))}${c.username ? levelBadge(c.xp) : ""}
              ${c.role === "staff" || c.role === "admin" ? `<span class="role ${esc(c.role)}">${esc(roleLabel(c.role))}</span>` : ""}
              <span class="when">${esc(ago(c.created_at))}</span>
              ${c.can_delete ? `<button class="link" data-delete-comment="${c.id}">${t("deleteLower")}</button>` : ""}</div>
            <div class="body">${rich(c.body)}</div>
          </div>
        </div>`).join("") : `<p class="muted small">${t("sp.noComments")}</p>`}
    </div>
    ${can(user, "member") ? `
      <form class="stack" data-comment style="margin-top:12px">
        <textarea name="body" maxlength="2000" placeholder="${esc(t("sp.commentPh"))}" required style="min-height:70px"></textarea>
        <div class="actions"><button class="primary">${t("sp.comment")}</button></div>
      </form>` : `<p class="hint">${loginHint(user)}</p>`}`;

  const form = inner.querySelector("form[data-comment]");
  if (form) onSubmit(form, async (d) => {
    await api(`/api/tasks/${task.id}/comments`, { method: "POST", body: d });
    await refreshKeepingOpen();
  });

  inner.querySelectorAll("[data-delete-comment]").forEach((b) => b.onclick = async () => {
    if (!confirm(t("sp.confirmDeleteComment"))) return;
    try { await api(`/api/comments/${b.dataset.deleteComment}`, { method: "DELETE" }); await refreshKeepingOpen(); }
    catch (e) { toast(e.message, true); }
  });

  if (staff) {
    inner.querySelector("[data-status]").onchange = async (e) => {
      try { await api(`/api/tasks/${task.id}`, { method: "PATCH", body: { status: e.target.value } }); toast(t("sp.statusUpdated")); await refreshKeepingOpen(); }
      catch (err) { toast(err.message, true); }
    };
    inner.querySelector("[data-delete-task]").onclick = async () => {
      if (!confirm(t("sp.confirmDeleteTask", { title: task.title }))) return;
      try { await api(`/api/tasks/${task.id}`, { method: "DELETE" }); openTasks.delete(String(task.id)); toast(t("sp.taskDeleted")); await load(); }
      catch (e) { toast(e.message, true); }
    };
    inner.querySelector("[data-edit-task]").onclick = () => {
      inner.innerHTML = taskForm(task);
      const f = inner.querySelector("form");
      f.querySelector("[data-cancel]").onclick = () => loadTask(el);
      onSubmit(f, async (d) => {
        await api(`/api/tasks/${task.id}`, { method: "PATCH", body: d });
        toast(t("saved")); await refreshKeepingOpen();
      });
    };
  }
}

function taskForm(x = {}) {
  return `
    <form class="stack ${x.id ? "" : "card"}">
      <label>${t("tf.task")} <input name="title" maxlength="140" required value="${esc(x.title)}" placeholder="${esc(t("tf.taskPh"))}"></label>
      <label>${t("tf.details")} <textarea name="body" maxlength="4000" placeholder="${esc(t("tf.detailsPh"))}">${esc(x.body)}</textarea></label>
      <div class="actions">
        <label class="check">${t("tf.status")}
          <select name="status" style="width:auto">${statusOptions(x.status || "open")}</select>
        </label>
        <span style="flex:1"></span>
        <button type="button" data-cancel>${t("cancel")}</button>
        <button class="primary">${x.id ? t("save") : t("tf.add")}</button>
      </div>
    </form>`;
}

async function refreshKeepingOpen() {
  main.querySelectorAll("details.task[open]").forEach((d) => openTasks.add(d.dataset.task));
  await load();
}

function wire() {
  main.querySelectorAll("details.task").forEach((el) => {
    el.addEventListener("toggle", () => {
      if (el.open) { openTasks.add(el.dataset.task); loadTask(el); }
      else openTasks.delete(el.dataset.task);
    });
  });

  bindPostActions(main.querySelector("#posts"), () => data.posts, { user, reload: load });

  const np = main.querySelector("#new-post");
  if (np) np.onclick = () => {
    const holder = main.querySelector("#post-form");
    holder.innerHTML = postForm({});
    const form = holder.querySelector("form");
    form.querySelector("[data-cancel]").onclick = () => (holder.innerHTML = "");
    onSubmit(form, async (d) => {
      await api("/api/posts", { method: "POST", body: { ...d, server_id: id, event_at: toISO(d.event_at) } });
      toast(t("pf.posted")); load();
    });
  };

  const nt = main.querySelector("#new-task");
  if (nt) nt.onclick = () => {
    const holder = main.querySelector("#task-form");
    holder.innerHTML = taskForm();
    const form = holder.querySelector("form");
    form.querySelector("[data-cancel]").onclick = () => (holder.innerHTML = "");
    onSubmit(form, async (d) => {
      await api("/api/tasks", { method: "POST", body: { ...d, server_id: id } });
      toast(t("sp.taskAdded")); load();
    });
  };
}

load();
livePosts(async () => (data.posts = (await api(`/api/servers/${encodeURIComponent(id)}`)).posts),
  (ps) => ps.length ? ps.map((p) => renderPost(p, { user })).join("") : `<p class="muted">${t("sp.noAnnouncements")}</p>`);
