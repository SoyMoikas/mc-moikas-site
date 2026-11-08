import { api, esc, can, t, initPage, onSubmit, toast, ago, fmtDate, statusBadge, roleLabel } from "./common.js";

const user = await initPage();
const main = document.getElementById("main");

if (!can(user, "admin")) {
  main.innerHTML = `<p style="padding:40px 0">${user ? t("ad.only") : t("ad.loginToContinue")}</p>`;
  throw new Error("not admin");
}

main.innerHTML = `
  <div class="tabs">
    <button data-tab="servers" class="active">${t("ad.tabServers")}</button>
    <button data-tab="ptero">${t("ad.tabPtero")}</button>
    <button data-tab="users">${t("ad.tabUsers")}</button>
  </div>
  <section id="tab"></section>`;

const tabEl = main.querySelector("#tab");
const tabs = { servers: serversTab, ptero: pteroTab, users: usersTab };
main.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => {
  main.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
  tabs[b.dataset.tab]().catch((e) => (tabEl.innerHTML = `<p class="muted">${esc(e.message)}</p>`));
});

/* ---------------- Servers ---------------- */

async function serversTab() {
  tabEl.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const { servers } = await api("/api/servers");
  tabEl.innerHTML = `
    <div class="section-head"><h2>${t("ad.serverPages")}</h2><button id="add">${t("ad.addManual")}</button></div>
    <p class="hint">${t("ad.serversHint")}</p>
    <div id="editor"></div>
    <div class="card table-wrap"><table>
      <thead><tr><th>${t("ad.colName")}</th><th>${t("ad.colConnect")}</th><th>${t("ad.colStatus")}</th><th>${t("ad.colVisible")}</th><th>${t("ad.colOrder")}</th><th></th></tr></thead>
      <tbody>${servers.map((s) => `
        <tr>
          <td class="primary-cell"><a href="/server?id=${encodeURIComponent(s.id)}">${esc(s.name)}</a><div class="hint">${esc(s.id)}${s.linked ? ` · ${t("ad.linked")}` : ""}</div></td>
          <td data-label="${esc(t("ad.colConnect"))}"><code>${esc(s.connect)}</code></td>
          <td data-label="${esc(t("ad.colStatus"))}">${statusBadge(s) || `<span class="muted small">${t("ad.notLinked")}</span>`}</td>
          <td data-label="${esc(t("ad.colVisible"))}">${s.hidden ? `<span class="draft">${t("ad.draft")}</span>` : t("ad.public")}</td>
          <td data-label="${esc(t("ad.colOrder"))}">${s.sort_order}</td>
          <td class="actions"><button data-edit="${esc(s.id)}">${t("edit")}</button></td>
        </tr>`).join("") || `<tr><td colspan="6" class="muted">${t("home.noServers")}</td></tr>`}
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
    const ph = auto?.[name] ? t("ad.fromPtero", { v: auto[name] }) : (opts.ph || "");
    return `<label>${label}<input name="${name}" ${opts.type ? `type="${opts.type}"` : ""} value="${esc(raw[name] ?? "")}" placeholder="${esc(ph)}"></label>`;
  };
  const steps = (v) => esc((Array.isArray(v) ? v : []).join("\n"));

  editor.innerHTML = `
    <form class="stack card">
      <h3 style="margin:0">${id ? esc(t("ad.editTitle", { name: raw.name || id })) : t("ad.newServer")}</h3>
      <label>${t("ad.pteroServer")}
        <select name="ptero_uuid">
          <option value="">${t("ad.notLinkedOpt")}</option>
          ${linkable.map((p) => `<option value="${esc(p.uuid)}" ${p.uuid === raw.ptero_uuid ? "selected" : ""}>${esc(p.data.name)} (${esc(t("ad.port", { port: p.data.port }))})</option>`).join("")}
        </select>
        <span class="hint">${t("ad.linkHint")}</span>
      </label>
      <div class="row">
        ${id ? "" : `<label>${t("ad.urlId")}<input name="id" placeholder="${esc(t("ad.urlIdPh"))}"></label>`}
        ${f("name", t("ad.displayName"))}
        ${f("game", t("ad.game"), { ph: "Minecraft" })}
      </div>
      <div class="row">
        ${f("address", t("ad.address"), { ph: "play.moikas.cc" })}
        ${f("port", t("ad.portLabel"), { type: "number" })}
        ${f("connect_override", t("ad.connectOverride"), { ph: "atm.moikas.cc" })}
      </div>
      <p class="hint" style="margin:-4px 0 0">${t("ad.portHint")}</p>
      <div class="row">
        ${f("modpack", t("ad.modpack"))}
        ${f("modpack_version", t("ad.packVersion"))}
        ${f("modpack_url", t("ad.modpackLink"), { ph: "https://www.curseforge.com/…" })}
      </div>
      <div class="row">
        ${f("mc_version", t("ad.mcVersion"))}
        ${f("loader", t("ad.loader"))}
        ${f("loader_version", t("ad.loaderVersion"))}
        ${f("ram", t("ad.ram"), { ph: "6–8 GB" })}
      </div>
      <div class="row">
        <label>${t("ad.description")}<textarea name="description" placeholder="${esc(auto?.description ? t("ad.fromPtero", { v: auto.description }) : "")}">${esc(raw.description ?? "")}</textarea></label>
        <label>${t("ad.descriptionEs")}<textarea name="description_es">${esc(raw.description_es ?? "")}</textarea></label>
      </div>
      <div class="row">
        <label>${t("ad.steps")}<textarea name="join_steps">${steps(raw.join_steps)}</textarea></label>
        <label>${t("ad.stepsEs")}<textarea name="join_steps_es">${steps(raw.join_steps_es)}</textarea></label>
      </div>
      <p class="hint" style="margin:-4px 0 0">${t("ad.esHint")}</p>
      <div class="row">
        <label>${t("ad.sortOrder")}<input name="sort_order" type="number" value="${esc(raw.sort_order ?? 0)}"></label>
        <label class="check"><input type="checkbox" name="hidden" ${raw.hidden === 0 ? "" : "checked"}> ${t("ad.draftCheck")}</label>
      </div>
      ${ptero ? `<details><summary class="small muted">${esc(t("ad.rawPtero", { ago: ago(ptero.synced_at) }))}</summary><pre class="vars">${esc(JSON.stringify(ptero, null, 2))}</pre></details>` : ""}
      <div class="actions">
        ${id ? `<button type="button" class="danger" data-delete>${t("ad.deletePage")}</button>` : ""}
        <span style="flex:1"></span>
        <button type="button" data-cancel>${t("cancel")}</button>
        <button class="primary">${id ? t("save") : t("ad.create")}</button>
      </div>
    </form>`;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });

  const form = editor.querySelector("form");
  form.querySelector("[data-cancel]").onclick = () => (editor.innerHTML = "");
  const del = form.querySelector("[data-delete]");
  if (del) del.onclick = async () => {
    if (!confirm(t("ad.confirmDeletePage", { name: raw.name || id }))) return;
    try { await api(`/api/servers/${encodeURIComponent(id)}`, { method: "DELETE" }); toast(t("ad.deleted")); serversTab(); }
    catch (e) { toast(e.message, true); }
  };
  onSubmit(form, async (d) => {
    if (id) await api(`/api/servers/${encodeURIComponent(id)}`, { method: "PATCH", body: d });
    else await api("/api/servers", { method: "POST", body: d });
    toast(t("saved"));
    serversTab();
  });
}

/* ---------------- Pterodactyl ---------------- */

async function pteroTab() {
  tabEl.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const { servers, last_sync } = await api("/api/ptero");
  const stale = last_sync && Date.now() - last_sync > 10 * 60_000;
  tabEl.innerHTML = `
    <div class="section-head"><h2>${t("ad.tabPtero")}</h2></div>
    ${last_sync
      ? `<div class="notice ${stale ? "warn" : ""}">${t("ad.lastSync", { ago: esc(ago(last_sync)) })}${stale ? t("ad.syncStalled") : ""}</div>`
      : `<div class="notice warn">${t("ad.noSync")}</div>`}
    <div class="card table-wrap"><table>
      <thead><tr><th>${t("ad.colPtero")}</th><th>${t("ad.colEgg")}</th><th>${t("ad.colPort")}</th><th>${t("ad.colState")}</th><th>${t("ad.colVersions")}</th><th>${t("ad.colPage")}</th></tr></thead>
      <tbody>${servers.map((p) => `
        <tr>
          <td class="primary-cell">${esc(p.data.name)}<div class="hint">${esc(p.data.identifier || p.uuid)}</div></td>
          <td class="small" data-label="${esc(t("ad.colEgg"))}">${esc(p.data.egg || "—")}</td>
          <td data-label="${esc(t("ad.colPort"))}">${esc(p.data.port ?? "—")}</td>
          <td data-label="${esc(t("ad.colState"))}">${esc(t(`status.${p.data.state === "running" ? "running" : p.data.state}`))}${p.data.players_online !== null ? ` · ${p.data.players_online}/${p.data.players_max}` : ""}</td>
          <td class="small" data-label="${esc(t("ad.colVersions"))}">${esc([p.auto.mc_version, p.auto.loader, p.auto.loader_version].filter(Boolean).join(" · ") || "—")}</td>
          <td data-label="${esc(t("ad.colPage"))}">${p.linked_to
            ? `<a href="/server?id=${encodeURIComponent(p.linked_to)}">${esc(p.linked_to)}</a>`
            : `<button data-create="${esc(p.uuid)}" data-name="${esc(p.data.name)}">${t("ad.createPage")}</button>`}</td>
        </tr>`).join("") || `<tr><td colspan="6" class="muted">${t("ad.nothingSynced")}</td></tr>`}
      </tbody></table></div>
    <p class="hint">${t("ad.createHint")}</p>`;
  tabEl.querySelectorAll("[data-create]").forEach((b) => b.onclick = async () => {
    try {
      const { id } = await api("/api/servers", { method: "POST", body: { ptero_uuid: b.dataset.create, name: b.dataset.name } });
      toast(t("ad.draftCreated", { id }));
      main.querySelector('[data-tab="servers"]').click();
      setTimeout(() => editServer(id), 300);
    } catch (e) { toast(e.message, true); }
  });
}

/* ---------------- Users ---------------- */

const ROLES = ["pending", "member", "staff", "admin"];

async function usersTab() {
  tabEl.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const { users, owner_discord_id } = await api("/api/users");
  const pending = users.filter((u) => u.role === "pending").length;
  tabEl.innerHTML = `
    <div class="section-head"><h2>${t("ad.users")}</h2></div>
    ${pending ? `<div class="notice warn">${esc(t("ad.waiting", { n: pending }))}</div>` : ""}
    <p class="hint">${ROLES.map((r) => `<b>${esc(roleLabel(r))}</b>: ${esc(t(`ad.roleHelp.${r}`))}`).join(" · ")}</p>
    <div class="card table-wrap"><table>
      <thead><tr><th>${t("ad.colUser")}</th><th>${t("ad.colRole")}</th><th>${t("ad.colJoined")}</th><th>${t("ad.colLastLogin")}</th></tr></thead>
      <tbody>${users.map((u) => {
        const locked = u.id === user.id || u.discord_id === owner_discord_id;
        return `<tr>
          <td class="primary-cell"><img src="${esc(u.avatar)}" alt="">${esc(u.username)}<div class="hint">${esc(t("ad.discordId", { id: u.discord_id }))}${u.mc_name ? ` · MC: ${esc(u.mc_name)} <button class="link" data-unlink="${u.id}">${t("ad.unlink")}</button>` : ""}</div></td>
          <td data-label="${esc(t("ad.colRole"))}">${locked ? `<span class="role ${esc(u.role)}">${esc(roleLabel(u.role))}</span>` : `
            <select data-user="${u.id}" style="width:auto">
              ${ROLES.map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${esc(roleLabel(r))}</option>`).join("")}
            </select>`}</td>
          <td class="small" data-label="${esc(t("ad.colJoined"))}">${fmtDate(u.created_at)}</td>
          <td class="small" data-label="${esc(t("ad.colLastLogin"))}">${u.last_login ? esc(ago(u.last_login)) : "—"}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  tabEl.querySelectorAll("[data-unlink]").forEach((b) => b.onclick = async () => {
    if (!confirm(t("ad.confirmUnlink"))) return;
    try { await api(`/api/users/${b.dataset.unlink}`, { method: "PATCH", body: { unlink_mc: true } }); usersTab(); }
    catch (e) { toast(e.message, true); }
  });
  tabEl.querySelectorAll("[data-user]").forEach((sel) => {
    const was = sel.value;
    sel.onchange = async () => {
      if (sel.value === "admin" && !confirm(t("ad.confirmAdmin"))) { sel.value = was; return; }
      try { await api(`/api/users/${sel.dataset.user}`, { method: "PATCH", body: { role: sel.value } }); toast(t("ad.roleUpdated")); usersTab(); }
      catch (e) { toast(e.message, true); sel.value = was; }
    };
  });
}

serversTab().catch((e) => (tabEl.innerHTML = `<p class="muted">${esc(e.message)}</p>`));
