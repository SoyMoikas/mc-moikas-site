import { api, esc, can, t, initPage, toast, levelBadge, avatarHTML, nameHTML } from "./common.js";
import { stickerHTML, itemName, HATS } from "./cosmetics.js";
import { levelInfo } from "./levels.js";

const user = await initPage();
const main = document.getElementById("main");
document.title = `${t("nav.store")} · Moikas MC`;

const SECTIONS = [
  { type: "frame", key: "st.frames", id: "frames" },
  { type: "hat", key: "st.hats", id: "hats" },
  { type: "color", key: "st.colors", id: "colors" },
  { type: "sticker", key: "st.stickers", id: "stickers" },
];
let data = null;
let me = null; // local copy of the user for live previews

async function load() {
  try { data = await api("/api/store"); }
  catch (e) { main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}</p>`; return; }
  if (data.user && user) me = { ...user, eq_frame: data.user.equipped.frame, eq_hat: data.user.equipped.hat, eq_color: data.user.equipped.color };
  render();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}

function preview(item) {
  const base = me || { username: t("st.you"), avatar: null };
  if (item.type === "frame") return avatarHTML({ ...base, eq_frame: item.id, eq_hat: null }, 56);
  if (item.type === "hat") return avatarHTML({ ...base, eq_frame: null, eq_hat: item.id }, 56);
  if (item.type === "color") return `<span class="color-preview">${nameHTML({ ...base, eq_color: item.id })}</span>`;
  return stickerHTML(item.id);
}

function card(item) {
  const u = data.user;
  const owned = u?.owned.includes(item.id);
  const slot = item.type !== "sticker" ? item.type : null;
  const equipped = slot && u?.equipped[slot] === item.id;
  const locked = u ? u.level < item.level : item.level > 0;
  let action = "";
  if (!user) action = "";
  else if (equipped) action = `<button data-unequip="${slot}">${t("st.unequip")}</button>`;
  else if (owned && slot) action = `<button class="primary" data-equip="${item.id}" data-slot="${slot}">${t("st.equip")}</button>`;
  else if (owned) action = `<span class="small muted">✓ ${t("st.owned")}</span>`;
  else if (locked) action = `<span class="small muted">🔒 ${t("st.needLevel", { n: item.level })}</span>`;
  else if (!can(user, "member")) action = `<span class="small muted">${t("st.membersOnly")}</span>`;
  else action = `<button class="primary" data-buy="${item.id}" ${u.coins < item.price ? "disabled" : ""}>${t("st.buy")}</button>`;

  return `
    <div class="card store-item ${equipped ? "equipped" : ""} ${locked && !owned ? "locked" : ""}">
      <div class="si-preview">${preview(item)}</div>
      <div class="si-name">${esc(itemName(item.id))}</div>
      <div class="si-meta">
        <span class="price">${item.price ? `🪙 ${item.price.toLocaleString()}` : t("st.free")}</span>
        ${item.level ? `<span class="lvl" style="--rank:var(--muted)">${t("lvl.short")} ${item.level}+</span>` : ""}
      </div>
      <div class="si-action">${action}</div>
    </div>`;
}

function render() {
  const u = data.user;
  const l = u ? levelInfo(u.xp) : null;
  main.innerHTML = `
    <section>
      <div class="section-head"><h2>${t("nav.store")}</h2></div>
      ${u ? `
        <div class="card store-head" style="--rank:${l.color}">
          ${avatarHTML(me, 64)}
          <div class="sh-main">
            <div>${nameHTML(me)} ${levelBadge(u.xp)}</div>
            <div class="coins">🪙 ${u.coins.toLocaleString()} <span class="small muted">${t("st.coins")}</span></div>
            <div class="hint">${t("st.howCoins")}</div>
          </div>
        </div>`
        : `<div class="notice">${t("st.loginNotice", { href: "/auth/login?next=/store" })}</div>`}
      <nav class="store-nav">${SECTIONS.map((s) => `<a href="#${s.id}">${t(s.key)}</a>`).join("")}</nav>
    </section>
    ${SECTIONS.map((s) => `
      <section id="${s.id}">
        <div class="section-head"><h2>${t(s.key)}</h2></div>
        ${s.type === "sticker" ? `<p class="hint">${t("st.stickerHint")}</p>` : ""}
        <div class="store-grid">${data.items.filter((i) => i.type === s.type).map(card).join("")}</div>
      </section>`).join("")}`;
  wire();
}

function wire() {
  main.querySelectorAll("[data-buy]").forEach((b) => b.onclick = async () => {
    const item = data.items.find((i) => i.id === b.dataset.buy);
    if (!confirm(t("st.confirmBuy", { name: itemName(item.id), price: item.price }))) return;
    b.disabled = true;
    try {
      await api("/api/store/buy", { method: "POST", body: { item: item.id } });
      toast(t("st.bought", { name: itemName(item.id) }));
      // Equip cosmetics right away; stickers just become available.
      if (item.type !== "sticker") await api("/api/store/equip", { method: "POST", body: { slot: item.type, item: item.id } });
      location.reload();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  });
  main.querySelectorAll("[data-equip]").forEach((b) => b.onclick = async () => {
    try { await api("/api/store/equip", { method: "POST", body: { slot: b.dataset.slot, item: b.dataset.equip } }); location.reload(); }
    catch (e) { toast(e.message, true); }
  });
  main.querySelectorAll("[data-unequip]").forEach((b) => b.onclick = async () => {
    try { await api("/api/store/equip", { method: "POST", body: { slot: b.dataset.unequip, item: null } }); location.reload(); }
    catch (e) { toast(e.message, true); }
  });
}

load();
