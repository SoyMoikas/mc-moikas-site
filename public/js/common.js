// Shared helpers for every page.

const RANK = { pending: 0, member: 1, staff: 2, admin: 3 };
export const can = (user, role) => !!user && RANK[user.role] >= RANK[role];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// Escape text, then turn bare URLs into links.
export function rich(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)"']/g, (u) => `<a href="${u}" target="_blank" rel="noopener nofollow">${u}</a>`);
}

export async function api(path, { method = "GET", body } = {}) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
export function fmtDateTime(v) {
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return fmtDate(ms);
}

const STATUS_LABEL = { running: "Online", offline: "Offline", starting: "Starting", stopping: "Stopping", unknown: "Status unknown" };
export function statusBadge(s) {
  if (!s.status) return "";
  let label = STATUS_LABEL[s.status] || s.status;
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

// Builds the top bar and returns the logged-in user (or null).
export async function initPage() {
  let user = null;
  try { ({ user } = await api("/api/me")); } catch { /* offline: treat as logged out */ }

  const here = location.pathname + location.search;
  const bar = document.createElement("header");
  bar.className = "topbar";
  bar.innerHTML = `
    <div class="wrap">
      <a class="brand" href="/">Moikas MC</a>
      <nav>
        <a href="/">Servers</a>
        ${can(user, "admin") ? `<a href="/admin">Admin</a>` : ""}
      </nav>
      <div class="userbox">
        ${user
          ? `<img src="${esc(user.avatar)}" alt=""><span class="uname">${esc(user.username)}</span>
             <span class="role ${esc(user.role)}">${esc(user.role)}</span>
             <a class="small muted" href="/auth/logout">Log out</a>`
          : `<a class="btn discord" href="/auth/login?next=${encodeURIComponent(here)}">Log in with Discord</a>`}
      </div>
    </div>`;
  document.body.prepend(bar);

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-copy]");
    if (!b) return;
    e.preventDefault();
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied!"; }
    catch { b.textContent = "Select & copy"; }
    setTimeout(() => (b.textContent = "Copy"), 1500);
  });
  return user;
}

export const loginHint = (user) => !user
  ? `<a href="/auth/login?next=${encodeURIComponent(location.pathname + location.search)}">Log in with Discord</a> to join the discussion.`
  : user.role === "pending" ? "Your account is waiting for an admin to approve it before you can comment." : "";

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
      ${servers ? `<label>Where
        <select name="server_id">
          <option value="">All servers (network-wide)</option>
          ${servers.map((s) => `<option value="${esc(s.id)}" ${values.server_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
        </select></label>` : ""}
      <div class="row">
        <label>Title <input name="title" maxlength="140" required value="${esc(values.title)}"></label>
        <label>Type <select name="tag">${POST_TAGS.map((t) => `<option ${values.tag === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label>Event time (optional) <input type="datetime-local" name="event_at" value="${esc(ev)}"></label>
      </div>
      <label>Message <textarea name="body" maxlength="8000" required>${esc(values.body)}</textarea></label>
      <div class="actions">
        <label class="check"><input type="checkbox" name="pinned" ${values.pinned ? "checked" : ""}> Pin to top</label>
        <span style="flex:1"></span>
        <button type="button" data-cancel>Cancel</button>
        <button class="primary">${values.id ? "Save" : "Post"}</button>
      </div>
    </form>`;
}

export function renderPost(p, { user, showServer = false } = {}) {
  return `
    <article class="card post" data-post="${p.id}">
      <div class="meta">
        ${p.pinned ? `<span class="pin">📌 Pinned</span>` : ""}
        <span class="tag ${esc(p.tag)}">${esc(p.tag || "Announcement")}</span>
        <span>${fmtDate(p.created_at)}</span>
        ${p.author ? `<span>by ${esc(p.author)}</span>` : ""}
        ${showServer ? (p.server_id
          ? `<a class="server-link" href="/server?id=${encodeURIComponent(p.server_id)}">${esc(p.server_name)}</a>`
          : `<span class="server-link muted">All servers</span>`) : ""}
      </div>
      <h3>${esc(p.title)}</h3>
      <div class="body">${rich(p.body)}</div>
      ${p.event_at ? `<div class="event">🗓 ${esc(fmtDateTime(p.event_at))}</div>` : ""}
      ${can(user, "staff") ? `<div class="actions" style="margin-top:10px">
        <button class="link" data-edit-post="${p.id}">Edit</button>
        <button class="link" data-delete-post="${p.id}">Delete</button></div>` : ""}
    </article>`;
}

// Wires up edit/delete buttons on rendered posts. `reload` re-renders the page section.
export function bindPostActions(root, posts, { user, reload, servers = null }) {
  root.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delete-post]");
    const edit = e.target.closest("[data-edit-post]");
    if (del) {
      if (!confirm("Delete this post?")) return;
      try { await api(`/api/posts/${del.dataset.deletePost}`, { method: "DELETE" }); toast("Post deleted"); reload(); }
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
        toast("Saved"); reload();
      });
    }
  });
}
