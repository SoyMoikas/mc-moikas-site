import {
  api, esc, rich, can, initPage, statusBadge, renderPost, postForm, bindPostActions,
  onSubmit, toast, toISO, ago, fmtDate, loginHint,
} from "./common.js";

const user = await initPage();
const id = new URLSearchParams(location.search).get("id");
const main = document.getElementById("main");
let data = null;
const openTasks = new Set(); // keep expanded tasks open across reloads

const STATUS_LABEL = { open: "Open", in_progress: "In progress", done: "Done" };

async function load() {
  if (!id) { main.innerHTML = `<p style="padding:40px 0">No server selected. <a href="/">See all servers</a></p>`; return; }
  try {
    data = await api(`/api/servers/${encodeURIComponent(id)}`);
  } catch (e) {
    main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}. <a href="/">See all servers</a></p>`;
    return;
  }
  render();
}

function render() {
  const { server: s, posts, tasks } = data;
  document.title = `${s.name} · Moikas MC`;
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const spec = (label, val) => val ? `<div class="spec"><span>${label}</span><strong>${esc(val)}</strong></div>` : "";

  main.innerHTML = `
    <section>
      ${s.hidden ? `<div class="notice warn">This server is a <b>draft</b>, so only admins can see it. Publish it from the Admin page.</div>` : ""}
      <div class="section-head">
        <h2 style="font-size:1.8rem;color:var(--accent)">${esc(s.name)}</h2>
        <div>${statusBadge(s)}</div>
      </div>
      ${s.description ? `<p class="body" style="white-space:pre-wrap">${rich(s.description)}</p>` : ""}
      <div class="card">
        <div class="addr"><code>${esc(s.connect || "—")}</code><button class="primary" data-copy="${esc(s.connect)}">Copy</button></div>
        <div class="specs">
          ${spec("Game", s.game)}
          ${spec("Modpack", s.modpack)}
          ${spec("Pack version", s.modpack_version)}
          ${spec("Minecraft", s.mc_version)}
          ${spec("Loader", [s.loader, s.loader_version].filter(Boolean).join(" "))}
          ${spec("Recommended RAM", s.ram)}
        </div>
        ${s.modpack_url ? `<a class="btn" href="${esc(s.modpack_url)}" target="_blank" rel="noopener">Get the modpack ↗</a>` : ""}
        ${s.join_steps.length ? `<ol class="steps">${s.join_steps.map((x) => `<li>${rich(x)}</li>`).join("")}</ol>` : ""}
        ${s.synced_at ? `<p class="hint" style="margin:12px 0 0">Live info from the server panel, updated ${ago(s.synced_at)}.</p>` : ""}
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>Announcements</h2>
        ${can(user, "staff") ? `<button id="new-post">+ New announcement</button>` : ""}
      </div>
      <div id="post-form"></div>
      <div id="posts">${posts.length ? posts.map((p) => renderPost(p, { user })).join("") : `<p class="muted">No announcements for this server yet.</p>`}</div>
    </section>

    <section>
      <div class="section-head">
        <h2>Tasks</h2>
        ${can(user, "staff") ? `<button id="new-task">+ New task</button>` : ""}
      </div>
      ${tasks.length ? `<div class="small muted">${done} of ${tasks.length} done</div><div class="progress"><div style="width:${pct}%"></div></div>` : ""}
      <div id="task-form"></div>
      <div id="tasks">${tasks.length ? tasks.map(taskRow).join("") : `<p class="muted">No tasks yet.</p>`}</div>
      ${!can(user, "member") ? `<p class="hint">${loginHint(user)}</p>` : ""}
    </section>`;

  wire();
  for (const tid of openTasks) {
    const el = main.querySelector(`details[data-task="${tid}"]`);
    if (el) { el.open = true; loadTask(el); }
  }
}

function taskRow(t) {
  return `
    <details class="task ${esc(t.status)}" data-task="${t.id}">
      <summary>
        <span class="pill ${esc(t.status)}">${STATUS_LABEL[t.status] || esc(t.status)}</span>
        <span class="title">${esc(t.title)}</span>
        <span class="count">💬 ${t.comment_count}</span>
      </summary>
      <div class="inner"><p class="muted">Loading…</p></div>
    </details>`;
}

async function loadTask(el) {
  const inner = el.querySelector(".inner");
  let task, comments;
  try {
    ({ task, comments } = await api(`/api/tasks/${el.dataset.task}`));
  } catch (e) { inner.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }

  const staff = can(user, "staff");
  inner.innerHTML = `
    ${task.body ? `<div class="task-body">${rich(task.body)}</div>` : ""}
    <p class="hint">Added ${fmtDate(task.created_at)}${task.created_by_name ? ` by ${esc(task.created_by_name)}` : ""}</p>
    ${staff ? `<div class="actions" style="margin:8px 0 14px">
        <select data-status style="width:auto">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${task.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <button class="link" data-edit-task>Edit</button>
        <button class="link" data-delete-task>Delete</button>
      </div>` : ""}
    <div class="comments">
      ${comments.length ? comments.map((c) => `
        <div class="comment">
          <img src="${esc(c.avatar || "https://cdn.discordapp.com/embed/avatars/0.png")}" alt="">
          <div class="main">
            <div class="who"><b>${esc(c.username || "deleted user")}</b>
              ${c.role === "staff" || c.role === "admin" ? `<span class="role ${esc(c.role)}">${esc(c.role)}</span>` : ""}
              <span class="when">${ago(c.created_at)}</span>
              ${c.can_delete ? `<button class="link" data-delete-comment="${c.id}">delete</button>` : ""}</div>
            <div class="body">${rich(c.body)}</div>
          </div>
        </div>`).join("") : `<p class="muted small">No comments yet.</p>`}
    </div>
    ${can(user, "member") ? `
      <form class="stack" data-comment style="margin-top:12px">
        <textarea name="body" maxlength="2000" placeholder="Add to the discussion…" required style="min-height:70px"></textarea>
        <div class="actions"><button class="primary">Comment</button></div>
      </form>` : `<p class="hint">${loginHint(user)}</p>`}`;

  const form = inner.querySelector("form[data-comment]");
  if (form) onSubmit(form, async (d) => {
    await api(`/api/tasks/${task.id}/comments`, { method: "POST", body: d });
    await refreshKeepingOpen();
  });

  inner.querySelectorAll("[data-delete-comment]").forEach((b) => b.onclick = async () => {
    if (!confirm("Delete this comment?")) return;
    try { await api(`/api/comments/${b.dataset.deleteComment}`, { method: "DELETE" }); await refreshKeepingOpen(); }
    catch (e) { toast(e.message, true); }
  });

  if (staff) {
    inner.querySelector("[data-status]").onchange = async (e) => {
      try { await api(`/api/tasks/${task.id}`, { method: "PATCH", body: { status: e.target.value } }); toast("Status updated"); await refreshKeepingOpen(); }
      catch (err) { toast(err.message, true); }
    };
    inner.querySelector("[data-delete-task]").onclick = async () => {
      if (!confirm(`Delete task "${task.title}" and its comments?`)) return;
      try { await api(`/api/tasks/${task.id}`, { method: "DELETE" }); openTasks.delete(String(task.id)); toast("Task deleted"); await load(); }
      catch (e) { toast(e.message, true); }
    };
    inner.querySelector("[data-edit-task]").onclick = () => {
      inner.innerHTML = taskForm(task);
      const f = inner.querySelector("form");
      f.querySelector("[data-cancel]").onclick = () => loadTask(el);
      onSubmit(f, async (d) => {
        await api(`/api/tasks/${task.id}`, { method: "PATCH", body: d });
        toast("Saved"); await refreshKeepingOpen();
      });
    };
  }
}

function taskForm(t = {}) {
  return `
    <form class="stack ${t.id ? "" : "card"}">
      <label>Task <input name="title" maxlength="140" required value="${esc(t.title)}" placeholder="e.g. Build the community storage hub"></label>
      <label>Details (optional) <textarea name="body" maxlength="4000" placeholder="What needs doing, materials, who's on it…">${esc(t.body)}</textarea></label>
      <div class="actions">
        <label class="check">Status
          <select name="status" style="width:auto">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${(t.status || "open") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        </label>
        <span style="flex:1"></span>
        <button type="button" data-cancel>Cancel</button>
        <button class="primary">${t.id ? "Save" : "Add task"}</button>
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
      toast("Posted"); load();
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
      toast("Task added"); load();
    });
  };
}

load();
