import { api, esc, rich, can, t, initPage, onSubmit, toast, ago, localized, levelBadge } from "./common.js";

const user = await initPage();
const main = document.getElementById("main");
document.title = `${t("nav.quests")} · Moikas MC`;
let data = null, servers = [], reviews = [];

async function load() {
  try {
    [data, { servers }] = await Promise.all([api("/api/quests"), api("/api/servers")]);
    reviews = can(user, "staff") ? (await api("/api/quest-reviews")).reviews : [];
  } catch (e) { main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}</p>`; return; }
  render();
}

function render() {
  const staff = can(user, "staff");
  main.innerHTML = `
    <section>
      <div class="section-head">
        <h2>${t("q.title")}</h2>
        ${staff ? `<button id="new-quest">${t("q.new")}</button>` : ""}
      </div>
      <p class="hint">${t("q.explain")}</p>
      ${!user ? `<div class="notice">${t("q.loginNotice", { href: `/auth/login?next=/quests` })}</div>`
        : !data.linked ? `<div class="notice warn">${t("q.linkNotice")}</div>` : ""}
      <div id="quest-form"></div>
      ${staff && reviews.length ? `
        <div class="card reviews">
          <h3 style="margin:0 0 10px">${t("q.reviews", { n: reviews.length })}</h3>
          ${reviews.map(reviewRow).join("")}
        </div>` : ""}
      <div class="quest-grid">${data.quests.map(questCard).join("") || `<p class="muted">${t("q.none")}</p>`}</div>
    </section>`;
  wire();
}

function questCard(q) {
  const title = localized(q.title, q.title_es);
  const desc = localized(q.description, q.description_es);
  let status = "";
  if (q.my_status === "approved") status = `<div class="q-status done">✓ ${t("q.done")}</div>`;
  else if (q.my_status === "pending") status = `<div class="q-status pending">⏳ ${t("q.pending")}</div>`;
  else if (q.progress && q.criteria_type === "stat") {
    const pct = Math.min(100, Math.round((q.progress.value / q.progress.target) * 100));
    status = `<div class="q-progress"><div class="bar"><div style="width:${pct}%"></div></div>
      <span class="small muted">${q.progress.value.toLocaleString()} / ${q.progress.target.toLocaleString()}</span></div>`;
  }
  if (q.my_status === "rejected") status += `<div class="q-status rejected">✕ ${t("q.rejected")}${q.my_note ? `: ${esc(q.my_note)}` : ""}</div>`;

  const canSubmit = q.kind === "manual" && q.active && can(user, "member") && !["approved", "pending"].includes(q.my_status);
  return `
    <article class="card quest ${q.active ? "" : "inactive"} ${q.my_status === "approved" ? "is-done" : ""}" data-quest="${q.id}">
      <div class="q-head">
        <span class="q-xp">+${q.xp.toLocaleString()} XP</span>
        <span class="pill">${q.kind === "auto" ? t("q.auto") : t("q.manual")}</span>
        ${q.server_id ? `<a class="small" href="/server?id=${encodeURIComponent(q.server_id)}">${esc(q.server_name)}</a>` : `<span class="small muted">${t("q.anyServer")}</span>`}
        ${q.active ? "" : `<span class="draft">${t("q.inactive")}</span>`}
      </div>
      <h3>${esc(title)}</h3>
      ${desc ? `<div class="body small">${rich(desc)}</div>` : ""}
      ${status}
      <div class="q-foot">
        <span class="hint">${t("q.completedBy", { n: q.completions })}</span>
        ${canSubmit ? `<button class="primary" data-submit="${q.id}">${t("q.submit")}</button>` : ""}
      </div>
      <div class="q-submit"></div>
      ${can(user, "staff") ? `<div class="actions" style="margin-top:6px">
        <button class="link" data-edit="${q.id}">${t("edit")}</button>
        <button class="link" data-toggle="${q.id}">${q.active ? t("q.deactivate") : t("q.activate")}</button>
        <button class="link" data-delete="${q.id}">${t("delete")}</button>
        ${q.kind === "auto" ? `<code class="small muted">${esc(q.criteria_key)}${q.criteria_target ? ` ≥ ${q.criteria_target}` : ""}</code>` : ""}
      </div>` : ""}
    </article>`;
}

function reviewRow(r) {
  return `
    <div class="review" data-review="${r.id}">
      <img src="${esc(r.avatar)}" alt="">
      <div class="main">
        <div><b>${esc(r.username)}</b>${r.mc_name ? ` <span class="muted small">(${esc(r.mc_name)})</span>` : ""}
          · ${esc(localized(r.title, r.title_es))} <span class="q-xp">+${r.xp} XP</span>
          <span class="muted small">${esc(ago(r.created_at))}</span></div>
        ${r.proof ? `<div class="body small">${rich(r.proof)}</div>` : `<div class="muted small">${t("q.noProof")}</div>`}
      </div>
      <div class="actions">
        <button class="primary" data-approve="${r.id}">${t("q.approve")}</button>
        <button class="danger" data-reject="${r.id}">${t("q.reject")}</button>
      </div>
    </div>`;
}

function questForm(q = {}) {
  const auto = q.kind === "auto";
  return `
    <form class="stack card">
      <h3 style="margin:0">${q.id ? t("q.editTitle") : t("q.newTitle")}</h3>
      <div class="row">
        <label>${t("q.fTitle")}<input name="title" required maxlength="120" value="${esc(q.title)}"></label>
        <label>${t("q.fTitleEs")}<input name="title_es" maxlength="120" value="${esc(q.title_es)}"></label>
      </div>
      <div class="row">
        <label>${t("q.fDesc")}<textarea name="description" maxlength="1000">${esc(q.description)}</textarea></label>
        <label>${t("q.fDescEs")}<textarea name="description_es" maxlength="1000">${esc(q.description_es)}</textarea></label>
      </div>
      <div class="row">
        <label>XP<input name="xp" type="number" min="1" required value="${esc(q.xp ?? 100)}"></label>
        <label>${t("q.fKind")}<select name="kind">
          <option value="manual" ${auto ? "" : "selected"}>${t("q.manualLong")}</option>
          <option value="auto" ${auto ? "selected" : ""}>${t("q.autoLong")}</option></select></label>
        <label>${t("q.fServer")}<select name="server_id"><option value="">${t("q.anyServer")}</option>
          ${servers.map((s) => `<option value="${esc(s.id)}" ${q.server_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      </div>
      <div class="auto-fields ${auto ? "" : "hidden"}">
        <div class="row">
          <label>${t("q.fCheck")}<select name="criteria_type">
            <option value="advancement" ${q.criteria_type === "stat" ? "" : "selected"}>${t("q.advancement")}</option>
            <option value="stat" ${q.criteria_type === "stat" ? "selected" : ""}>${t("q.stat")}</option></select></label>
          <label>${t("q.fKey")}<input name="criteria_key" value="${esc(q.criteria_key)}" placeholder="minecraft:story/mine_diamond"></label>
          <label class="target-field">${t("q.fTarget")}<input name="criteria_target" type="number" min="1" value="${esc(q.criteria_target ?? "")}" placeholder="1000"></label>
        </div>
        <p class="hint">${t("q.keyHelp")}</p>
      </div>
      <div class="row">
        <label>${t("ad.sortOrder")}<input name="sort_order" type="number" value="${esc(q.sort_order ?? 0)}"></label>
        <label class="check"><input type="checkbox" name="active" ${q.active === 0 ? "" : "checked"}> ${t("q.fActive")}</label>
      </div>
      <div class="actions"><span style="flex:1"></span>
        <button type="button" data-cancel>${t("cancel")}</button>
        <button class="primary">${q.id ? t("save") : t("ad.create")}</button></div>
    </form>`;
}

function openForm(q = {}) {
  const holder = main.querySelector("#quest-form");
  holder.innerHTML = questForm(q);
  holder.scrollIntoView({ behavior: "smooth", block: "start" });
  const form = holder.querySelector("form");
  const sync = () => {
    form.querySelector(".auto-fields").classList.toggle("hidden", form.kind.value !== "auto");
    form.querySelector(".target-field").classList.toggle("hidden", form.criteria_type.value !== "stat");
  };
  form.kind.onchange = sync; form.criteria_type.onchange = sync; sync();
  form.querySelector("[data-cancel]").onclick = () => (holder.innerHTML = "");
  onSubmit(form, async (d) => {
    if (q.id) await api(`/api/quests/${q.id}`, { method: "PATCH", body: d });
    else await api("/api/quests", { method: "POST", body: d });
    toast(t("saved")); load();
  });
}

function wire() {
  main.querySelector("#new-quest")?.addEventListener("click", () => openForm({}));
  const find = (id) => data.quests.find((q) => String(q.id) === String(id));

  main.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openForm(find(b.dataset.edit)));
  main.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = async () => {
    const q = find(b.dataset.toggle);
    try { await api(`/api/quests/${q.id}`, { method: "PATCH", body: { active: !q.active } }); load(); }
    catch (e) { toast(e.message, true); }
  });
  main.querySelectorAll("[data-delete]").forEach((b) => b.onclick = async () => {
    if (!confirm(t("q.confirmDelete"))) return;
    try { await api(`/api/quests/${b.dataset.delete}`, { method: "DELETE" }); toast(t("ad.deleted")); load(); }
    catch (e) { toast(e.message, true); }
  });
  main.querySelectorAll("[data-submit]").forEach((b) => b.onclick = () => {
    const box = b.closest(".quest").querySelector(".q-submit");
    box.innerHTML = `
      <form class="stack" style="margin-top:10px">
        <label>${t("q.proof")}<textarea name="proof" maxlength="1000" placeholder="${esc(t("q.proofPh"))}"></textarea></label>
        <div class="actions"><span style="flex:1"></span><button type="button" data-cancel>${t("cancel")}</button>
          <button class="primary">${t("q.send")}</button></div>
      </form>`;
    const f = box.querySelector("form");
    f.querySelector("[data-cancel]").onclick = () => (box.innerHTML = "");
    onSubmit(f, async (d) => { await api(`/api/quests/${b.dataset.submit}/submit`, { method: "POST", body: d }); toast(t("q.submitted")); load(); });
  });
  const review = async (id, approve) => {
    const note = approve ? null : prompt(t("q.rejectNote"));
    if (!approve && note === null) return;
    try { await api(`/api/quest-reviews/${id}`, { method: "POST", body: { approve, note } }); toast(approve ? t("q.approved") : t("q.rejectedToast")); load(); }
    catch (e) { toast(e.message, true); }
  };
  main.querySelectorAll("[data-approve]").forEach((b) => b.onclick = () => review(b.dataset.approve, true));
  main.querySelectorAll("[data-reject]").forEach((b) => b.onclick = () => review(b.dataset.reject, false));
}

load();
