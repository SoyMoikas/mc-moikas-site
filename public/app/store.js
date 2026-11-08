import { api, esc, can, t, initPage, toast, levelBadge, avatarHTML, nameHTML } from "./common.js";
import { itemName, itemPreview } from "./cosmetics.js";
import { levelInfo } from "./levels.js";

const user = await initPage();
const main = document.getElementById("main");
document.title = `${t("nav.store")} · Moikas`;

const SECTIONS = [
  { type: "frame", key: "st.frames", id: "frames" },
  { type: "hat", key: "st.hats", id: "hats" },
  { type: "color", key: "st.colors", id: "colors" },
  { type: "sticker", key: "st.stickers", id: "stickers" },
];
let data = null, me = null;

async function load() {
  try { data = await api("/api/store"); }
  catch (e) { main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}</p>`; return; }
  if (data.user && user) me = { ...user, eq_frame: data.user.equipped.frame, eq_hat: data.user.equipped.hat, eq_color: data.user.equipped.color };
  render();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}

function card(item) {
  const u = data.user;
  const owned = u?.owned.includes(item.id);
  const slot = item.type !== "sticker" ? item.type : null;
  const equipped = slot && u?.equipped[slot] === item.id;
  const sale = item.price !== null && item.price > 0;
  const reward = item.reward_level !== null;
  const lockedBuy = sale && u && u.level < item.level;

  let action = "";
  if (!user) action = "";
  else if (equipped) action = `<button data-unequip="${slot}">${t("st.unequip")}</button>`;
  else if (owned && slot) action = `<button class="primary" data-equip="${item.id}" data-slot="${slot}">${t("st.equip")}</button>`;
  else if (owned) action = `<span class="small muted">✓ ${t("st.owned")}</span>`;
  else if (sale && lockedBuy) action = `<span class="small muted">🔒 ${t("st.needLevel", { n: item.level })}</span>`;
  else if (sale && !can(user, "member")) action = `<span class="small muted">${t("st.membersOnly")}</span>`;
  else if (sale) action = `<button class="primary" data-buy="${item.id}" ${u.coins < item.price ? "disabled" : ""}>${t("st.buy")}</button>`;
  else if (reward) action = `<span class="small muted">🔒 ${t("st.unlockAt", { n: item.reward_level })}</span>`;

  const tags = [
    sale ? `<span class="price">🪙 ${item.price.toLocaleString()}</span>` : "",
    sale && item.level ? `<span class="lvl" style="--rank:var(--muted)">${t("lvl.short")} ${item.level}+</span>` : "",
    reward ? `<span class="reward-tag">🎁 ${item.reward_level === 0 ? t("st.free") : t("st.rewardLevel", { n: item.reward_level })}</span>` : "",
    !item.active ? `<span class="draft">${t("q.inactive")}</span>` : "",
  ].join("");

  return `
    <div class="card store-item ${equipped ? "equipped" : ""} ${!owned && (lockedBuy || (!sale && reward)) ? "locked" : ""}">
      <div class="si-preview">${itemPreview(item, me)}</div>
      <div class="si-name">${esc(itemName(item))}</div>
      <div class="si-meta">${tags}</div>
      <div class="si-action">${action}</div>
    </div>`;
}

function rewardTrack() {
  const s = data.settings;
  const levels = [...new Set(data.items.filter((i) => i.reward_level > 0 && i.active).map((i) => i.reward_level))].sort((a, b) => a - b);
  const cur = data.user?.level ?? -1;
  return `
    <div class="card reward-track">
      <p class="hint" style="margin-top:0">${t("st.levelCoins", { base: s.coins_base, per: s.coins_per_level, l1: s.coins_base + s.coins_per_level, l10: s.coins_base + s.coins_per_level * 10 })}</p>
      ${levels.map((lv) => {
        const items = data.items.filter((i) => i.reward_level === lv && i.active);
        return `<div class="rt-row ${cur >= lv ? "got" : ""}">
          <span class="rt-lvl">${t("lvl.short")} ${lv}</span>
          <span class="rt-items">${items.map((i) => `<span class="rt-item" title="${esc(itemName(i))}">${itemPreview(i, me, 30)}<span class="small">${esc(itemName(i))}</span></span>`).join("")}</span>
          <span class="rt-coins">+🪙 ${(s.coins_base + s.coins_per_level * lv).toLocaleString()}</span>
        </div>`;
      }).join("")}
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
            <div class="hint">${t("st.howCoins", { n: u.next_level_coins, level: u.level + 1 })}</div>
          </div>
        </div>`
        : `<div class="notice">${t("st.loginNotice", { href: "/auth/login?next=/store" })}</div>`}
      <nav class="store-nav">
        <a href="#rewards">🎁 ${t("st.rewards")}</a>
        ${SECTIONS.map((s) => `<a href="#${s.id}">${t(s.key)}</a>`).join("")}
      </nav>
    </section>
    <section id="rewards">
      <div class="section-head"><h2>${t("st.rewards")}</h2></div>
      ${rewardTrack()}
    </section>
    ${SECTIONS.map((s) => {
      const items = data.items.filter((i) => i.type === s.type);
      return `
      <section id="${s.id}">
        <div class="section-head"><h2>${t(s.key)}</h2></div>
        ${s.type === "sticker" ? `<p class="hint">${t("st.stickerHint")}</p>` : ""}
        <div class="store-grid">${items.map(card).join("") || `<p class="muted">—</p>`}</div>
      </section>`;
    }).join("")}`;
  wire();
}

function wire() {
  main.querySelectorAll("[data-buy]").forEach((b) => b.onclick = async () => {
    const item = data.items.find((i) => i.id === b.dataset.buy);
    if (!confirm(t("st.confirmBuy", { name: itemName(item), price: item.price }))) return;
    b.disabled = true;
    try {
      await api("/api/store/buy", { method: "POST", body: { item: item.id } });
      toast(t("st.bought", { name: itemName(item) }));
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
