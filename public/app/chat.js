// Chat box. Polls for new messages every couple of seconds while you're active (slower when idle,
// paused when the tab is hidden). Each poll also carries the page's "pulse" for feed/announcements.
import { api, esc, rich, can, t, ago, toast, roleLabel, loginHint, levelBadge, avatarHTML, nameHTML, emitPulse } from "./common.js";
import { STICKER_RE, catalogItem, stickerHTML, stickerCode } from "./cosmetics.js";

const POLL_MS = 2500;       // while you're using the page
const IDLE_POLL_MS = 8000;  // after 2 minutes without touching anything
const IDLE_AFTER = 120_000;
let lastInput = Date.now();
for (const ev of ["pointermove", "pointerdown", "keydown", "scroll", "touchstart", "wheel"])
  addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });

export function mountChat(el, channel, user) {
  el.classList.add("chat");

  if (!can(user, "member")) {
    el.innerHTML = `<p class="hint chat-locked">${user ? t("sp.pendingNotice") : loginHint(user)}</p>`;
    return;
  }

  el.innerHTML = `
    <div class="chat-log" aria-live="polite"><p class="muted small chat-empty">${t("loading")}</p></div>
    <button type="button" class="chat-new hidden">${esc(t("chat.newMessages"))}</button>
    <div class="sticker-picker hidden"></div>
    <form class="chat-form">
      <button type="button" class="sticker-btn" title="${esc(t("chat.stickers"))}">🙂</button>
      <textarea name="body" rows="1" maxlength="500" placeholder="${esc(t("chat.placeholder"))}" required></textarea>
      <button class="primary">${t("chat.send")}</button>
    </form>`;

  const log = el.querySelector(".chat-log");
  const form = el.querySelector("form");
  const input = form.querySelector("textarea");
  const pill = el.querySelector(".chat-new");
  let lastId = 0, firstId = 0, timer = null, busy = false, failures = 0;
  // "pinned" = the reader is at the bottom and wants to follow new messages.
  let pinned = true;

  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  const toBottom = () => { log.scrollTop = log.scrollHeight; pinned = true; pill.classList.add("hidden"); };
  log.addEventListener("scroll", () => { pinned = atBottom(); if (pinned) pill.classList.add("hidden"); }, { passive: true });
  // Avatars and image stickers load after we scroll; keep following the bottom while they grow the log.
  log.addEventListener("load", () => { if (pinned) log.scrollTop = log.scrollHeight; }, true);
  pill.onclick = toBottom;

  function row(m) {
    const staffBadge = m.role === "staff" || m.role === "admin" ? `<span class="role ${esc(m.role)}">${esc(roleLabel(m.role))}</span>` : "";
    return `
      <div class="chat-msg ${m.mine ? "mine" : ""}" data-id="${m.id}">
        ${avatarHTML(m, 30)}
        <div class="chat-main">
          <div class="who">${nameHTML(m, t("deletedUser"))}${m.username ? levelBadge(m.xp) : ""}${staffBadge}
            <span class="when" data-ts="${m.created_at}" title="${esc(new Date(m.created_at).toLocaleString())}">${esc(ago(m.created_at))}</span>
            ${m.can_delete ? `<button class="link chat-del" data-del="${m.id}" title="${esc(t("delete"))}">✕</button>` : ""}
          </div>
          ${(() => { const st = m.body.match(STICKER_RE); return st && catalogItem(st[1]) ? `<div class="body">${stickerHTML(st[1])}</div>` : `<div class="body">${rich(m.body)}</div>`; })()}
        </div>
      </div>`;
  }

  // A chat that was removed from the page (e.g. the game page re-rendered) stops polling.
  let wasConnected = false;
  const gone = () => { if (el.isConnected) wasConnected = true; return wasConnected && !el.isConnected; };

  async function poll(initial = false) {
    if (busy || gone()) return;
    busy = true;
    try {
      const q = initial ? "" : `?after=${lastId}&since=${firstId}`;
      const { messages, removed, pulse } = await api(`/api/chat/${encodeURIComponent(channel)}${q}`);
      emitPulse(pulse);
      const stick = initial || pinned;
      if (initial) log.innerHTML = "";
      for (const id of removed || []) log.querySelector(`[data-id="${id}"]`)?.remove();
      if (messages.length) {
        log.querySelector(".chat-empty")?.remove();
        log.insertAdjacentHTML("beforeend", messages.map(row).join(""));
        lastId = messages[messages.length - 1].id;
        if (!firstId) firstId = messages[0].id;
      }
      if (!log.querySelector(".chat-msg")) log.innerHTML = `<p class="muted small chat-empty">${t("chat.empty")}</p>`;
      if (stick) toBottom();
      else if (messages.length && messages.some((m) => !m.mine)) pill.classList.remove("hidden");
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
    if (document.hidden || gone()) return; // paused while the tab is in the background
    const base = Date.now() - lastInput > IDLE_AFTER ? IDLE_POLL_MS : POLL_MS;
    timer = setTimeout(async () => { await poll(); schedule(); }, base * Math.min(1 + failures, 5));
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { poll().then(schedule); } else clearTimeout(timer);
  });
  window.addEventListener("focus", () => poll());

  // Sticker picker: shows the stickers you own (free ones included).
  const picker = el.querySelector(".sticker-picker");
  el.querySelector(".sticker-btn").onclick = async () => {
    if (!picker.classList.contains("hidden")) { picker.classList.add("hidden"); return; }
    picker.classList.remove("hidden");
    picker.innerHTML = `<p class="muted small">${t("loading")}</p>`;
    try {
      const { user: me } = await api("/api/store");
      const mine = (me?.owned || []).filter((id) => catalogItem(id)?.type === "sticker");
      picker.innerHTML = mine.map((id) => `<button type="button" class="sticker-pick" data-st="${id}">${stickerHTML(id, { small: true })}</button>`).join("")
        + `<a class="small" href="/store#stickers">${t("chat.moreStickers")}</a>`;
    } catch (e) { picker.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
  };
  picker.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-st]");
    if (!b) return;
    picker.classList.add("hidden");
    try { await api(`/api/chat/${encodeURIComponent(channel)}`, { method: "POST", body: { body: stickerCode(b.dataset.st) } }); await poll(); toBottom(); }
    catch (err) { toast(err.message, true); }
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
      toBottom();
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
