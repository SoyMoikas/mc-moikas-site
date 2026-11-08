import { api, esc, can, t, initPage, toast, levelBadge, avatarHTML, nameHTML, localized } from "./common.js";
import { itemName, itemPreview } from "./cosmetics.js";
import { levelInfo } from "./levels.js";

const user = await initPage();
const main = document.getElementById("main");
document.title = `${t("nav.store")} · Moikas`;

const SECTIONS = [
  { type: "frame", key: "st.frames", id: "frames" },
  { type: "hat", key: "st.hats", id: "hats" },
  { type: "color", key: "st.colors", id: "colors" },
  { type: "font", key: "st.fonts", id: "name-styles" },
  { type: "textstyle", key: "st.textstyles", id: "text-styles" },
  { type: "banner", key: "st.banners", id: "banners" },
  { type: "wallpaper", key: "st.wallpapers", id: "wallpapers" },
  { type: "sticker", key: "st.stickers", id: "stickers" },
  { type: "part", key: "st.parts", id: "avatar-parts" },
  { type: "theme", key: "st.themes", id: "themes" },
];
const NEW_MS = 14 * 86400_000;
let data = null, me = null;
const filters = { q: "", status: "all", type: "", collection: "", sort: "featured" };

async function load() {
  try { data = await api("/api/store"); }
  catch (e) { main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}</p>`; return; }
  if (data.user && user) me = { ...user, eq_frame: data.user.equipped.frame, eq_hat: data.user.equipped.hat, eq_color: data.user.equipped.color,
    eq_banner: data.user.equipped.banner, eq_wallpaper: data.user.equipped.wallpaper,
    eq_font: data.user.equipped.font, eq_text: data.user.equipped.textstyle, hat_fit: data.user.hat_fit };
  const hash = location.hash.slice(1);
  if (SECTIONS.some((s) => s.id === hash)) filters.type = SECTIONS.find((s) => s.id === hash).type;
  render();
}

const isNew = (x) => x.created_at && Date.now() - x.created_at < NEW_MS;
const colName = (c) => localized(c.name, c.name_es);
const owned = (item) => !!data.user?.owned.includes(item.id);
const forSale = (item) => item.price !== null && item.price > 0;
// Level unlocks (reward level ≥ 1, not sold) live in their own "Level rewards" section, not on the shelves.
const levelUnlock = (item) => item.reward_level > 0 && !forSale(item);

function matches(item) {
  const u = data.user;
  if (levelUnlock(item)) return false;
  if (filters.type && item.type !== filters.type) return false;
  if (filters.collection && item.collection_id !== filters.collection) return false;
  if (filters.q) {
    const q = filters.q.toLowerCase();
    if (![item.name, item.name_es, item.id].some((s) => (s || "").toLowerCase().includes(q))) return false;
  }
  switch (filters.status) {
    case "mine": return owned(item);
    case "afford": return !owned(item) && forSale(item) && u && u.coins >= item.price;
    case "new": return isNew(item);
    default: return true;
  }
}

function sorted(items) {
  const by = {
    featured: (a, b) => (a.sort_order - b.sort_order) || ((a.price ?? 1e9) - (b.price ?? 1e9)),
    price_asc: (a, b) => (a.price ?? 1e9) - (b.price ?? 1e9),
    price_desc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
    newest: (a, b) => (b.created_at || 0) - (a.created_at || 0),
  }[filters.sort];
  return [...items].sort(by);
}

function card(item) {
  const u = data.user;
  const own = owned(item);
  const slot = !["sticker", "part"].includes(item.type) ? item.type : null;
  const equipped = slot && u?.equipped[slot] === item.id;
  const sale = forSale(item);
  const reward = item.reward_level !== null;
  const col = item.collection_id && data.collections.find((c) => c.id === item.collection_id);

  let action = "";
  if (!user) action = "";
  else if (equipped && item.type === "hat" && !item.visual?.halo) action = `<a class="btn primary" href="/profile#avatar">🎯 ${t("st.adjustFit")}</a> <button data-unequip="${slot}">${t("st.unequip")}</button>`;
  else if (equipped) action = `<button data-unequip="${slot}">${t("st.unequip")}</button>`;
  else if (own && slot) action = `<button class="primary" data-equip="${item.id}" data-slot="${slot}">${t("st.equip")}</button>`;
  else if (own && item.type === "part") action = `<a class="btn" href="/profile#avatar">✓ ${t("st.useInAvatar")}</a>`;
  else if (own) action = `<span class="small muted">✓ ${t("st.owned")}</span>`;
  else if (sale && !can(user, "member")) action = `<span class="small muted">${t("st.membersOnly")}</span>`;
  else if (sale) action = `<button class="primary" data-buy="${item.id}" ${u.coins < item.price ? "disabled" : ""}>${t("st.buy")}</button>`;
  else if (reward) action = `<span class="small muted">🔒 ${t("st.unlockAt", { n: item.reward_level })}</span>`;
  else if (col) action = `<span class="small muted">📦 ${t("st.inBundleOnly")}</span>`;

  const tags = [
    sale ? `<span class="price">🪙 ${item.price.toLocaleString()}</span>` : "",
    reward ? `<span class="reward-tag">🎁 ${item.reward_level === 0 ? t("st.free") : t("st.rewardLevel", { n: item.reward_level })}</span>` : "",
    !item.active ? `<span class="draft">${t("q.inactive")}</span>` : "",
  ].join("");

  return `
    <div class="card store-item ${equipped ? "equipped" : ""} ${!own && !sale && reward ? "locked" : ""}">
      ${isNew(item) ? `<span class="new-tag">${t("st.new")}</span>` : ""}
      ${col ? `<span class="col-tag" style="--cc:${esc(col.color || "#8a93a8")}" title="${esc(colName(col))}">${esc(col.icon || "📦")}</span>` : ""}
      <div class="si-preview">${itemPreview(item, me)}</div>
      <div class="si-name">${esc(itemName(item))}</div>
      <div class="si-meta">${tags}</div>
      <div class="si-action">${action}</div>
    </div>`;
}

function countdown(ms) {
  const d = Math.floor(ms / 86400_000), h = Math.floor((ms % 86400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? t("st.leftDH", { d, h }) : t("st.leftHM", { h, m });
}

function bundleCard(c) {
  const its = c.item_ids.map((id) => data.items.find((i) => i.id === id)).filter(Boolean);
  const u = data.user;
  const all = its.length && c.owned_count === its.length;
  const timeLeft = c.ends_at ? c.ends_at - Date.now() : null;
  let action = "";
  if (!c.price) action = `<span class="small muted">${t("st.bundleItemsOnly")}</span>`;
  else if (!user) action = `<span class="price">🪙 ${c.price.toLocaleString()}</span>`;
  else if (all) action = `<span class="small muted">✓ ${t("st.bundleOwned")}</span>`;
  else if (!can(user, "member")) action = `<span class="small muted">${t("st.membersOnly")}</span>`;
  else action = `
    ${c.your_price < c.price ? `<s class="small muted">🪙 ${c.price.toLocaleString()}</s>` : ""}
    <button class="primary" data-bundle="${esc(c.id)}" ${u.coins < c.your_price ? "disabled" : ""}>${t("st.buyBundle", { price: c.your_price.toLocaleString() })}</button>`;
  const value = its.reduce((s, i) => s + (i.price || 0), 0);
  return `
    <article class="card bundle" style="--cc:${esc(c.color || "#8a93a8")}">
      <div class="bundle-head">
        <span class="bundle-icon">${esc(c.icon || "📦")}</span>
        <div class="bundle-title">
          <h3>${esc(colName(c))} ${isNew(c) ? `<span class="new-tag inline">${t("st.new")}</span>` : ""}${c.open === false ? ` <span class="draft">${t("st.notLive")}</span>` : ""}</h3>
          <p class="small muted">${esc(localized(c.description, c.description_es) || "")}</p>
        </div>
      </div>
      <div class="bundle-items">${its.map((i) => `<span class="bundle-item ${owned(i) ? "have" : ""}" title="${esc(itemName(i))}">${itemPreview(i, me, 36)}</span>`).join("")}</div>
      <div class="bundle-foot">
        <span class="small muted">${t("st.bundleCount", { n: its.length })}${user ? ` · ${t("st.bundleHave", { n: c.owned_count, total: its.length })}` : ""}
          ${c.price && value > c.price ? ` · <b class="save">${t("st.bundleSave", { n: Math.round((1 - c.price / value) * 100) })}</b>` : ""}
          ${timeLeft !== null && timeLeft > 0 ? ` · <b class="time-left">⏳ ${countdown(timeLeft)}</b>` : ""}</span>
        <span class="bundle-action">${action}</span>
      </div>
      <button class="link" data-show-col="${esc(c.id)}">${t("st.seeItems")}</button>
    </article>`;
}

function render() {
  const u = data.user;
  const l = u ? levelInfo(u.xp) : null;
  const cols = data.collections;
  main.innerHTML = `
    <section>
      ${u ? `
        <div class="card store-head" style="--rank:${l.color}">
          ${avatarHTML(me, 56)}
          <div class="sh-main">
            <div>${nameHTML(me)} ${levelBadge(u.xp)}</div>
            <div class="coins">🪙 ${u.coins.toLocaleString()} <span class="small muted">${t("st.coins")}</span></div>
            <div class="hint">${t("st.howCoins", { n: u.next_level_coins, level: u.level + 1 })}</div>
          </div>
        </div>`
        : `<div class="notice">${t("st.loginNotice", { href: "/auth/login?next=/store" })}</div>`}
    </section>
    ${cols.length ? `
      <section id="collections">
        <div class="section-head"><h2>${t("st.collections")}</h2></div>
        <div class="bundle-grid">${cols.map(bundleCard).join("")}</div>
      </section>` : ""}
    <form class="store-filters card" role="search">
      <input type="search" name="q" placeholder="${esc(t("st.search"))}" value="${esc(filters.q)}">
      <div class="chips">${["all", "mine", "afford", "new"].map((s) => `<button data-status="${s}" class="${filters.status === s ? "active" : ""}">${t(`st.f.${s}`)}</button>`).join("")}
        <a class="chip-link" href="#rewards">🎁 ${t("st.rewards")}</a></div>
      <select name="type"><option value="">${t("st.allTypes")}</option>${SECTIONS.map((s) => `<option value="${s.type}" ${filters.type === s.type ? "selected" : ""}>${t(s.key)}</option>`).join("")}</select>
      ${cols.length ? `<select name="collection"><option value="">${t("st.allCollections")}</option>${cols.map((c) => `<option value="${esc(c.id)}" ${filters.collection === c.id ? "selected" : ""}>${esc(c.icon || "📦")} ${esc(colName(c))}</option>`).join("")}</select>` : ""}
      <select name="sort">${["featured", "price_asc", "price_desc", "newest"].map((s) => `<option value="${s}" ${filters.sort === s ? "selected" : ""}>${t(`st.sort.${s}`)}</option>`).join("")}</select>
    </form>
    <div id="results"></div>
    <section id="rewards">
      <div class="section-head"><h2>${t("st.rewards")}</h2></div>
      ${rewardTrack()}
    </section>`;
  renderResults();
  wire();
}

function renderResults() {
  const box = main.querySelector("#results");
  const visible = data.items.filter(matches);
  const filtered = filters.q || filters.status !== "all" || filters.collection;
  const sections = SECTIONS.filter((s) => !filters.type || s.type === filters.type).map((s) => {
    const items = sorted(visible.filter((i) => i.type === s.type));
    if (!items.length && filtered) return "";
    return `
      <section id="${s.id}">
        <div class="section-head"><h2>${t(s.key)} <span class="muted small">${items.length}</span></h2></div>
        ${s.type === "sticker" ? `<p class="hint">${t("st.stickerHint")}</p>` : ""}
        ${s.type === "banner" ? `<p class="hint">${t("st.bannerHint")}</p>` : ""}
        ${s.type === "wallpaper" ? `<p class="hint">${t("st.wallpaperHint")}</p>` : ""}
        ${s.type === "font" ? `<p class="hint">${t("st.fontHint")}</p>` : ""}
        ${s.type === "textstyle" ? `<p class="hint">${t("st.textHint")}</p>` : ""}
        ${s.type === "part" ? `<p class="hint">${t("st.partsHint")}</p>` : ""}
        ${s.type === "theme" ? `<p class="hint">${t("st.themesHint")}</p>` : ""}
        <div class="store-grid">${items.map(card).join("") || `<p class="muted">—</p>`}</div>
      </section>`;
  }).join("");
  box.innerHTML = sections || `<p class="muted" style="padding:20px 0">${t("st.noMatch")} <button class="link" data-clear>${t("st.clearFilters")}</button></p>`;
}

// Level rewards: unlocked automatically when you reach the level (owned → equip right here). Every level also pays coins.
function rewardTrack() {
  const s = data.settings;
  const unlocks = data.items.filter((i) => levelUnlock(i) && i.active);
  const levels = [...new Set(unlocks.map((i) => i.reward_level))].sort((a, b) => a - b);
  const cur = data.user?.level ?? -1;
  return `
    <p class="hint">${t("st.rewardsHint")} ${t("st.levelCoins", { base: s.coins_base, per: s.coins_per_level, l1: s.coins_base + s.coins_per_level, l10: s.coins_base + s.coins_per_level * 10 })}</p>
    <div class="reward-levels">${levels.map((lv) => `
      <div class="reward-level ${cur >= lv ? "got" : ""}">
        <div class="rl-head"><span class="rt-lvl">${cur >= lv ? "✓ " : "🔒 "}${t("lvl.short")} ${lv}</span>
          <span class="rt-coins small muted">+🪙 ${(s.coins_base + s.coins_per_level * lv).toLocaleString()}</span></div>
        <div class="store-grid">${sorted(unlocks.filter((i) => i.reward_level === lv)).map(card).join("")}</div>
      </div>`).join("") || `<p class="muted">—</p>`}</div>`;
}

// Purchase confirmation panel (instead of the browser's confirm()): big preview, price, coins before → after.
// Resolves true when you press Buy; Cancel, Esc or clicking outside resolves false.
function confirmPurchase({ item, bundle }) {
  return new Promise((resolve) => {
    const coins = data.user?.coins ?? 0;
    const price = item ? item.price : bundle.your_price;
    const its = bundle ? bundle.item_ids.map((id) => data.items.find((i) => i.id === id)).filter(Boolean) : [];
    const dlg = document.createElement("div");
    dlg.className = "buy-modal";
    dlg.innerHTML = `
      <div class="card buy-card" role="dialog" aria-modal="true" aria-label="${esc(t("st.confirmTitle"))}" style="${bundle ? `--cc:${esc(bundle.color || "#8a93a8")}` : ""}">
        ${item ? `
          <div class="buy-preview">${itemPreview(item, me, 128)}</div>
          <h3 class="buy-name">${esc(itemName(item))}</h3>
          <p class="small muted buy-type">${esc(t(`ad.type.${item.type}`))}</p>`
        : `
          <h3 class="buy-name">${esc(bundle.icon || "📦")} ${esc(colName(bundle))}</h3>
          <p class="small muted">${esc(localized(bundle.description, bundle.description_es) || "")}</p>
          <div class="buy-bundle">${its.map((i) => `
            <div class="buy-bi ${owned(i) ? "have" : ""}">
              <span class="buy-bi-prev">${itemPreview(i, me, 64)}</span>
              <span class="small">${esc(itemName(i))}</span>
              ${owned(i) ? `<span class="hint">✓ ${t("st.owned")}</span>` : ""}
            </div>`).join("")}</div>`}
        <div class="buy-sum">
          <div class="kv"><span>${t("st.price")}</span><b>${bundle && bundle.your_price < bundle.price ? `<s class="muted small">🪙 ${bundle.price.toLocaleString()}</s> ` : ""}🪙 ${price.toLocaleString()}</b></div>
          <div class="kv"><span>${t("st.yourCoins")}</span><span>🪙 ${coins.toLocaleString()} → <b>🪙 ${(coins - price).toLocaleString()}</b></span></div>
        </div>
        <div class="actions">
          <button type="button" data-no>${t("cancel")}</button>
          <button type="button" class="primary" data-yes ${coins < price ? "disabled" : ""}>${t("st.buyFor", { price: price.toLocaleString() })}</button>
        </div>
      </div>`;
    let closed = false;
    const done = (ok) => { if (closed) return; closed = true; removeEventListener("keydown", onKey); dlg.classList.add("closing"); setTimeout(() => dlg.remove(), 150); resolve(ok); };
    const onKey = (e) => { if (e.key === "Escape") done(false); if (e.key === "Enter" && !dlg.querySelector("[data-yes]").disabled) done(true); };
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-no]")) done(false); else if (e.target.closest("[data-yes]")) done(true); });
    addEventListener("keydown", onKey);
    document.body.appendChild(dlg);
    dlg.querySelector("[data-yes]").focus();
  });
}

function wire() {
  const f = main.querySelector(".store-filters");
  f.onsubmit = (e) => e.preventDefault();
  let timer;
  f.q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { filters.q = f.q.value.trim(); renderResults(); }, 150); });
  f.type.onchange = () => { filters.type = f.type.value; renderResults(); };
  if (f.collection) f.collection.onchange = () => { filters.collection = f.collection.value; renderResults(); };
  f.sort.onchange = () => { filters.sort = f.sort.value; renderResults(); };
  f.querySelectorAll("[data-status]").forEach((b) => b.onclick = () => {
    filters.status = b.dataset.status;
    f.querySelectorAll("[data-status]").forEach((x) => x.classList.toggle("active", x === b));
    renderResults();
  });

  if (main.dataset.wired) return; // the click handler below is added once
  main.dataset.wired = "1";
  main.addEventListener("click", async (e) => {
    const t0 = e.target;
    if (t0.closest("[data-clear]")) {
      Object.assign(filters, { q: "", status: "all", type: "", collection: "" });
      return render();
    }
    if (t0.closest("[data-show-col]")) {
      filters.collection = t0.closest("[data-show-col]").dataset.showCol;
      filters.status = "all"; filters.type = "";
      render();
      return main.querySelector(".store-filters").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    const bundle = t0.closest("[data-bundle]");
    if (bundle) {
      const c = data.collections.find((x) => x.id === bundle.dataset.bundle);
      if (!(await confirmPurchase({ bundle: c }))) return;
      bundle.disabled = true;
      try { const r = await api(`/api/store/collections/${encodeURIComponent(c.id)}/buy`, { method: "POST" }); toast(t("st.boughtBundle", { n: r.items.length })); load(); }
      catch (err) { toast(err.message, true); bundle.disabled = false; }
      return;
    }
    const buy = t0.closest("[data-buy]");
    if (buy) {
      const item = data.items.find((i) => i.id === buy.dataset.buy);
      if (!(await confirmPurchase({ item }))) return;
      buy.disabled = true;
      try {
        await api("/api/store/buy", { method: "POST", body: { item: item.id } });
        toast(t("st.bought", { name: itemName(item) }));
        if (!["sticker", "part"].includes(item.type)) await api("/api/store/equip", { method: "POST", body: { slot: item.type, item: item.id } });
        location.reload();
      } catch (err) { toast(err.message, true); buy.disabled = false; }
      return;
    }
    const eq = t0.closest("[data-equip]");
    if (eq) {
      try { await api("/api/store/equip", { method: "POST", body: { slot: eq.dataset.slot, item: eq.dataset.equip } }); location.reload(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    const un = t0.closest("[data-unequip]");
    if (un) {
      try { await api("/api/store/equip", { method: "POST", body: { slot: un.dataset.unequip, item: null } }); location.reload(); }
      catch (err) { toast(err.message, true); }
    }
  });
}

load();
