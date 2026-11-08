import { api, esc, can, perm, t, initPage, onSubmit, toast, ago, fmtDate, statusBadge, roleLabel } from "./common.js";
import { itemPreview, itemName } from "./cosmetics.js";

const user = await initPage();
const main = document.getElementById("main");

// Admins see every tab; sub-admins only the ones they've been given.
const TAB_PERM = { servers: "servers", ptero: "servers", users: "users", store: "store" };
const allowed = Object.keys(TAB_PERM).filter((tab) => perm(user, TAB_PERM[tab]));

if (!allowed.length) {
  main.innerHTML = `<p style="padding:40px 0">${user ? t("ad.only") : t("ad.loginToContinue")}</p>`;
} else {
  main.innerHTML = `
    <div class="tabs">
      ${allowed.map((tab, i) => `<button data-tab="${tab}" class="${i === 0 ? "active" : ""}">${t(`ad.tab${tab[0].toUpperCase()}${tab.slice(1)}`)}</button>`).join("")}
    </div>
    <section id="tab"></section>`;
}

const tabEl = main.querySelector("#tab") || document.createElement("section");
const tabs = { servers: serversTab, ptero: pteroTab, users: usersTab, store: storeTab };
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

const ROLES = ["pending", "member", "staff", "subadmin", "admin"];
const SUB_MANAGEABLE = ["pending", "member", "staff"];
const PERMS = ["users", "servers", "store"];

async function usersTab() {
  tabEl.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const { users, owner_discord_id } = await api("/api/users");
  const isAdmin = user.role === "admin";
  const pending = users.filter((u) => u.role === "pending").length;
  const grantable = isAdmin ? ROLES : SUB_MANAGEABLE;
  const permsOf = (u) => { try { return JSON.parse(u.permissions || "[]"); } catch { return []; } };

  tabEl.innerHTML = `
    <div class="section-head"><h2>${t("ad.users")}</h2></div>
    ${pending ? `<div class="notice warn">${esc(t("ad.waiting", { n: pending }))}</div>` : ""}
    <p class="hint">${ROLES.map((r) => `<b>${esc(roleLabel(r))}</b>: ${esc(t(`ad.roleHelp.${r}`))}`).join(" · ")}</p>
    <div class="card table-wrap"><table>
      <thead><tr><th>${t("ad.colUser")}</th><th>${t("ad.colRole")}</th><th>${t("ad.colJoined")}</th><th>${t("ad.colLastLogin")}</th></tr></thead>
      <tbody>${users.map((u) => {
        const locked = u.id === user.id || u.discord_id === owner_discord_id || (!isAdmin && !SUB_MANAGEABLE.includes(u.role));
        const p = permsOf(u);
        return `<tr>
          <td class="primary-cell"><img src="${esc(u.avatar)}" alt="">${esc(u.username)}<div class="hint">${esc(t("ad.discordId", { id: u.discord_id }))}${u.mc_name ? ` · MC: ${esc(u.mc_name)}${locked ? "" : ` <button class="link" data-unlink="${u.id}">${t("ad.unlink")}</button>`}` : ""}</div></td>
          <td data-label="${esc(t("ad.colRole"))}">
            ${locked ? `<span class="role ${esc(u.role)}">${esc(roleLabel(u.role))}</span>` : `
              <select data-user="${u.id}" style="width:auto">
                ${grantable.map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${esc(roleLabel(r))}</option>`).join("")}
              </select>`}
            ${u.role === "subadmin" ? `<div class="perm-list">
              ${PERMS.map((pp) => `<label class="check small"><input type="checkbox" data-perm="${pp}" data-uid="${u.id}" ${p.includes(pp) ? "checked" : ""} ${isAdmin && !locked ? "" : "disabled"}> ${t(`ad.perm.${pp}`)}</label>`).join("")}
            </div>` : ""}
          </td>
          <td class="small" data-label="${esc(t("ad.colJoined"))}">${fmtDate(u.created_at)}</td>
          <td class="small" data-label="${esc(t("ad.colLastLogin"))}">${u.last_login ? esc(ago(u.last_login)) : "—"}</td>
        </tr>`;
      }).join("")}</tbody></table></div>
    ${isAdmin ? `<p class="hint">${t("ad.subadminHelp")}</p>` : ""}`;

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
  tabEl.querySelectorAll("[data-perm]").forEach((cb) => cb.onchange = async () => {
    const uid = cb.dataset.uid;
    const permissions = [...tabEl.querySelectorAll(`[data-perm][data-uid="${uid}"]`)].filter((x) => x.checked).map((x) => x.dataset.perm);
    try { await api(`/api/users/${uid}`, { method: "PATCH", body: { role: "subadmin", permissions } }); toast(t("ad.permsUpdated")); }
    catch (e) { toast(e.message, true); cb.checked = !cb.checked; }
  });
}

/* ---------------- Store ---------------- */

const TYPES = ["frame", "hat", "color", "sticker"];
const FRAME_STYLES = ["solid", "glow", "pulse", "rainbow", "shimmer"];

async function storeTab() {
  tabEl.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const [{ items }, settings] = await Promise.all([api("/api/store"), api("/api/settings")]);
  tabEl.innerHTML = `
    <div class="section-head"><h2>${t("ad.tabStore")}</h2><button id="add-item">${t("ad.addItem")}</button></div>
    <form class="card stack" id="coin-settings">
      <h3 style="margin:0">${t("ad.coinRules")}</h3>
      <div class="row">
        <label>${t("ad.coinsBase")}<input name="coins_base" type="number" min="0" value="${settings.coins_base}"></label>
        <label>${t("ad.coinsPerLevel")}<input name="coins_per_level" type="number" min="0" value="${settings.coins_per_level}"></label>
      </div>
      <p class="hint" id="coin-example"></p>
      <div class="actions"><span style="flex:1"></span><button class="primary">${t("save")}</button></div>
    </form>
    <div id="item-editor"></div>
    ${TYPES.map((type) => `
      <h3>${t(`st.${type === "frame" ? "frames" : type === "hat" ? "hats" : type === "color" ? "colors" : "stickers"}`)}</h3>
      <div class="card table-wrap"><table>
        <thead><tr><th></th><th>${t("ad.colName")}</th><th>${t("ad.itemPrice")}</th><th>${t("ad.itemLevel")}</th><th>${t("ad.itemReward")}</th><th></th></tr></thead>
        <tbody>${items.filter((i) => i.type === type).map((i) => `
          <tr class="${i.active ? "" : "inactive-row"}">
            <td class="primary-cell"><span class="admin-item-prev">${itemPreview(i, user, 34)}</span> ${esc(itemName(i))}
              <div class="hint">${esc(i.id)}${i.active ? "" : ` · ${t("q.inactive")}`}</div></td>
            <td data-label="${esc(t("ad.itemPrice"))}">${i.price ? `🪙 ${i.price}` : `<span class="muted">${t("ad.notSold")}</span>`}</td>
            <td data-label="${esc(t("ad.itemLevel"))}">${i.price ? i.level : "—"}</td>
            <td data-label="${esc(t("ad.itemReward"))}">${i.reward_level !== null ? `🎁 ${t("lvl.short")} ${i.reward_level}` : "—"}</td>
            <td class="actions"><button data-edit-item="${esc(i.id)}">${t("edit")}</button></td>
          </tr>`).join("") || `<tr><td colspan="6" class="muted">—</td></tr>`}
        </tbody></table></div>`).join("")}`;

  const cs = tabEl.querySelector("#coin-settings");
  const example = () => {
    const b = Number(cs.coins_base.value) || 0, p = Number(cs.coins_per_level.value) || 0;
    const total = (n) => b * n + p * n * (n + 1) / 2;
    tabEl.querySelector("#coin-example").textContent = t("ad.coinExample", { l1: b + p, l10: b + p * 10, t10: total(10), t20: total(20) });
  };
  cs.addEventListener("input", example); example();
  onSubmit(cs, async (d) => { await api("/api/settings", { method: "PATCH", body: d }); toast(t("saved")); });

  tabEl.querySelector("#add-item").onclick = () => editItem(null, items);
  tabEl.querySelectorAll("[data-edit-item]").forEach((b) => b.onclick = () => editItem(items.find((i) => i.id === b.dataset.editItem), items));
}

function editItem(item, items) {
  const editor = tabEl.querySelector("#item-editor");
  const isNew = !item;
  const it = item || { type: "sticker", visual: { emoji: "😎" }, active: 1, level: 0, sort_order: 0, price: 50, reward_level: null };
  const v = it.visual || {};
  editor.innerHTML = `
    <form class="stack card item-form">
      <h3 style="margin:0">${isNew ? t("ad.newItem") : esc(t("ad.editTitle", { name: itemName(it) }))}</h3>
      <div class="item-form-grid">
        <div class="item-live"><div class="si-preview" id="live"></div><span class="hint">${t("ad.preview")}</span></div>
        <div class="stack">
          <div class="row">
            ${isNew ? `<label>${t("ad.itemType")}<select name="type">${TYPES.map((x) => `<option value="${x}" ${it.type === x ? "selected" : ""}>${t(`ad.type.${x}`)}</option>`).join("")}</select></label>
                       <label>${t("ad.itemId")}<input name="id" required pattern="[a-z0-9_]{2,40}" placeholder="st_creeper_face"></label>`
                    : `<label>${t("ad.itemType")}<input value="${esc(t(`ad.type.${it.type}`))}" disabled></label><label>ID<input value="${esc(it.id)}" disabled></label>`}
          </div>
          <div class="row">
            <label>${t("ad.nameEn")}<input name="name" required maxlength="60" value="${esc(it.name)}"></label>
            <label>${t("ad.nameEs")}<input name="name_es" maxlength="60" value="${esc(it.name_es)}"></label>
          </div>
          <div class="row look-row">
            <label class="f-emoji">${t("ad.emoji")}<input name="emoji" maxlength="16" value="${esc(v.emoji)}" placeholder="😎"></label>
            <label class="f-text">${t("ad.text")}<input name="text" maxlength="8" value="${esc(v.text)}" placeholder="GG"></label>
            <label class="f-image">${t("ad.image")}<input name="image" value="${esc(v.image)}" placeholder="https://…/sticker.png"></label>
            <label class="f-color">${t("ad.color")}<input name="color" type="color" value="${esc(v.color || "#6fcf5a")}"></label>
            <label class="f-style">${t("ad.style")}<select name="style"></select></label>
            <label class="check f-halo"><input type="checkbox" name="halo" ${v.halo ? "checked" : ""}> ${t("ad.halo")}</label>
          </div>
          <p class="hint look-hint"></p>
          <div class="row">
            <label>${t("ad.itemPrice")}<input name="price" type="number" min="1" value="${esc(it.price ?? "")}" placeholder="${esc(t("ad.notSold"))}"></label>
            <label>${t("ad.itemLevel")}<input name="level" type="number" min="0" value="${esc(it.level ?? 0)}"></label>
            <label>${t("ad.itemReward")}<input name="reward_level" type="number" min="0" value="${esc(it.reward_level ?? "")}" placeholder="—"></label>
            <label>${t("ad.sortOrder")}<input name="sort_order" type="number" value="${esc(it.sort_order ?? 0)}"></label>
          </div>
          <p class="hint">${t("ad.itemHelp")}</p>
          <label class="check"><input type="checkbox" name="active" ${it.active ? "checked" : ""}> ${t("ad.itemActive")}</label>
        </div>
      </div>
      <div class="actions">
        ${isNew ? "" : `<button type="button" class="danger" data-delete-item>${t("delete")}</button>`}
        <span style="flex:1"></span>
        <button type="button" data-cancel>${t("cancel")}</button>
        <button class="primary">${isNew ? t("ad.create") : t("save")}</button>
      </div>
    </form>`;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });

  const form = editor.querySelector("form");
  const typeOf = () => (isNew ? form.type.value : it.type);
  const show = (cls, on) => form.querySelector(cls).classList.toggle("hidden", !on);

  function styleOptions() {
    const type = typeOf();
    const opts = type === "frame" ? FRAME_STYLES : ["solid", "glow", "rainbow"];
    const cur = form.style.value || v.style || "solid";
    form.style.innerHTML = opts.map((o) => `<option value="${o}" ${o === cur ? "selected" : ""}>${t(`ad.style.${o}`)}</option>`).join("");
  }
  function visual() {
    const type = typeOf();
    if (type === "frame" || type === "color") return { color: form.color.value, style: form.style.value };
    if (type === "hat") return form.halo.checked ? { halo: true } : form.image.value.trim() ? { image: form.image.value.trim() } : { emoji: form.emoji.value.trim() };
    return form.image.value.trim() ? { image: form.image.value.trim() } : form.text.value.trim() ? { text: form.text.value.trim().toUpperCase() } : { emoji: form.emoji.value.trim() };
  }
  function refresh() {
    const type = typeOf();
    const look = type === "frame" || type === "color";
    show(".f-color", look && form.style.value !== "rainbow"); show(".f-style", look);
    show(".f-emoji", !look && !(type === "hat" && form.halo.checked)); show(".f-image", !look && !(type === "hat" && form.halo.checked));
    show(".f-text", type === "sticker"); show(".f-halo", type === "hat");
    form.querySelector(".look-hint").textContent = t(`ad.lookHint.${type}`);
    const preview = { type, name: form.name.value || "?", name_es: form.name_es.value, visual: visual() };
    editor.querySelector("#live").innerHTML = itemPreview(preview, user, 64);
  }
  if (isNew) form.type.onchange = () => { styleOptions(); refresh(); };
  styleOptions(); refresh();
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);

  form.querySelector("[data-cancel]").onclick = () => (editor.innerHTML = "");
  form.querySelector("[data-delete-item]")?.addEventListener("click", async () => {
    if (!confirm(t("ad.confirmDeleteItem", { name: itemName(it) }))) return;
    try { await api(`/api/store/items/${encodeURIComponent(it.id)}`, { method: "DELETE" }); toast(t("ad.deleted")); storeTab(); }
    catch (e) { toast(e.message, true); }
  });
  onSubmit(form, async (d) => {
    const body = { name: d.name, name_es: d.name_es, price: d.price || null, level: d.level, reward_level: d.reward_level === "" ? null : d.reward_level,
      sort_order: d.sort_order, active: d.active, visual: visual() };
    if (isNew) await api("/api/store/items", { method: "POST", body: { ...body, id: d.id, type: d.type } });
    else await api(`/api/store/items/${encodeURIComponent(it.id)}`, { method: "PATCH", body });
    toast(t("saved")); location.hash = "store"; location.reload();
  });
}

const startTab = allowed.includes(location.hash.slice(1)) ? location.hash.slice(1) : allowed[0];
if (startTab) {
  main.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x.dataset.tab === startTab));
  tabs[startTab]().catch((e) => (tabEl.innerHTML = `<p class="muted">${esc(e.message)}</p>`));
}
