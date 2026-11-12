import { uploadImage } from "./common.js";
import { api, esc, can, perm, t, initPage, SITE, gameLabel, localized, toISO, toLocalInput, onSubmit, toast, ago, fmtDate, statusBadge, roleLabel } from "./common.js";
import { itemPreview, itemName, FONTS, EFFECTS, registerFont, hatPlacement, TABFX } from "./cosmetics.js";
import { PART_SLOTS, ART_IDS } from "./avatar-parts.js";
import { TEXTURES, EDGES } from "./themes.js";

const user = await initPage();
const main = document.getElementById("main");

// Admins see every tab; sub-admins only the ones they've been given.
const TAB_PERM = { servers: "servers", ptero: "servers", users: "users", activity: "users", store: "store", site: "admin" };
const allowed = Object.keys(TAB_PERM).filter((tab) => (TAB_PERM[tab] === "admin" ? user?.role === "admin" : perm(user, TAB_PERM[tab])));

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
const tabs = { servers: serversTab, ptero: pteroTab, users: usersTab, activity: activityTab, store: storeTab, site: siteTab };
main.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => {
  main.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
  tabs[b.dataset.tab]().catch((e) => (tabEl.innerHTML = `<p class="muted">${esc(e.message)}</p>`));
});

/* ---------------- Servers ---------------- */

let GAMES = [];

async function serversTab() {
  tabEl.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const [{ servers }, { games }] = await Promise.all([api("/api/servers"), api("/api/games")]);
  GAMES = games;
  tabEl.innerHTML = `
    <div class="section-head"><h2>${t("ad.games")}</h2><button id="add-game">${t("ad.addGame")}</button></div>
    <div id="game-editor"></div>
    <div class="game-admin-list">${games.map((g) => `
      <div class="card game-admin" style="--gc:${esc(g.color || "#6fcf5a")}">
        <span class="ga-ico">${esc(g.icon || "🎮")}</span>
        <div class="ga-main"><b>${esc(gameLabel(g))}</b>${g.active ? "" : ` <span class="draft">${t("q.inactive")}</span>`}
          <div class="hint">${esc(g.id)} · ${t("home.serverCount", { n: servers.filter((s) => s.game_id === g.id).length })}</div></div>
        <button data-edit-game="${esc(g.id)}">${t("edit")}</button>
      </div>`).join("")}</div>

    <div class="section-head" style="margin-top:24px"><h2>${t("ad.serverPages")}</h2><button id="add">${t("ad.addManual")}</button></div>
    <p class="hint">${t("ad.serversHint")}</p>
    <div id="editor"></div>
    <div class="card table-wrap"><table>
      <thead><tr><th>${t("ad.colName")}</th><th>${t("ad.colConnect")}</th><th>${t("ad.colStatus")}</th><th>${t("ad.colVisible")}</th><th>${t("ad.colOrder")}</th><th></th></tr></thead>
      <tbody>${servers.map((s) => `
        <tr>
          <td class="primary-cell"><a href="/server?id=${encodeURIComponent(s.id)}">${esc(s.name)}</a><div class="hint">${esc(s.id)}${s.linked ? ` · ${t("ad.linked")}` : ""}
            · ${(() => { const g = games.find((x) => x.id === s.game_id); return g ? `${esc(g.icon || "")} ${esc(gameLabel(g))}` : `<span class="draft">${t("ad.noGame")}</span>`; })()}</div></td>
          <td data-label="${esc(t("ad.colConnect"))}"><code>${esc(s.connect)}</code></td>
          <td data-label="${esc(t("ad.colStatus"))}">${statusBadge(s) || `<span class="muted small">${t("ad.notLinked")}</span>`}</td>
          <td data-label="${esc(t("ad.colVisible"))}">${s.hidden ? `<span class="draft">${t("ad.draft")}</span>` : t("ad.public")}</td>
          <td data-label="${esc(t("ad.colOrder"))}">${s.sort_order}</td>
          <td class="actions"><button data-edit="${esc(s.id)}">${t("edit")}</button></td>
        </tr>`).join("") || `<tr><td colspan="6" class="muted">${t("home.noServers")}</td></tr>`}
      </tbody></table></div>`;
  tabEl.querySelector("#add").onclick = () => editServer(null);
  tabEl.querySelector("#add-game").onclick = () => editGame(null);
  tabEl.querySelectorAll("[data-edit-game]").forEach((b) => b.onclick = () => editGame(games.find((g) => g.id === b.dataset.editGame)));
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
      <label>${t("ad.serverGame")}
        <select name="game_id">
          <option value="">${t("ad.noGame")}</option>
          ${GAMES.map((g) => `<option value="${esc(g.id)}" ${(raw.game_id || (!id && GAMES.length === 1 ? GAMES[0].id : "")) === g.id ? "selected" : ""}>${esc(g.icon || "🎮")} ${esc(gameLabel(g))}</option>`).join("")}
        </select></label>
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
        ${f("map_url", t("ad.mapLink"), { ph: "https://map.moikas.cc" })}
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
      <details class="guide-edit" ${raw.guide || raw.guide_es ? "open" : ""}>
        <summary><strong>📖 ${t("ad.guide")}</strong></summary>
        <p class="hint">${t("ad.guideHint")}</p>
        <div class="row">
          <label>${t("ad.guideEn")} <button type="button" class="small-btn" data-md-load="guide">⬆ .md</button>
            <textarea name="guide" rows="14" style="font-family:monospace">${esc(raw.guide ?? "")}</textarea></label>
          <label>${t("ad.guideEs")} <button type="button" class="small-btn" data-md-load="guide_es">⬆ .md</button>
            <textarea name="guide_es" rows="14" style="font-family:monospace">${esc(raw.guide_es ?? "")}</textarea></label>
        </div>
        ${id ? `<a class="small" href="/guide?id=${encodeURIComponent(id)}" target="_blank">${t("ad.guidePreview")} ↗</a>` : ""}
      </details>
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
  // load a .md file into a guide box
  form.querySelectorAll("[data-md-load]").forEach((b) => b.onclick = (ev) => {
    ev.preventDefault();
    const pick = document.createElement("input");
    pick.type = "file"; pick.accept = ".md,.markdown,.txt,text/markdown,text/plain";
    pick.onchange = async () => {
      const f = pick.files[0];
      if (!f) return;
      if (f.size > 60000) return toast(t("ad.guideTooBig"), true);
      form.querySelector(`[name="${b.dataset.mdLoad}"]`).value = await f.text();
    };
    pick.click();
  });
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

function editGame(g) {
  const editor = tabEl.querySelector("#game-editor");
  const isNew = !g;
  g = g || { active: 1, sort_order: GAMES.length, color: "#6aa8e0", icon: "🎮" };
  editor.innerHTML = `
    <form class="stack card">
      <h3 style="margin:0">${isNew ? t("ad.newGame") : esc(t("ad.editTitle", { name: gameLabel(g) }))}</h3>
      <div class="row">
        ${isNew ? `<label>${t("ad.gameId")}<input name="id" required pattern="[a-z0-9-]{2,30}" placeholder="valheim"></label>` : ""}
        <label>${t("ad.nameEn")}<input name="name" required maxlength="50" value="${esc(g.name)}"></label>
        <label>${t("ad.nameEs")}<input name="name_es" maxlength="50" value="${esc(g.name_es)}"></label>
      </div>
      <div class="row">
        <label>${t("ad.emoji")}<input name="icon" maxlength="16" value="${esc(g.icon)}"></label>
        <label>${t("ad.color")}<input name="color" type="color" value="${esc(g.color || "#6aa8e0")}"></label>
        <label>${t("ad.gameImage")}<input name="image" value="${esc(g.image)}" placeholder="https://…/banner.jpg"></label>
      </div>
      <div class="row">
        <label>${t("ad.description")}<textarea name="description" maxlength="500">${esc(g.description)}</textarea></label>
        <label>${t("ad.descriptionEs")}<textarea name="description_es" maxlength="500">${esc(g.description_es)}</textarea></label>
      </div>
      <div class="row">
        <label>${t("ad.sortOrder")}<input name="sort_order" type="number" value="${esc(g.sort_order ?? 0)}"></label>
        <label class="check"><input type="checkbox" name="active" ${g.active ? "checked" : ""}> ${t("ad.gameActive")}</label>
      </div>
      <div class="actions">
        ${isNew ? "" : `<button type="button" class="danger" data-delete>${t("delete")}</button>`}
        <span style="flex:1"></span>
        <button type="button" data-cancel>${t("cancel")}</button>
        <button class="primary">${isNew ? t("ad.create") : t("save")}</button>
      </div>
    </form>`;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
  const form = editor.querySelector("form");
  form.querySelector("[data-cancel]").onclick = () => (editor.innerHTML = "");
  form.querySelector("[data-delete]")?.addEventListener("click", async () => {
    if (!confirm(t("ad.confirmDeleteGame", { name: gameLabel(g) }))) return;
    try { await api(`/api/games/${encodeURIComponent(g.id)}`, { method: "DELETE" }); toast(t("ad.deleted")); serversTab(); }
    catch (e) { toast(e.message, true); }
  });
  onSubmit(form, async (d) => {
    if (isNew) await api("/api/games", { method: "POST", body: d });
    else await api(`/api/games/${encodeURIComponent(g.id)}`, { method: "PATCH", body: d });
    toast(t("saved")); serversTab();
  });
}

let COLLECTIONS = [];

function editCollection(c) {
  const editor = tabEl.querySelector("#col-editor");
  const isNew = !c;
  c = c || { active: 1, featured: 1, color: "#c9b458", icon: "📦", price: null };
  const local = (ms) => (ms ? toLocalInput(ms) : "");
  editor.innerHTML = `
    <form class="stack card">
      <h3 style="margin:0">${isNew ? t("ad.newCollection") : esc(t("ad.editTitle", { name: localized(c.name, c.name_es) }))}</h3>
      <div class="row">
        ${isNew ? `<label>${t("ad.itemId")}<input name="id" required pattern="[a-z0-9_-]{2,40}" placeholder="halloween-2026"></label>` : ""}
        <label>${t("ad.nameEn")}<input name="name" required maxlength="60" value="${esc(c.name)}"></label>
        <label>${t("ad.nameEs")}<input name="name_es" maxlength="60" value="${esc(c.name_es)}"></label>
      </div>
      <div class="row">
        <label>${t("ad.emoji")}<input name="icon" maxlength="16" value="${esc(c.icon)}"></label>
        <label>${t("ad.color")}<input name="color" type="color" value="${esc(c.color || "#c9b458")}"></label>
        <label>${t("ad.bundlePrice")}<input name="price" type="number" min="1" value="${esc(c.price ?? "")}" placeholder="${esc(t("ad.notSold"))}"></label>
      </div>
      <div class="row">
        <label>${t("ad.description")}<textarea name="description" maxlength="400">${esc(c.description)}</textarea></label>
        <label>${t("ad.descriptionEs")}<textarea name="description_es" maxlength="400">${esc(c.description_es)}</textarea></label>
      </div>
      <div class="row">
        <label>${t("ad.startsAt")}<input name="starts_at" type="datetime-local" value="${esc(local(c.starts_at))}"></label>
        <label>${t("ad.endsAt")}<input name="ends_at" type="datetime-local" value="${esc(local(c.ends_at))}"></label>
        <label>${t("ad.sortOrder")}<input name="sort_order" type="number" value="${esc(c.sort_order ?? 0)}"></label>
      </div>
      <p class="hint">${t("ad.collectionHelp")}</p>
      <div class="actions">
        <label class="check"><input type="checkbox" name="featured" ${c.featured ? "checked" : ""}> ⭐ ${t("ad.featured")}</label>
        <label class="check"><input type="checkbox" name="active" ${c.active ? "checked" : ""}> ${t("ad.itemActive")}</label>
        <span style="flex:1"></span>
        ${isNew ? "" : `<button type="button" class="danger" data-delete>${t("delete")}</button>`}
        <button type="button" data-cancel>${t("cancel")}</button>
        <button class="primary">${isNew ? t("ad.create") : t("save")}</button>
      </div>
    </form>`;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
  const form = editor.querySelector("form");
  form.querySelector("[data-cancel]").onclick = () => (editor.innerHTML = "");
  form.querySelector("[data-delete]")?.addEventListener("click", async () => {
    if (!confirm(t("ad.confirmDeleteCollection"))) return;
    try { await api(`/api/store/collections/${encodeURIComponent(c.id)}`, { method: "DELETE" }); toast(t("ad.deleted")); storeTab(); }
    catch (e) { toast(e.message, true); }
  });
  onSubmit(form, async (d) => {
    const body = { ...d, price: d.price || null, starts_at: toISO(d.starts_at), ends_at: toISO(d.ends_at) };
    if (isNew) await api("/api/store/collections", { method: "POST", body });
    else await api(`/api/store/collections/${encodeURIComponent(c.id)}`, { method: "PATCH", body });
    toast(t("saved")); storeTab();
  });
}

/* ---------------- Site (admin only) ---------------- */

async function siteTab() {
  tabEl.innerHTML = `
    <div class="section-head"><h2>${t("ad.tabSite")}</h2></div>
    <form class="card stack" id="site-form">
      <label>${t("ad.likeEmoji")}
        <div class="actions"><input name="like_emoji" maxlength="16" value="${esc(SITE.like_emoji)}" style="max-width:120px;font-size:1.5rem;text-align:center">
          <span class="like-preview">${t("ad.likePreview")}: <button type="button" class="like on"><span class="emo">${esc(SITE.like_emoji)}</span> <span class="n">12</span></button></span></div>
      </label>
      <div class="emoji-picks">${["❤️", "🔥", "👍", "⭐", "💎", "⛏️", "🍺", "😂", "💀", "🫶", "🙌", "🌮"].map((e) => `<button type="button" data-pick="${e}">${e}</button>`).join("")}</div>
      <p class="hint">${t("ad.likeHint")}</p>
      <div class="actions"><span style="flex:1"></span><button class="primary">${t("save")}</button></div>
    </form>`;
  const form = tabEl.querySelector("#site-form");
  const sync = () => (form.querySelector(".like-preview .emo").textContent = form.like_emoji.value || "❤️");
  form.like_emoji.addEventListener("input", sync);
  form.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => { form.like_emoji.value = b.dataset.pick; sync(); });
  onSubmit(form, async (d) => { await api("/api/site", { method: "PATCH", body: d }); toast(t("saved")); });
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
const PERMS = ["users", "servers", "store", "moderation"];

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
          <td class="primary-cell"><img src="${esc(u.avatar)}" alt="">${esc(u.username)}${isAdmin ? ` <button class="link small" data-wallet="${u.id}">🪙 ${t("ad.wallet")}</button>` : ""}<div class="hint">${esc(t("ad.discordId", { id: u.discord_id }))}${u.mc_name ? ` · MC: ${esc(u.mc_name)}${locked ? "" : ` <button class="link" data-unlink="${u.id}">${t("ad.unlink")}</button>`}` : ""}</div></td>
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
    ${isAdmin ? `<p class="hint">${t("ad.subadminHelp")}</p>` : ""}
    <div id="wallet-panel"></div>`;

  tabEl.querySelectorAll("[data-wallet]").forEach((b) => b.onclick = () => walletPanel(b.dataset.wallet));

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

// Image frames must be square with the avatar in the middle (384×384 template). Trimmed exports end up off-centre,
// so warn as soon as the image loads.
let frameCheckSeq = 0;
function checkFrameImage(url, hintEl) {
  const seq = ++frameCheckSeq;
  hintEl.querySelector(".frame-warn")?.remove();
  if (!url) return;
  const im = new Image();
  im.onload = () => {
    if (seq !== frameCheckSeq) return;
    const w = im.naturalWidth, h = im.naturalHeight;
    const msg = w !== h ? t("ad.frameNotSquare", { w, h }) : w % 192 ? t("ad.frameOddSize", { w }) : ""; // 384 (or 768…) keeps the avatar in the middle third
    hintEl.insertAdjacentHTML("beforeend", msg ? `<span class="frame-warn">⚠ ${esc(msg)}</span>` : `<span class="frame-warn ok">✓ ${esc(t("ad.frameOk", { w, h }))}</span>`);
  };
  im.onerror = () => { if (seq === frameCheckSeq) hintEl.insertAdjacentHTML("beforeend", `<span class="frame-warn">⚠ ${esc(t("ad.frameNoLoad"))}</span>`); };
  im.src = url;
}

// Font dropdown: built-in fonts, then uploaded ones (⬆).
function fontOptions(cur = "default") {
  const opt = ([k, n]) => `<option value="${k}" ${(cur || "default") === k ? "selected" : ""}>${esc(k === "default" ? t("ad.font.default") : n)}</option>`;
  const all = Object.entries(FONTS);
  const up = all.filter(([k]) => k.startsWith("u_"));
  return all.filter(([k]) => !k.startsWith("u_")).map(opt).join("")
    + (up.length ? `<optgroup label="${esc(t("ad.uploadedFonts"))}">${up.map(opt).join("")}</optgroup>` : "");
}

async function loadFontList() {
  const box = tabEl.querySelector("#font-list");
  if (!box) return;
  const { fonts } = await api("/api/fonts").catch(() => ({ fonts: [] }));
  fonts.forEach(registerFont);
  tabEl.querySelector("#font-count").textContent = `(${fonts.length})`;
  box.innerHTML = fonts.length ? fonts.map((f) => `
    <div class="font-row"><span class="tf-${esc(f.id)} font-sample">${esc(f.name)} · GG! ¿Qué onda? 123</span>
      <span class="hint">${esc(f.format)} · ${Math.round(f.size / 1024)} KB</span>
      <button class="link small" data-del-font="${esc(f.id)}">${t("delete")}</button></div>`).join("")
    : `<p class="hint">${t("ad.noUploadedFonts")}</p>`;
  box.querySelectorAll("[data-del-font]").forEach((b) => b.onclick = async () => {
    if (!confirm(t("ad.confirmDeleteFont"))) return;
    try { const r = await api(`/api/fonts/${b.dataset.delFont}`, { method: "DELETE" }); toast(r.items_affected ? t("ad.fontDeletedUsed", { n: r.items_affected }) : t("ad.deleted")); loadFontList(); }
    catch (e) { toast(e.message, true); }
  });
}

/* ---------------- Wallet & items (admin testing tool) ---------------- */

async function walletPanel(uid) {
  const box = tabEl.querySelector("#wallet-panel");
  box.innerHTML = `<p class="muted">${t("loading")}</p>`;
  let w;
  const call = async (b) => {
    try { w = await api(`/api/users/${uid}/wallet`, b ? { method: "POST", body: b } : undefined); render(); }
    catch (e) { toast(e.message, true); }
  };
  function render() {
    const typeName = (ty) => t(`ad.type.${ty}`);
    const have = w.items.filter((i) => i.bought || i.from_level);
    const missing = w.items.filter((i) => !i.bought && !i.from_level);
    const byType = (list) => [...new Set(list.map((i) => i.type))].map((ty) => [ty, list.filter((i) => i.type === ty)]);
    box.innerHTML = `
      <section class="card wallet stack">
        <div class="section-head"><h2>🪙 ${esc(t("ad.walletOf", { name: w.user.username }))}</h2><button class="link" data-close>✕</button></div>
        <div class="wallet-coins">
          <b class="big">🪙 ${w.user.coins.toLocaleString()}</b> <span class="muted small">${t("lvl.short")} ${w.user.level}</span>
          <div class="row wrap">
            ${[100, 1000, 10000].map((n) => `<button data-add="${n}">+${n.toLocaleString()}</button>`).join("")}
            ${[100, 1000].map((n) => `<button data-add="-${n}">−${n.toLocaleString()}</button>`).join("")}
            <input type="number" name="amt" placeholder="${esc(t("ad.amount"))}" style="width:110px">
            <button class="primary" data-set>${t("ad.setTo")}</button>
            <button class="danger" data-zero>${t("ad.setZero")}</button>
          </div>
          <p class="hint">${t("ad.walletHint")}</p>
        </div>
        <div class="row wrap">
          <select name="give" style="flex:1;min-width:220px">
            ${byType(missing).map(([ty, list]) => `<optgroup label="${esc(typeName(ty))}">${list.map((i) => `<option value="${esc(i.id)}">${esc(itemName(i))}${i.active ? "" : ` (${t("q.inactive")})`}</option>`).join("")}</optgroup>`).join("")}
          </select>
          <button class="primary" data-give ${missing.length ? "" : "disabled"}>${t("ad.giveItem")}</button>
          <button data-give-all ${missing.length ? "" : "disabled"}>${t("ad.giveAll")}</button>
          <button class="danger" data-take-all>${t("ad.takeAll")}</button>
        </div>
        <h3 style="margin:6px 0 0">${t("ad.ownedItems", { n: have.length })}</h3>
        <div class="wallet-items">
          ${have.map((i) => `
            <div class="wallet-item ${Object.values(w.equipped).includes(i.id) ? "equipped" : ""}" title="${esc(typeName(i.type))}">
              <span class="wi-prev">${itemPreview(i, null, 30)}</span>
              <span class="small">${esc(itemName(i))}</span>
              ${i.bought ? `<button class="link small" data-take="${esc(i.id)}">${t("ad.take")}</button>` : `<span class="hint">🎁 ${t("ad.fromLevel")}</span>`}
            </div>`).join("") || `<p class="muted">—</p>`}
        </div>
      </section>`;
    box.querySelector("[data-close]").onclick = () => (box.innerHTML = "");
    box.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => call({ coins: Number(b.dataset.add) }));
    const amt = box.querySelector("[name=amt]");
    box.querySelector("[data-set]").onclick = () => amt.value === "" ? toast(t("ad.amount"), true) : call({ set_coins: Number(amt.value) });
    box.querySelector("[data-zero]").onclick = () => call({ set_coins: 0 });
    box.querySelector("[data-give]").onclick = () => call({ give: box.querySelector("[name=give]").value });
    box.querySelectorAll("[data-take]").forEach((b) => b.onclick = () => call({ take: b.dataset.take }));
    box.querySelector("[data-give-all]").onclick = async () => {
      if (!confirm(t("ad.confirmGiveAll", { n: missing.length }))) return;
      for (const i of missing) await api(`/api/users/${uid}/wallet`, { method: "POST", body: { give: i.id } }).catch(() => {});
      call();
    };
    box.querySelector("[data-take-all]").onclick = async () => {
      const bought = w.items.filter((i) => i.bought);
      if (!bought.length || !confirm(t("ad.confirmTakeAll", { n: bought.length }))) return;
      for (const i of bought) await api(`/api/users/${uid}/wallet`, { method: "POST", body: { take: i.id } }).catch(() => {});
      call();
    };
  }
  await call();
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- Store ---------------- */

const TYPES = ["frame", "hat", "color", "font", "textstyle", "sticker", "banner", "wallpaper", "part", "theme", "tabfx"];
const FRAME_STYLES = ["solid", "glow", "pulse", "rainbow", "shimmer"];

async function storeTab() {
  tabEl.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const [{ items, collections }, settings] = await Promise.all([api("/api/store"), api("/api/settings")]);
  COLLECTIONS = collections;
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
    <form class="card stack" id="activity-settings">
      <h3 style="margin:0">${t("ad.activityXp")}</h3>
      <p class="hint" style="margin:0">${t("ad.activityHelp")}</p>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>${t("ad.actXp")}</th><th>${t("ad.actCap")}</th></tr></thead>
        <tbody>${Object.entries(settings.activity || {}).map(([k, a]) => `
          <tr><td class="primary-cell">${t(`act.${k}`)}</td>
            <td data-label="${esc(t("ad.actXp"))}"><input type="number" min="0" name="${k}_xp" value="${a.xp}" style="width:90px"></td>
            <td data-label="${esc(t("ad.actCap"))}"><input type="number" min="0" name="${k}_cap" value="${a.cap}" style="width:90px"></td></tr>`).join("")}
        </tbody></table></div>
      <p class="hint" id="act-total"></p>
      <div class="actions"><span style="flex:1"></span><button class="primary">${t("save")}</button></div>
    </form>
    <div class="section-head" style="margin-top:18px"><h3 style="margin:0">${t("st.collections")}</h3><button id="add-col">${t("ad.addCollection")}</button></div>
    <div id="col-editor"></div>
    <div class="col-admin-list">${collections.map((c) => `
      <div class="card col-admin" style="--cc:${esc(c.color || "#8a93a8")}">
        <span class="bundle-icon">${esc(c.icon || "📦")}</span>
        <div class="ga-main"><b>${esc(localized(c.name, c.name_es))}</b>${c.active ? "" : ` <span class="draft">${t("q.inactive")}</span>`}${c.open === false && c.active ? ` <span class="draft">${t("st.notLive")}</span>` : ""}
          <div class="hint">${t("st.bundleCount", { n: c.item_ids.length })} · ${c.price ? `🪙 ${c.price}` : t("st.bundleItemsOnly")}${c.featured ? ` · ⭐ ${t("ad.featured")}` : ""}</div></div>
        <button data-edit-col="${esc(c.id)}">${t("edit")}</button>
      </div>`).join("") || `<p class="muted small">${t("ad.noCollections")}</p>`}</div>
    <div id="item-editor"></div>
    <details class="card fonts-admin"><summary><b>${t("ad.uploadedFonts")}</b> <span class="muted small" id="font-count"></span></summary><div id="font-list"></div></details>
    ${TYPES.map((type) => `
      <h3>${t(`st.${{ frame: "frames", hat: "hats", color: "colors", font: "fonts", textstyle: "textstyles", sticker: "stickers", banner: "banners", wallpaper: "wallpapers", part: "parts", theme: "themes", tabfx: "tabfx" }[type]}`)}</h3>
      <div class="card table-wrap"><table>
        <thead><tr><th></th><th>${t("ad.colName")}</th><th>${t("ad.itemPrice")}</th><th>${t("ad.itemReward")}</th><th></th></tr></thead>
        <tbody>${items.filter((i) => i.type === type).map((i) => `
          <tr class="${i.active ? "" : "inactive-row"}">
            <td class="primary-cell"><span class="admin-item-prev">${itemPreview(i, user, 34)}</span> ${esc(itemName(i))}
              <div class="hint">${esc(i.id)}${i.active ? "" : ` · ${t("q.inactive")}`}${i.collection_id ? ` · 📦 ${esc(i.collection_id)}` : ""}</div></td>
            <td data-label="${esc(t("ad.itemPrice"))}">${i.price ? `🪙 ${i.price}` : `<span class="muted">${t("ad.notSold")}</span>`}</td>
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

  const as = tabEl.querySelector("#activity-settings");
  const actTotal = () => {
    const caps = Object.keys(settings.activity || {}).reduce((sum, k) => sum + (Number(as[`${k}_cap`].value) || 0), 0);
    tabEl.querySelector("#act-total").textContent = t("ad.actTotal", { n: caps });
  };
  as.addEventListener("input", actTotal); actTotal();
  as.onsubmit = async (e) => {
    e.preventDefault();
    const activity = Object.fromEntries(Object.keys(settings.activity || {}).map((k) => [k, { xp: Number(as[`${k}_xp`].value) || 0, cap: Number(as[`${k}_cap`].value) || 0 }]));
    try { await api("/api/settings", { method: "PATCH", body: { activity } }); toast(t("saved")); } catch (err) { toast(err.message, true); }
  };

  tabEl.querySelector("#add-item").onclick = () => editItem(null, items);
  tabEl.querySelector("#add-col").onclick = () => editCollection(null);
  tabEl.querySelectorAll("[data-edit-col]").forEach((b) => b.onclick = () => editCollection(collections.find((c) => c.id === b.dataset.editCol)));
  tabEl.querySelectorAll("[data-edit-item]").forEach((b) => b.onclick = () => editItem(items.find((i) => i.id === b.dataset.editItem), items));
  loadFontList();
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
            <label class="f-image">${t("ad.image")}<span class="font-pick"><input name="image" value="${esc(v.image)}" placeholder="https://…/sticker.png">
              <button type="button" data-upload-img title="${esc(t("up.help"))}">⬆ ${t("up.upload")}</button>
              <input type="file" name="imgfile" accept="image/png,image/jpeg,image/gif,image/webp" hidden></span></label>
            <label class="f-color">${t("ad.color")}<input name="color" type="color" value="${esc(v.color || "#6fcf5a")}"></label>
            <label class="f-style">${t("ad.style")}<select name="style"></select></label>
            <label class="f-tfx small"><input type="checkbox" name="tfx_color" ${v.color ? "checked" : ""}> ${t("ad.tfxColor")}</label>
            ${(() => { const hp = hatPlacement(v); const sl = (n, label, min, max, val, unit) => `<label class="f-hat">${t(label)} <b data-val="${n}">${val}${unit}</b><input type="range" name="${n}" min="${min}" max="${max}" step="1" value="${val}"></label>`;
              return sl("hsize", "ad.hatSize", 30, 200, hp.size, "%") + sl("hx", "ad.hatX", -100, 100, hp.x, "") + sl("hy", "ad.hatY", -120, 100, hp.y, "") + sl("hrot", "ad.hatRot", -180, 180, hp.rotate, "°")
                + `<button type="button" class="f-hat link small" data-hat-reset>${t("ad.hatReset")}</button>`; })()}
            <label class="check f-halo"><input type="checkbox" name="halo" ${v.halo ? "checked" : ""}> ${t("ad.halo")}</label>
            <label class="f-color2">${t("ad.color2")}<input name="color2" type="color" value="${esc(v.color2 || "#3a4a6b")}"></label>
            <div class="f-theme theme-fields">
              ${[["bg", "#14161a"], ["panel", "#1d2026"], ["border", "#323742"], ["text", "#e8e6e1"], ["muted", "#9aa0aa"], ["accent", ""]].map(([k, d]) =>
                `<label>${t(`th.${k}`)}<span class="row-inline"><input type="color" name="th_${k}" value="${esc(v[k] || d || "#6fcf5a")}">${k === "accent" ? `<span class="check small"><input type="checkbox" name="th_accent_on" ${v.accent ? "checked" : ""}> ${t("th.useAccent")}</span>` : ""}</span></label>`).join("")}
              <label>${t("th.texture")}<select name="th_texture">${TEXTURES.map((x) => `<option value="${x}" ${(v.texture || "none") === x ? "selected" : ""}>${t(`th.tex.${x}`)}</option>`).join("")}</select></label>
              <label>${t("th.strength")} <b data-th="strength">${esc(v.strength ?? 50)}%</b><input type="range" name="th_strength" min="0" max="100" value="${esc(v.strength ?? 50)}"></label>
              <label>${t("th.edge")}<select name="th_edge">${EDGES.map((x) => `<option value="${x}" ${(v.edge || "solid") === x ? "selected" : ""}>${t(`th.edge.${x}`)}</option>`).join("")}</select></label>
              <label>${t("th.radius")} <b data-th="radius">${esc(v.radius ?? 8)}px</b><input type="range" name="th_radius" min="0" max="24" value="${esc(v.radius ?? 8)}"></label>
              <label>${t("th.dim")} <b data-th="dim">${esc(v.dim ?? 70)}%</b><input type="range" name="th_dim" min="0" max="100" value="${esc(v.dim ?? 70)}"></label>
              <label>${t("th.blocks")} <b data-th="blocks">${esc(v.blocks ?? 100)}%</b><input type="range" name="th_blocks" min="20" max="100" value="${esc(v.blocks ?? 100)}"></label>
              <label>${t("th.font")}<select name="th_font">${fontOptions(v.font)}</select></label>
              <label>${t("th.heading")}<select name="th_heading">${fontOptions(v.heading)}</select></label>
            </div>
            <div class="f-tile row-inline">
              <label class="check"><input type="checkbox" name="tile" ${v.tile ? "checked" : ""}> ${t("ad.tile")}</label>
              <label class="tile-size">${t("ad.tileSize")} <b data-tile-val>${esc(v.tile_size || 64)}px</b><input type="range" name="tile_size" min="8" max="512" step="4" value="${esc(v.tile_size || 64)}"></label>
              <label class="check tile-px"><input type="checkbox" name="pixel" ${v.pixel ? "checked" : ""}> ${t("ad.pixel")}</label>
            </div>
            <label class="f-pattern">${t("ad.pattern")}<select name="pattern">${["none", "dots", "grid", "stripes", "blocks", "bricks"].map((x) => `<option value="${x}" ${(v.pattern || "none") === x ? "selected" : ""}>${t(`ad.pattern.${x}`)}</option>`).join("")}</select></label>
            <label class="f-slot">${t("av.part")}<select name="slot">${PART_SLOTS.map((x) => `<option value="${x}" ${v.slot === x ? "selected" : ""}>${t(`av.slot.${x}`)}</option>`).join("")}</select></label>
            <label class="f-art">${t("av.drawing")}<select name="art"><option value="">${t("av.useImage")}</option></select></label>
            <label class="f-font">${t("ad.font")}<span class="font-pick"><select name="font">${fontOptions(v.font)}</select>
              <button type="button" data-upload-font title="${esc(t("ad.uploadFontHelp"))}">⬆ ${t("ad.uploadFont")}</button>
              <input type="file" name="fontfile" accept=".woff2,.woff,.ttf,.otf" hidden></span></label>
            <label class="f-effect">${t("ad.effect")}<select name="effect">${EFFECTS.map((x) => `<option value="${x}" ${(v.effect || "none") === x ? "selected" : ""}>${t(`ad.effect.${x}`)}</option>`).join("")}</select></label>
            <label class="check f-animate"><input type="checkbox" name="animate" ${v.animate ? "checked" : ""}> ${t("ad.animate")}</label>
          </div>
          <p class="hint look-hint"></p>
          <div class="row">
            <label>${t("ad.itemPrice")}<input name="price" type="number" min="1" value="${esc(it.price ?? "")}" placeholder="${esc(t("ad.notSold"))}"></label>
            <label>${t("ad.itemReward")}<input name="reward_level" type="number" min="0" value="${esc(it.reward_level ?? "")}" placeholder="—"></label>
            <label>${t("ad.sortOrder")}<input name="sort_order" type="number" value="${esc(it.sort_order ?? 0)}"></label>
          </div>
          <p class="hint">${t("ad.itemHelp")}</p>
          <label>${t("ad.itemCollection")}<select name="collection_id"><option value="">${t("ad.noCollection")}</option>
            ${COLLECTIONS.map((c) => `<option value="${esc(c.id)}" ${it.collection_id === c.id ? "selected" : ""}>${esc(c.icon || "📦")} ${esc(localized(c.name, c.name_es))}</option>`).join("")}</select></label>
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
    const opts = type === "frame" ? FRAME_STYLES : type === "tabfx" ? TABFX : ["solid", "glow", "rainbow"];
    const cur = form.style.value || v.style || v.fx || opts[0];
    form.style.innerHTML = opts.map((o) => `<option value="${o}" ${o === cur ? "selected" : ""}>${t(`ad.style.${o}`)}</option>`).join("");
  }
  function visual() {
    const type = typeOf();
    if (type === "frame" && form.image.value.trim()) return { image: form.image.value.trim() };
    if (type === "frame" || type === "color") return { color: form.color.value, style: form.style.value };
    if (type === "tabfx") return { fx: form.style.value, color: form.tfx_color.checked ? form.color.value : undefined };
    if (type === "banner" || type === "wallpaper") return { color: form.color.value, color2: form.color2.value, pattern: form.pattern.value,
      tile: form.tile.checked || undefined, tile_size: Number(form.tile_size.value), pixel: form.pixel.checked || undefined,
      image: form.image.value.trim() || undefined, animate: form.animate.checked || undefined };
    if (type === "theme") {
      const g = (k) => form[`th_${k}`].value;
      return { bg: g("bg"), panel: g("panel"), border: g("border"), text: g("text"), muted: g("muted"), accent: form.th_accent_on.checked ? g("accent") : undefined,
        texture: g("texture"), strength: Number(g("strength")), edge: g("edge"), radius: Number(g("radius")), dim: Number(g("dim")), blocks: Number(g("blocks")), font: g("font"), heading: g("heading"),
        image: g("texture") === "image" ? form.image.value.trim() : undefined };
    }
    if (type === "part") return form.image.value.trim() && !form.art.value ? { slot: form.slot.value, image: form.image.value.trim() } : { slot: form.slot.value, art: form.art.value };
    if (type === "font" || type === "textstyle") return { font: form.font.value, effect: form.effect.value, color: form.color.value,
      color2: form.color2.value, animate: form.animate.checked || undefined };
    if (type === "hat") {
      if (form.halo.checked) return { halo: true };
      const extra = { size: Number(form.hsize.value), x: Number(form.hx.value), y: Number(form.hy.value), rotate: Number(form.hrot.value) };
      return form.image.value.trim() ? { image: form.image.value.trim(), ...extra } : { emoji: form.emoji.value.trim(), ...extra };
    }
    return form.image.value.trim() ? { image: form.image.value.trim() } : form.text.value.trim() ? { text: form.text.value.trim().toUpperCase() } : { emoji: form.emoji.value.trim() };
  }
  function refresh() {
    const type = typeOf();
    const look = type === "frame" || type === "color";
    show(".f-color", look && form.style.value !== "rainbow"); show(".f-style", look);
    show(".f-emoji", !look && !(type === "hat" && form.halo.checked)); show(".f-image", !look && !(type === "hat" && form.halo.checked));
    show(".f-text", type === "sticker"); show(".f-halo", type === "hat");
    form.querySelectorAll(".f-hat").forEach((el) => el.classList.toggle("hidden", !(type === "hat" && !form.halo.checked)));
    for (const [n, unit] of [["hsize", "%"], ["hx", ""], ["hy", ""], ["hrot", "°"]]) form.querySelector(`[data-val="${n}"]`).textContent = form[n].value + unit;
    const bg = type === "banner" || type === "wallpaper";
    show(".f-color2", bg); show(".f-pattern", bg); show(".f-animate", bg);
    if (bg) { show(".f-color", true); show(".f-image", true); show(".f-emoji", false); show(".f-style", false); }
    show(".f-tile", bg && !!form.image.value.trim());
    form.querySelector(".tile-size").classList.toggle("hidden", !form.tile.checked);
    form.querySelector(".tile-px").classList.toggle("hidden", !form.tile.checked);
    form.querySelector("[data-tile-val]").textContent = form.tile_size.value + "px";
    if (type === "frame") { // color + style, or a PNG image instead
      const img = !!form.image.value.trim();
      checkFrameImage(form.image.value.trim(), form.querySelector(".look-hint"));
      show(".f-image", true); show(".f-style", !img); show(".f-color", !img && form.style.value !== "rainbow");
      form.image.placeholder = "/frames/my-frame.png";
    }
    const theme = type === "theme";
    show(".f-theme", theme);
    if (theme) {
      ["emoji", "style", "color", "color2", "pattern", "animate", "slot", "art", "font", "effect"].forEach((f) => show(`.f-${f}`, false));
      show(".f-image", form.th_texture.value === "image");
      form.image.placeholder = "/textures/my-tile.png";
      form.querySelector('[data-th="strength"]').textContent = form.th_strength.value + "%";
      form.querySelector('[data-th="radius"]').textContent = form.th_radius.value + "px";
      form.querySelector('[data-th="dim"]').textContent = form.th_dim.value + "%";
      form.querySelector('[data-th="blocks"]').textContent = form.th_blocks.value + "%";
    }
    const part = type === "part";
    show(".f-slot", part); show(".f-art", part);
    if (part) {
      // built-in drawings for the chosen slot (art ids start with the slot name), or a PNG image
      // keep whatever is picked, including "(use an image instead)"; only pick a default drawing the first time
      // or when the part type changes (see slot.onchange below)
      const opts = ART_IDS.filter((a) => a.startsWith(form.slot.value + "_"));
      if (form.art.dataset.slot !== form.slot.value) {
        const cur = form.art.dataset.slot ? "" : (v.art || (v.image ? "" : opts[0] || ""));
        form.art.innerHTML = `<option value="">${t("av.useImage")}</option>` + opts.map((a) => `<option value="${a}">${a.replace(/^[a-z]+_/, "")}</option>`).join("");
        form.art.value = form.art.dataset.slot && !form.image.value.trim() ? opts[0] || "" : cur;
        form.art.dataset.slot = form.slot.value;
      }
      show(".f-emoji", false); show(".f-style", false); show(".f-color", false); show(".f-image", !form.art.value);
      form.image.placeholder = "/parts/my-eyes.png";
    }
    const txt = type === "font" || type === "textstyle";
    show(".f-font", txt); show(".f-effect", txt);
    if (txt) {
      const fx = form.effect.value;
      show(".f-emoji", false); show(".f-image", false); show(".f-style", false); show(".f-pattern", false);
      show(".f-color", !["none", "rainbow"].includes(fx)); show(".f-color2", ["gradient", "graffiti", "3d"].includes(fx));
      show(".f-animate", ["gradient", "rainbow", "graffiti"].includes(fx));
    }
    const tfx = type === "tabfx";
    show(".f-tfx", tfx);
    if (tfx) {
      ["emoji", "image", "text", "halo", "color2", "pattern", "animate", "slot", "art", "font", "effect", "theme"].forEach((f) => form.querySelectorAll(`.f-${f}`).forEach((x) => x.classList.add("hidden")));
      form.querySelectorAll(".f-hat, .f-tile").forEach((x) => x.classList.add("hidden"));
      show(".f-style", true); show(".f-color", form.tfx_color.checked);
    }
    form.querySelector(".look-hint").textContent = t(`ad.lookHint.${type}`);
    const preview = { type, name: form.name.value || "?", name_es: form.name_es.value, visual: visual() };
    editor.querySelector("#live").innerHTML = itemPreview(preview, user, type === "hat" ? 104 : 64); // bigger for dragging hats
  }
  // Hats: drag the hat around in the preview (X/Y sliders follow), or reset to the classic corner.
  form.querySelector("[data-hat-reset]").onclick = () => {
    const d = hatPlacement({ size: form.hsize.value });
    form.hx.value = d.x; form.hy.value = d.y; form.hrot.value = d.rotate; refresh();
  };
  const live = editor.querySelector("#live");
  live.addEventListener("pointerdown", (e) => {
    const hat = e.target.closest(".av-hat");
    if (!hat || typeOf() !== "hat") return;
    e.preventDefault();
    const av = hat.closest(".av").getBoundingClientRect();
    const move = (ev) => {
      form.hx.value = Math.round(((ev.clientX - av.left) / av.width - 0.5) * 100);
      form.hy.value = Math.round(((ev.clientY - av.top) / av.height - 0.5) * 100);
      refresh();
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });

  // Upload an image (frame, hat, sticker, banner, wallpaper, part, theme tile) instead of pushing it to the repo.
  // Small files go up untouched so pixel art and exact frame sizes are kept.
  const imgIn = form.querySelector("[name=imgfile]");
  form.querySelector("[data-upload-img]").onclick = () => imgIn.click();
  imgIn.onchange = async () => {
    const file = imgIn.files[0]; imgIn.value = "";
    if (!file) return;
    const btn = form.querySelector("[data-upload-img]"); btn.disabled = true; btn.textContent = t("up.uploading");
    try { form.image.value = await uploadImage(file, { keepOriginal: true, maxSide: 2560 }); toast(t("up.done")); refresh(); }
    catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; btn.textContent = `⬆ ${t("up.upload")}`; }
  };

  // Upload a font right from the editor: it's saved, added to the list, selected, and the preview uses it.
  const fileIn = form.querySelector("[name=fontfile]");
  form.querySelector("[data-upload-font]").onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    const file = fileIn.files[0]; fileIn.value = "";
    if (!file) return;
    if (file.size > 1024 * 1024) { toast(t("ad.fontTooBig"), true); return; }
    const name = prompt(t("ad.fontName"), file.name.replace(/\.(woff2?|ttf|otf)$/i, "").replace(/[-_]+/g, " ").replace(/\b(regular|normal|400)\b/gi, "").trim());
    if (!name) return;
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
    try {
      const { font } = await api("/api/fonts", { method: "POST", body: { name, data } });
      registerFont(font);
      form.font.innerHTML = fontOptions(font.id);
      toast(t("ad.fontUploaded", { name: font.name }));
      refresh();
    } catch (e) { toast(e.message, true); }
  };
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
    const body = { name: d.name, name_es: d.name_es, price: d.price || null, reward_level: d.reward_level === "" ? null : d.reward_level,
      sort_order: d.sort_order, active: d.active, visual: visual(), collection_id: d.collection_id || null };
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

/* ---------------- Activity (site visits) ---------------- */

async function activityTab(days = 7) {
  tabEl.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const d = await api(`/api/activity?days=${days}`);
  const tot = d.totals || {};

  // UTC hour buckets → local days and local hour-of-day
  const dayMap = new Map(), hourViews = new Array(24).fill(0);
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(); dt.setHours(0, 0, 0, 0); dt.setDate(dt.getDate() - i);
    dayMap.set(dt.toDateString(), { label: dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), views: 0 });
  }
  for (const r of d.hours) {
    const dt = new Date(r.h * 3600000);
    const k = dt.toDateString();
    if (dayMap.has(k)) dayMap.get(k).views += r.views;
    hourViews[dt.getHours()] += r.views;
  }
  const dayRows = [...dayMap.values()];
  const maxDay = Math.max(1, ...dayRows.map((x) => x.views));
  const maxHour = Math.max(1, ...hourViews);
  const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });
  const who = (r) => r.username ? `<b>${esc(r.username)}</b>` : `<span class="muted">${t("act.anon")} #${esc(r.visitor.slice(2, 6))}</span>`;
  const flag = (c) => c && c.length === 2 ? String.fromCodePoint(...[...c.toUpperCase()].map((x) => 127397 + x.charCodeAt(0))) : "";

  tabEl.innerHTML = `
    <div class="section-head"><h2 style="white-space:nowrap">${t("act.title")}</h2>
      <select id="act-days" style="width:auto">${[1, 7, 30, 90].map((n) => `<option value="${n}" ${n === days ? "selected" : ""}>${t("act.lastDays", { n })}</option>`).join("")}</select></div>
    <p class="hint">${t("act.hint")}</p>
    <div class="act-stats">
      <div class="card"><b>${tot.views || 0}</b><span>${t("act.views")}</span></div>
      <div class="card"><b>${tot.visitors || 0}</b><span>${t("act.visitors")}</span></div>
      <div class="card"><b>${tot.members || 0}</b><span>${t("act.members")}</span></div>
    </div>

    <h3>${t("act.perDay")}</h3>
    <div class="card act-bars">${dayRows.map((x) => `
      <div class="act-row"><span>${esc(x.label)}</span><div class="act-bar"><div style="width:${(x.views / maxDay) * 100}%"></div></div><b>${x.views}</b></div>`).join("")}</div>

    <h3>${t("act.perHour")}</h3>
    <div class="card act-hours">${hourViews.map((v, h) => `
      <div class="act-col" title="${esc(hourLabel(h))}: ${v}"><div style="height:${(v / maxHour) * 100}%"></div><span>${h % 3 === 0 ? esc(hourLabel(h)) : ""}</span></div>`).join("")}</div>

    <h3>${t("act.people")}</h3>
    ${d.people.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>${t("act.user")}</th><th>${t("act.views")}</th><th>${t("act.lastSeen")}</th></tr></thead>
      <tbody>${d.people.map((p) => `<tr><td class="primary-cell"><a href="/profile?id=${p.id}">${esc(p.username)}</a>${p.mc_name ? `<div class="hint">${esc(p.mc_name)}</div>` : ""}</td>
        <td>${p.views}</td><td title="${esc(new Date(p.last).toLocaleString())}">${ago(p.last)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted">${t("act.nobody")}</p>`}

    <div class="act-two">
      <div><h3>${t("act.pages")}</h3>
        <div class="card table-wrap"><table><tbody>${d.pages.map((p) => `<tr><td><code>${esc(p.path)}</code></td><td>${p.views}</td><td class="muted">${t("act.nVisitors", { n: p.visitors })}</td></tr>`).join("") || `<tr><td class="muted">—</td></tr>`}</tbody></table></div></div>
      <div><h3>${t("act.refs")}</h3>
        <div class="card table-wrap"><table><tbody>${d.refs.map((r) => `<tr><td>${esc(r.ref)}</td><td>${r.views}</td></tr>`).join("") || `<tr><td class="muted">${t("act.noRefs")}</td></tr>`}</tbody></table></div></div>
    </div>

    <h3>${t("act.recent")}</h3>
    <div class="card table-wrap"><table>
      <thead><tr><th>${t("act.when")}</th><th>${t("act.user")}</th><th>${t("act.page")}</th><th></th></tr></thead>
      <tbody>${d.recent.map((r) => `<tr><td title="${esc(new Date(r.created_at).toLocaleString())}">${esc(new Date(r.created_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }))}</td>
        <td>${who(r)}</td><td><code>${esc(r.path)}</code></td><td>${flag(r.country)} ${r.device === "mobile" ? "📱" : "💻"}</td></tr>`).join("") || `<tr><td class="muted" colspan="4">${t("act.empty")}</td></tr>`}</tbody></table></div>`;
  tabEl.querySelector("#act-days").onchange = (e) => activityTab(+e.target.value).catch((x) => (tabEl.innerHTML = `<p class="muted">${esc(x.message)}</p>`));
}
