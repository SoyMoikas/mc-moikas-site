import { api, esc, can, initPage, onSubmit, toast, ago, fmtDate, statusBadge } from "./common.js";

const user = await initPage();
const main = document.getElementById("main");

if (!can(user, "admin")) {
  main.innerHTML = `<p style="padding:40px 0">${user ? "Admins only." : `<a href="/auth/login?next=/admin">Log in with Discord</a> to continue.`}</p>`;
  throw new Error("not admin");
}

main.innerHTML = `
  <div class="tabs">
    <button data-tab="servers" class="active">Servers</button>
    <button data-tab="ptero">Pterodactyl sync</button>
    <button data-tab="users">Users</button>
  </div>
  <section id="tab"></section>`;

const tabEl = main.querySelector("#tab");
const tabs = { servers: serversTab, ptero: pteroTab, users: usersTab };
let current = "servers";
main.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => {
  main.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
  current = b.dataset.tab;
  tabs[current]();
});

/* ---------------- Servers ---------------- */

async function serversTab() {
  tabEl.innerHTML = `<p class="muted">Loading…</p>`;
  const { servers } = await api("/api/servers");
  tabEl.innerHTML = `
    <div class="section-head"><h2>Server pages</h2><button id="add">+ Add server manually</button></div>
    <p class="hint">Servers synced from Pterodactyl show up under <b>Pterodactyl sync</b>, where you can turn them into pages. Blank fields fall back to what Pterodactyl reports.</p>
    <div id="editor"></div>
    <div class="card table-wrap"><table>
      <thead><tr><th>Name</th><th>Connect</th><th>Status</th><th>Visible</th><th>Order</th><th></th></tr></thead>
      <tbody>${servers.map((s) => `
        <tr>
          <td><a href="/server?id=${encodeURIComponent(s.id)}">${esc(s.name)}</a><div class="hint">${esc(s.id)}${s.linked ? " · linked to Ptero" : ""}</div></td>
          <td><code>${esc(s.connect)}</code></td>
          <td>${statusBadge(s) || `<span class="muted small">not linked</span>`}</td>
          <td>${s.hidden ? `<span class="draft">Draft</span>` : "Public"}</td>
          <td>${s.sort_order}</td>
          <td class="actions"><button data-edit="${esc(s.id)}">Edit</button></td>
        </tr>`).join("") || `<tr><td colspan="6" class="muted">No servers yet.</td></tr>`}
      </tbody></table></div>`;
  tabEl.querySelector("#add").onclick = () => editServer(null);
  tabEl.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => editServer(b.dataset.edit));
}

async function editServer(id) {
  const editor = tabEl.querySelector("#editor");
  let raw = {}, auto = {}, ptero = null;
  if (id) {
    const { server } = await api(`/api/servers/${encodeURIComponent(id)}`);
    ({ raw, auto, ptero } = server);
  }
  const { servers: pteroList } = await api("/api/ptero");
  const linkable = pteroList.filter((p) => !p.linked_to || p.uuid === raw.ptero_uuid);

  const f = (name, label, opts = {}) => {
    const ph = auto?.[name] ? `From Ptero: ${auto[name]}` : (opts.ph || "");
    return `<label>${label}<input name="${name}" ${opts.type ? `type="${opts.type}"` : ""} value="${esc(raw[name] ?? "")}" placeholder="${esc(ph)}"></label>`;
  };

  editor.innerHTML = `
    <form class="stack card">
      <h3 style="margin:0">${id ? `Edit ${esc(raw.name || id)}` : "New server"}</h3>
      <label>Pterodactyl server
        <select name="ptero_uuid">
          <option value="">Not linked</option>
          ${linkable.map((p) => `<option value="${esc(p.uuid)}" ${p.uuid === raw.ptero_uuid ? "selected" : ""}>${esc(p.data.name)} (port ${esc(p.data.port)})</option>`).join("")}
        </select>
        <span class="hint">Linked servers get live status, players, port, and versions from Pterodactyl.</span>
      </label>
      <div class="row">
        ${id ? "" : `<label>URL id<input name="id" placeholder="auto from name, e.g. skyfactory"></label>`}
        ${f("name", "Display name")}
        ${f("game", "Game", { ph: "Minecraft" })}
      </div>
      <div class="row">
        ${f("address", "Address players type", { ph: "play.moikas.cc" })}
        ${f("port", "Port", { type: "number" })}
        ${f("connect_override", "Exact connect text (optional)", { ph: "e.g. atm.moikas.cc" })}
      </div>
      <p class="hint" style="margin:-4px 0 0">Port 25565 is hidden automatically. For other ports players see address:port, unless you add an SRV record and put that name in "Exact connect text".</p>
      <div class="row">
        ${f("modpack", "Modpack")}
        ${f("modpack_version", "Pack version")}
        ${f("modpack_url", "Modpack link", { ph: "https://www.curseforge.com/…" })}
      </div>
      <div class="row">
        ${f("mc_version", "Minecraft version")}
        ${f("loader", "Loader")}
        ${f("loader_version", "Loader version")}
        ${f("ram", "Recommended RAM", { ph: "6–8 GB" })}
      </div>
      <label>Description<textarea name="description" placeholder="${esc(auto?.description ? "From Ptero: " + auto.description : "")}">${esc(raw.description ?? "")}</textarea></label>
      <label>How to join (one step per line)<textarea name="join_steps">${esc((raw.join_steps || []).join("\n"))}</textarea></label>
      <div class="row">
        <label>Sort order<input name="sort_order" type="number" value="${esc(raw.sort_order ?? 0)}"></label>
        <label class="check"><input type="checkbox" name="hidden" ${raw.hidden === 0 ? "" : "checked"}> Draft (only admins can see it)</label>
      </div>
      ${ptero ? `<details><summary class="small muted">Raw Pterodactyl data (synced ${ago(ptero.synced_at)})</summary><pre class="vars">${esc(JSON.stringify(ptero, null, 2))}</pre></details>` : ""}
      <div class="actions">
        ${id ? `<button type="button" class="danger" data-delete>Delete page</button>` : ""}
        <span style="flex:1"></span>
        <button type="button" data-cancel>Cancel</button>
        <button class="primary">${id ? "Save" : "Create"}</button>
      </div>
    </form>`;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });

  const form = editor.querySelector("form");
  form.querySelector("[data-cancel]").onclick = () => (editor.innerHTML = "");
  const del = form.querySelector("[data-delete]");
  if (del) del.onclick = async () => {
    if (!confirm(`Delete the "${raw.name || id}" page, including its announcements, tasks and comments? This can't be undone.`)) return;
    try { await api(`/api/servers/${encodeURIComponent(id)}`, { method: "DELETE" }); toast("Deleted"); serversTab(); }
    catch (e) { toast(e.message, true); }
  };
  onSubmit(form, async (d) => {
    if (id) await api(`/api/servers/${encodeURIComponent(id)}`, { method: "PATCH", body: d });
    else await api("/api/servers", { method: "POST", body: d });
    toast("Saved");
    serversTab();
  });
}

/* ---------------- Pterodactyl ---------------- */

async function pteroTab() {
  tabEl.innerHTML = `<p class="muted">Loading…</p>`;
  const { servers, last_sync } = await api("/api/ptero");
  tabEl.innerHTML = `
    <div class="section-head"><h2>Pterodactyl sync</h2></div>
    ${last_sync
      ? `<div class="notice ${Date.now() - last_sync > 10 * 60_000 ? "warn" : ""}">Last sync from the NAS: <b>${ago(last_sync)}</b>${Date.now() - last_sync > 10 * 60_000 ? ". The sync looks stalled, so check the cron job on the NAS." : ""}</div>`
      : `<div class="notice warn">The NAS hasn't sent any data yet. Set up <code>sync/ptero-sync.py</code> (see README).</div>`}
    <div class="card table-wrap"><table>
      <thead><tr><th>Ptero server</th><th>Egg</th><th>Port</th><th>State</th><th>Versions detected</th><th>Page</th></tr></thead>
      <tbody>${servers.map((p) => `
        <tr>
          <td>${esc(p.data.name)}<div class="hint">${esc(p.data.identifier || p.uuid)}</div></td>
          <td class="small">${esc(p.data.egg || "—")}</td>
          <td>${esc(p.data.port ?? "—")}</td>
          <td>${esc(p.data.state)}${p.data.players_online !== null ? ` · ${p.data.players_online}/${p.data.players_max}` : ""}</td>
          <td class="small">${esc([p.auto.mc_version, p.auto.loader, p.auto.loader_version].filter(Boolean).join(" · ") || "—")}</td>
          <td>${p.linked_to
            ? `<a href="/server?id=${encodeURIComponent(p.linked_to)}">${esc(p.linked_to)}</a>`
            : `<button data-create="${esc(p.uuid)}" data-name="${esc(p.data.name)}">Create page</button>`}</td>
        </tr>`).join("") || `<tr><td colspan="6" class="muted">Nothing synced yet.</td></tr>`}
      </tbody></table></div>
    <p class="hint">"Create page" makes a draft page linked to that server. Fill in the modpack info, then untick Draft to publish it.</p>`;
  tabEl.querySelectorAll("[data-create]").forEach((b) => b.onclick = async () => {
    try {
      const { id } = await api("/api/servers", { method: "POST", body: { ptero_uuid: b.dataset.create, name: b.dataset.name } });
      toast(`Draft "${id}" created`);
      main.querySelector('[data-tab="servers"]').click();
      setTimeout(() => editServer(id), 300);
    } catch (e) { toast(e.message, true); }
  });
}

/* ---------------- Users ---------------- */

const ROLE_HELP = {
  pending: "Logged in, can only read",
  member: "Can comment on tasks",
  staff: "Can post announcements and manage tasks",
  admin: "Full control, including servers and users",
};

async function usersTab() {
  tabEl.innerHTML = `<p class="muted">Loading…</p>`;
  const { users, owner_discord_id } = await api("/api/users");
  const pending = users.filter((u) => u.role === "pending").length;
  tabEl.innerHTML = `
    <div class="section-head"><h2>Users</h2></div>
    ${pending ? `<div class="notice warn">${pending} user${pending > 1 ? "s" : ""} waiting for approval.</div>` : ""}
    <p class="hint">${Object.entries(ROLE_HELP).map(([r, h]) => `<b>${r}</b>: ${h}`).join(" · ")}</p>
    <div class="card table-wrap"><table>
      <thead><tr><th>User</th><th>Role</th><th>Joined</th><th>Last login</th></tr></thead>
      <tbody>${users.map((u) => {
        const locked = u.id === user.id || u.discord_id === owner_discord_id;
        return `<tr>
          <td><img src="${esc(u.avatar)}" alt="">${esc(u.username)}<div class="hint">Discord ID ${esc(u.discord_id)}</div></td>
          <td>${locked ? `<span class="role ${esc(u.role)}">${esc(u.role)}</span>` : `
            <select data-user="${u.id}" style="width:auto">
              ${Object.keys(ROLE_HELP).map((r) => `<option ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
            </select>`}</td>
          <td class="small">${fmtDate(u.created_at)}</td>
          <td class="small">${u.last_login ? ago(u.last_login) : "—"}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  tabEl.querySelectorAll("[data-user]").forEach((sel) => {
    const was = sel.value;
    sel.onchange = async () => {
      if (sel.value === "admin" && !confirm("Admins can delete servers and change everyone's roles. Continue?")) { sel.value = was; return; }
      try { await api(`/api/users/${sel.dataset.user}`, { method: "PATCH", body: { role: sel.value } }); toast("Role updated"); usersTab(); }
      catch (e) { toast(e.message, true); sel.value = was; }
    };
  });
}

serversTab().catch((e) => (tabEl.innerHTML = `<p class="muted">${esc(e.message)}</p>`));
