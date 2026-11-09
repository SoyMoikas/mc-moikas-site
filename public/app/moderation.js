// Whitelist & bans panel on a server page (staff with the "moderation" permission).
// Actions are queued on the site; the NAS script runs them in the server console within ~2 minutes.
import { api, esc, t, toast, ago } from "./common.js";

const ED = { java: "☕ Java", bedrock: "📱 Bedrock" };
const ACTION_LABEL = (a) => t(`mod.a.${a}`);

export function mountModeration(el, serverId) {
  let data = null;
  let timer = null;
  const url = `/api/servers/${encodeURIComponent(serverId)}/moderation`;

  async function load() {
    try { data = await api(url); } catch (e) { el.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    render();
    clearTimeout(timer);
    // refresh faster while something is waiting for the NAS
    timer = setTimeout(() => el.isConnected && load(), data.pending?.length ? 15000 : 60000);
  }

  function row(e, kind) {
    const isWl = kind === "wl";
    return `<li class="mod-row">
      <span><strong>${esc(e.name)}</strong> <span class="pill">${ED[e.edition]}</span>
        ${!isWl && e.reason ? `<span class="muted small"> — ${esc(e.reason)}</span>` : ""}</span>
      <button class="small-btn" data-act="${isWl ? "whitelist_remove" : "unban"}" data-name="${esc(e.name)}" data-ed="${e.edition}">
        ${isWl ? t("mod.remove") : t("mod.unban")}</button>
    </li>`;
  }

  function render() {
    if (!data.linked) { el.innerHTML = `<p class="muted">${t("mod.notLinked")}</p>`; return; }
    const wlState = data.whitelist_on == null ? "" :
      `<span class="pill ${data.whitelist_on ? "done" : "in_progress"}">${data.whitelist_on ? t("mod.wlOn") : t("mod.wlOff")}</span>
       <button class="small-btn" data-act="${data.whitelist_on ? "whitelist_off" : "whitelist_on"}">${data.whitelist_on ? t("mod.turnOff") : t("mod.turnOn")}</button>`;
    el.innerHTML = `
      <div class="card">
        <div class="section-head" style="margin:0 0 10px"><div>${t("mod.whitelist")} ${wlState}</div>
          <span class="hint">${data.synced_at ? esc(t("mod.synced", { ago: ago(data.synced_at) })) : t("mod.neverSynced")}</span></div>
        <form id="mod-form" class="mod-form" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          <input name="name" required maxlength="16" placeholder="${esc(t("mod.namePh"))}" style="flex:1 1 160px">
          <select name="edition"><option value="java">${ED.java}</option><option value="bedrock">${ED.bedrock}</option></select>
          <input name="reason" maxlength="100" placeholder="${esc(t("mod.reasonPh"))}" style="flex:2 1 200px">
          <button class="primary" data-submit="whitelist_add">${t("mod.addWl")}</button>
          <button class="danger" data-submit="ban">${t("mod.ban")}</button>
        </form>
        <p class="hint" style="margin:6px 0 0">${t("mod.hint")}</p>
        ${data.pending.length ? `<div class="notice" style="margin-top:10px">⏳ ${t("mod.pending")}<ul class="mod-list">
          ${data.pending.map((p) => `<li class="mod-row"><span>${ACTION_LABEL(p.action)} ${p.name ? `<strong>${esc(p.name)}</strong> <span class="pill">${ED[p.edition]}</span>` : ""}
            <span class="muted small">· ${esc(p.by_name || "")} · ${esc(ago(p.created_at))}</span></span>
            <button class="small-btn" data-cancel="${p.id}">${t("cancel")}</button></li>`).join("")}</ul></div>` : ""}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:14px">
          <div><h3 style="margin:0 0 6px">✅ ${t("mod.listWl")} <span class="muted small">(${data.whitelist.length})</span></h3>
            <ul class="mod-list">${data.whitelist.length ? data.whitelist.map((e) => row(e, "wl")).join("") : `<li class="muted">${t("mod.empty")}</li>`}</ul></div>
          <div><h3 style="margin:0 0 6px">⛔ ${t("mod.listBans")} <span class="muted small">(${data.bans.length})</span></h3>
            <ul class="mod-list">${data.bans.length ? data.bans.map((e) => row(e, "ban")).join("") : `<li class="muted">${t("mod.empty")}</li>`}</ul></div>
        </div>
        ${data.recent.length ? `<details style="margin-top:12px"><summary class="small muted">${t("mod.history")}</summary><ul class="mod-list">
          ${data.recent.map((p) => `<li class="small">${ACTION_LABEL(p.action)} ${p.name ? `<strong>${esc(p.name)}</strong>` : ""} <span class="muted">· ${esc(p.by_name || "")} · ${esc(ago(p.done_at))}</span></li>`).join("")}</ul></details>` : ""}
      </div>`;
    wire();
  }

  async function queue(body) {
    try {
      await api(url, { method: "POST", body });
      toast(t("mod.queued"));
      load();
    } catch (e) { toast(e.message, true); }
  }

  function wire() {
    const form = el.querySelector("#mod-form");
    form.querySelectorAll("[data-submit]").forEach((b) => b.onclick = (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      if (!d.name.trim()) return form.name.focus();
      const action = b.dataset.submit;
      if (action === "ban" && !confirm(t("mod.confirmBan", { name: d.name }))) return;
      queue({ action, name: d.name.trim(), edition: d.edition, reason: d.reason });
    });
    el.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => {
      const action = b.dataset.act;
      if ((action === "whitelist_remove" || action === "whitelist_off") && !confirm(t("mod.confirm"))) return;
      queue({ action, name: b.dataset.name, edition: b.dataset.ed });
    });
    el.querySelectorAll("[data-cancel]").forEach((b) => b.onclick = async () => {
      await api(`${url}?action=${b.dataset.cancel}`, { method: "DELETE" });
      load();
    });
  }

  el.innerHTML = `<p class="muted">${t("loading")}</p>`;
  load();
}
