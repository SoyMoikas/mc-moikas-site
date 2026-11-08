// Chat box. Polls for new messages every few seconds while the tab is visible.
import { api, esc, rich, can, t, ago, toast, roleLabel, loginHint, levelBadge } from "./common.js";

const POLL_MS = 4000;

export function mountChat(el, channel, user) {
  el.classList.add("chat");

  if (!can(user, "member")) {
    el.innerHTML = `<p class="hint chat-locked">${user ? t("sp.pendingNotice") : loginHint(user)}</p>`;
    return;
  }

  el.innerHTML = `
    <div class="chat-log" aria-live="polite"><p class="muted small chat-empty">${t("loading")}</p></div>
    <form class="chat-form">
      <textarea name="body" rows="1" maxlength="500" placeholder="${esc(t("chat.placeholder"))}" required></textarea>
      <button class="primary">${t("chat.send")}</button>
    </form>`;

  const log = el.querySelector(".chat-log");
  const form = el.querySelector("form");
  const input = form.querySelector("textarea");
  let lastId = 0, firstId = 0, timer = null, busy = false, failures = 0;

  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60;

  function row(m) {
    const staffBadge = m.role === "staff" || m.role === "admin" ? `<span class="role ${esc(m.role)}">${esc(roleLabel(m.role))}</span>` : "";
    return `
      <div class="chat-msg ${m.mine ? "mine" : ""}" data-id="${m.id}">
        <img src="${esc(m.avatar || "https://cdn.discordapp.com/embed/avatars/0.png")}" alt="">
        <div class="chat-main">
          <div class="who"><b>${esc(m.username || t("deletedUser"))}</b>${m.username ? levelBadge(m.xp) : ""}${staffBadge}
            <span class="when" data-ts="${m.created_at}" title="${esc(new Date(m.created_at).toLocaleString())}">${esc(ago(m.created_at))}</span>
            ${m.can_delete ? `<button class="link chat-del" data-del="${m.id}" title="${esc(t("delete"))}">✕</button>` : ""}
          </div>
          <div class="body">${rich(m.body)}</div>
        </div>
      </div>`;
  }

  async function poll(initial = false) {
    if (busy) return;
    busy = true;
    try {
      const q = initial ? "" : `?after=${lastId}&since=${firstId}`;
      const { messages, removed } = await api(`/api/chat/${encodeURIComponent(channel)}${q}`);
      const stick = initial || atBottom();
      if (initial) log.innerHTML = "";
      for (const id of removed || []) log.querySelector(`[data-id="${id}"]`)?.remove();
      if (messages.length) {
        log.querySelector(".chat-empty")?.remove();
        log.insertAdjacentHTML("beforeend", messages.map(row).join(""));
        lastId = messages[messages.length - 1].id;
        if (!firstId) firstId = messages[0].id;
      }
      if (!log.querySelector(".chat-msg")) log.innerHTML = `<p class="muted small chat-empty">${t("chat.empty")}</p>`;
      if (stick) log.scrollTop = log.scrollHeight;
      failures = 0;
    } catch (e) {
      failures++;
      if (initial) log.innerHTML = `<p class="muted small">${esc(e.message)}</p>`;
    } finally {
      busy = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) return; // paused while the tab is in the background
    timer = setTimeout(async () => { await poll(); schedule(); }, POLL_MS * Math.min(1 + failures, 5));
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { poll().then(schedule); } else clearTimeout(timer);
  });

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      await api(`/api/chat/${encodeURIComponent(channel)}`, { method: "POST", body: { body: text } });
      input.value = "";
      autosize();
      await poll();
      log.scrollTop = log.scrollHeight;
    } catch (e) { toast(e.message, true); }
    finally { input.disabled = false; input.focus(); }
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); send(); });
  // Enter sends, Shift+Enter makes a new line.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  const autosize = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; };
  input.addEventListener("input", autosize);

  log.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del]");
    if (!b || !confirm(t("chat.confirmDelete"))) return;
    try { await api(`/api/chat-messages/${b.dataset.del}`, { method: "DELETE" }); b.closest(".chat-msg").remove(); }
    catch (err) { toast(err.message, true); }
  });

  // Refresh "x min ago" labels once a minute.
  setInterval(() => {
    log.querySelectorAll(".chat-msg .when").forEach((w) => (w.textContent = ago(Number(w.dataset.ts))));
  }, 60_000);

  poll(true).then(schedule);
}
