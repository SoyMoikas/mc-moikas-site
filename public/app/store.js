import { api, esc, can, t, initPage, toast, levelBadge, avatarHTML, nameHTML, localized } from "./common.js";
import { itemName, itemPreview, catalogItem, parseBuild, bgStyle, textAttrs, stickerHTML, applyTabFx } from "./cosmetics.js";
import { applyTheme } from "./themes.js";
import { levelInfo } from "./levels.js";

const user = await initPage();
const main = document.getElementById("main");
document.title = `${t("nav.store")} · Moikas`;

// Item types, in shelf order, grouped into the 5 chips at the top.
const SECTIONS = [
  { type: "frame", key: "st.frames", id: "frames", group: "avatar", hint: "" },
  { type: "hat", key: "st.hats", id: "hats", group: "avatar", hint: "" },
  { type: "part", key: "st.parts", id: "avatar-parts", group: "avatar", hint: "st.partsHint" },
  { type: "color", key: "st.colors", id: "colors", group: "name", hint: "" },
  { type: "font", key: "st.fonts", id: "name-styles", group: "name", hint: "st.fontHint" },
  { type: "textstyle", key: "st.textstyles", id: "text-styles", group: "name", hint: "st.textHint" },
  { type: "banner", key: "st.banners", id: "banners", group: "profile", hint: "st.bannerHint" },
  { type: "wallpaper", key: "st.wallpapers", id: "wallpapers", group: "profile", hint: "st.wallpaperHint" },
  { type: "theme", key: "st.themes", id: "themes", group: "site", hint: "st.themesHint" },
  { type: "tabfx", key: "st.tabfx", id: "tab-effects", group: "site", hint: "" },
  { type: "sticker", key: "st.stickers", id: "stickers", group: "chat", hint: "st.stickerHint" },
];
const GROUPS = [["avatar", "🧑"], ["name", "✏️"], ["profile", "🖼️"], ["site", "🎨"], ["chat", "💬"]];
const SLOT_TYPES = ["frame", "hat", "color", "font", "textstyle", "banner", "wallpaper", "theme", "tabfx"]; // equippable one-per-slot
const NEW_MS = 14 * 86400_000, ALMOST = 100;
let data = null, me = null;
const filters = { q: "", status: "all", group: "", collection: "", sort: "featured" };
// Probador: what you're trying on. type → item, or null = "take off what I'm wearing". Missing = what you have equipped.
const trying = {};

async function load() {
  try { data = await api("/api/store"); }
  catch (e) { main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}</p>`; return; }
  if (data.user && user) me = { ...user, eq_frame: data.user.equipped.frame, eq_hat: data.user.equipped.hat, eq_color: data.user.equipped.color,
    eq_banner: data.user.equipped.banner, eq_wallpaper: data.user.equipped.wallpaper, eq_font: data.user.equipped.font,
    eq_text: data.user.equipped.textstyle, eq_theme: data.user.equipped.theme, eq_tabfx: data.user.equipped.tabfx, hat_fit: data.user.hat_fit };
  data.deals ||= {};
  const sec = SECTIONS.find((s) => s.id === location.hash.slice(1));
  if (sec) filters.group = sec.group;
  render();
  if (sec) requestAnimationFrame(() => document.getElementById(sec.id)?.scrollIntoView({ block: "start" }));
}

const isNew = (x) => x.created_at && Date.now() - x.created_at < NEW_MS;
const colName = (c) => localized(c.name, c.name_es);
const owned = (item) => !!data.user?.owned.includes(item.id);
const forSale = (item) => item.price !== null && item.price > 0;
const priceOf = (item) => data.deals[item.id] ?? item.price;
const coins = () => data.user?.coins ?? 0;
// Level unlocks (reward level ≥ 1, not sold) live in their own "Level rewards" section, not on the shelves.
const levelUnlock = (item) => item.reward_level > 0 && !forSale(item);
const sectionOf = (type) => SECTIONS.find((s) => s.type === type);
const equippedId = (type) => data.user?.equipped[type === "textstyle" ? "textstyle" : type] || null;
const rarity = (item) => !forSale(item) ? "" : item.price >= 1000 ? "legendary" : item.price >= 400 ? "epic" : item.price >= 150 ? "rare" : "common";
const browsing = () => !filters.q && filters.status === "all" && !filters.group && !filters.collection;

function matches(item) {
  const u = data.user;
  if (levelUnlock(item)) return false;
  if (filters.group && sectionOf(item.type)?.group !== filters.group) return false;
  if (filters.collection && item.collection_id !== filters.collection) return false;
  if (filters.q) {
    const q = filters.q.toLowerCase();
    if (![item.name, item.name_es, item.id].some((s) => (s || "").toLowerCase().includes(q))) return false;
  }
  switch (filters.status) {
    case "mine": return owned(item);
    case "afford": return !owned(item) && forSale(item) && u && coins() >= priceOf(item);
    case "new": return isNew(item);
    case "deals": return item.id in data.deals;
    default: return true;
  }
}

function sorted(items) {
  const by = {
    featured: (a, b) => (a.sort_order - b.sort_order) || ((a.price ?? 1e9) - (b.price ?? 1e9)),
    price_asc: (a, b) => (priceOf(a) ?? 1e9) - (priceOf(b) ?? 1e9),
    price_desc: (a, b) => (priceOf(b) ?? -1) - (priceOf(a) ?? -1),
    newest: (a, b) => (b.created_at || 0) - (a.created_at || 0),
  }[filters.sort];
  // in "All", things you already own sink to the end of each shelf (equipped ones stay put)
  const sink = (i) => filters.status === "all" && owned(i) && equippedId(i.type) !== i.id ? 1 : 0;
  return [...items].sort((a, b) => sink(a) - sink(b) || by(a, b));
}

function card(item) {
  const u = data.user;
  const own = owned(item);
  const slot = SLOT_TYPES.includes(item.type) ? item.type : null;
  const equipped = slot && equippedId(slot) === item.id;
  const sale = forSale(item);
  const deal = item.id in data.deals && !own;
  const price = priceOf(item);
  const reward = item.reward_level !== null;
  const col = item.collection_id && data.collections.find((c) => c.id === item.collection_id);
  const tried = trying[item.type] === item || (trying[item.type]?.id === item.id);

  let action = "";
  if (!user) action = sale ? `<span class="price">🪙 ${price.toLocaleString()}</span>` : "";
  else if (equipped) action = `<span class="si-on">✓ ${t("st.wearing")}</span>`;
  else if (own && slot) action = `<button class="ghost" data-equip="${item.id}" data-slot="${slot}">${t("st.equip")}</button>`;
  else if (own && item.type === "part") action = `<a class="btn ghost" href="/profile#avatar">${t("st.useInAvatar")}</a>`;
  else if (own) action = `<span class="si-on muted">✓ ${t("st.owned")}</span>`;
  else if (sale && !can(user, "member")) action = `<span class="small muted">${t("st.membersOnly")}</span>`;
  else if (sale && u.coins < price) action = `<button class="si-need" disabled>${t("st.need", { n: (price - u.coins).toLocaleString() })}</button>`;
  else if (sale) action = `<button class="primary si-buy" data-buy="${item.id}">🪙 ${price.toLocaleString()}</button>`;
  else if (reward) action = `<span class="si-lock">🔒 ${item.reward_level === 0 ? t("st.free") : t("st.lockedLvl", { n: item.reward_level })}</span>`;
  else if (col) action = `<span class="small muted">📦 ${t("st.inBundleOnly")}</span>`;

  const meta = [
    deal ? `<span class="si-deal">-${data.deal_off}% <s>🪙 ${item.price.toLocaleString()}</s></span>` : "",
    sale && reward && !own ? `<span class="reward-tag">🎁 ${t("st.rewardLevel", { n: item.reward_level })}</span>` : "",
    !item.active ? `<span class="draft">${t("q.inactive")}</span>` : "",
  ].join("");
  const r = rarity(item);
  return `
    <div class="card store-item ${r ? `rar-${r}` : ""} ${equipped ? "equipped" : ""} ${own && !equipped && filters.status === "all" ? "is-owned" : ""} ${tried ? "trying" : ""} ${!own && !sale && reward ? "locked" : ""}"
      data-try="${esc(item.id)}" title="${esc(t("st.clickToTry"))}">
      ${isNew(item) ? `<span class="new-tag">${t("st.new")}</span>` : ""}
      ${deal ? `<span class="deal-tag">🔥</span>` : col ? `<span class="col-tag" style="--cc:${esc(col.color || "#8a93a8")}" title="${esc(colName(col))}">${esc(col.icon || "📦")}</span>` : ""}
      <div class="si-preview">${itemPreview(item, me)}</div>
      <div class="si-name">${esc(itemName(item))}</div>
      ${r ? `<div class="si-rar">${t(`st.rar.${r}`)}</div>` : ""}
      <div class="si-meta">${meta}</div>
      <div class="si-action">${action}</div>
    </div>`;
}

function countdown(ms) {
  const d = Math.floor(ms / 86400_000), h = Math.floor((ms % 86400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? t("st.leftDH", { d, h }) : t("st.leftHM", { h, m });
}


// Collections: one slim row you can scroll sideways.
function bundleCard(c) {
  const its = c.item_ids.map((id) => data.items.find((i) => i.id === id)).filter(Boolean);
  const all = its.length && c.owned_count === its.length;
  const timeLeft = c.ends_at ? c.ends_at - Date.now() : null;
  const value = its.reduce((s, i) => s + (i.price || 0), 0);
  let action = "";
  if (!c.price) action = "";
  else if (!user) action = `<span class="price">🪙 ${c.price.toLocaleString()}</span>`;
  else if (all) action = `<span class="si-on">✓ ${t("st.bundleOwned")}</span>`;
  else if (!can(user, "member")) action = "";
  else if (coins() < c.your_price) action = `<button class="si-need" disabled>${t("st.need", { n: (c.your_price - coins()).toLocaleString() })}</button>`;
  else action = `<button class="primary" data-bundle="${esc(c.id)}">🪙 ${c.your_price.toLocaleString()}</button>`;
  return `
    <article class="card bundle slim" style="--cc:${esc(c.color || "#8a93a8")}">
      <div class="bundle-head"><span class="bundle-icon">${esc(c.icon || "📦")}</span>
        <div class="bundle-title"><b>${esc(colName(c))}</b> ${isNew(c) ? `<span class="new-tag inline">${t("st.new")}</span>` : ""}${c.open === false ? ` <span class="draft">${t("st.notLive")}</span>` : ""}
          <div class="small muted">${user ? t("st.bundleHave", { n: c.owned_count, total: its.length }) : t("st.bundleCount", { n: its.length })}
            ${c.price && value > c.price ? ` · <b class="save">${t("st.bundleSave", { n: Math.round((1 - c.price / value) * 100) })}</b>` : ""}
            ${timeLeft !== null && timeLeft > 0 ? ` · <b class="time-left">⏳ ${countdown(timeLeft)}</b>` : ""}</div></div></div>
      <div class="bundle-items">${its.slice(0, 6).map((i) => `<span class="bundle-item ${owned(i) ? "have" : ""}" title="${esc(itemName(i))}">${itemPreview(i, me, 30)}</span>`).join("")}${its.length > 6 ? `<span class="small muted">+${its.length - 6}</span>` : ""}</div>
      <div class="bundle-foot"><button class="link" data-show-col="${esc(c.id)}">${t("st.seeItems")}</button><span class="bundle-action">${action}</span></div>
    </article>`;
}

// ---------- Probador (try-on panel) ----------
const wearing = (type) => (type in trying ? trying[type] : catalogItem(equippedId(type)));
const starterBuild = () => ({ use: true, parts: { shape: "part_shape_round", eyes: "part_eyes_dots", mouth: "part_mouth_smile" } });
function tryList() { return Object.entries(trying).filter(([, it]) => it); }
function tryCost() { return tryList().map(([, it]) => it).filter((it) => !owned(it) && forSale(it)).reduce((n, it) => n + priceOf(it), 0); }
function tryChanged() { return Object.entries(trying).some(([type, it]) => type === "part" || type === "sticker" ? !!it : (it?.id || null) !== equippedId(type)); }

function tryOnHTML() {
  const base = me || { username: t("st.you"), avatar: null };
  const part = trying.part;
  let build;
  if (part) { const b = parseBuild(base.avatar_build); build = b?.parts?.shape ? { ...b, use: true, parts: { ...b.parts } } : starterBuild(); build.parts[part.visual?.slot || "shape"] = part; }
  const hatTried = "hat" in trying;
  const av = avatarHTML(base, 84, { frame: wearing("frame"), hat: wearing("hat"), ...(hatTried ? {} : { fit: base.hat_fit }), ...(build ? { build } : {}) });
  const banner = wearing("banner"), wall = wearing("wallpaper"), ts = textAttrs(null, wearing("textstyle"));
  const list = tryList();
  const cost = tryCost();
  const changed = tryChanged();
  const slotChanges = Object.keys(trying).filter((k) => SLOT_TYPES.includes(k));
  return `
    <div class="to-head"><b>🪞 ${t("st.tryOn")}</b>${list.length || slotChanges.length ? `<button class="link" data-try-reset>${t("st.tryReset")}</button>` : ""}
      <button class="to-toggle" data-to-toggle aria-label="${esc(t("st.tryOn"))}">▴</button></div>
    <div class="to-stage ${wall ? "has-art" : ""}" style="${wall ? bgStyle(wall) : ""}">
      <div class="to-card ${banner ? "has-art" : ""}" style="${banner ? bgStyle(banner) : ""}">
        ${av}
        <div class="to-name">${nameHTML(base, "", wearing("color") ?? null, wearing("font") ?? null)}</div>
        <div class="to-text"><span class="body${ts.cls}" style="${ts.style}">${esc(t("st.textSample"))}</span></div>
        ${trying.sticker ? `<div class="to-chat">${stickerHTML(trying.sticker)}</div>` : ""}
      </div>
    </div>
    ${trying.theme !== undefined || trying.tabfx !== undefined ? `<p class="hint">✨ ${t("st.tryOnPage")}</p>` : ""}
    <div class="to-list">${list.length ? list.map(([type, it]) => `
      <div class="to-row"><span class="to-prev">${itemPreview(it, me, 28)}</span><span class="to-nm">${esc(itemName(it))}<span class="small muted">${owned(it) ? ` · ✓ ${t("st.owned")}` : forSale(it) ? ` · 🪙 ${priceOf(it).toLocaleString()}` : ""}</span></span>
        <button class="link" data-untry="${type}" title="${esc(t("st.tryRemove"))}">✕</button></div>`).join("")
      : `<p class="hint">${t("st.tryHint")}</p>`}</div>
    ${user && can(user, "member") && changed ? `
      <button class="primary to-go" data-try-apply ${cost > coins() ? "disabled" : ""}>${cost ? t("st.tryBuyWear", { n: cost.toLocaleString() }) : t("st.tryWear")}</button>
      ${cost > coins() ? `<div class="hint">${t("st.need", { n: (cost - coins()).toLocaleString() })}</div>` : ""}` : ""}`;
}
function drawTryOn() {
  const el = main.querySelector("#tryon");
  if (!el) return;
  const open = el.classList.contains("open");
  el.innerHTML = tryOnHTML();
  el.classList.toggle("open", open);
  el.classList.toggle("busy", tryList().length > 0);
  // themes and tab effects are tried on the whole page
  if ("theme" in trying) applyTheme(trying.theme, false); else applyTheme(catalogItem(equippedId("theme")), false);
  if ("tabfx" in trying) applyTabFx(trying.tabfx); else applyTabFx(catalogItem(equippedId("tabfx")));
  main.querySelectorAll("[data-try]").forEach((c) => c.classList.toggle("trying", trying[data.items.find((i) => i.id === c.dataset.try)?.type]?.id === c.dataset.try));
}
function toggleTry(item) {
  if (trying[item.type]?.id === item.id) delete trying[item.type];
  else trying[item.type] = item;
  drawTryOn();
}

// ---------- page ----------
function chipsHTML() {
  const shelf = data.items.filter((i) => !levelUnlock(i));
  const count = (g) => shelf.filter((i) => sectionOf(i.type)?.group === g).length;
  const col = filters.collection && data.collections.find((c) => c.id === filters.collection);
  return `
    <div class="st-groups">
      <button data-group="" class="${!filters.group ? "active" : ""}">✨ ${t("st.g.all")}</button>
      ${GROUPS.map(([g, ic]) => `<button data-group="${g}" class="${filters.group === g ? "active" : ""}">${ic} ${t(`st.g.${g}`)} <span class="muted">${count(g)}</span></button>`).join("")}
    </div>
    <div class="st-bar">
      <input type="search" name="q" placeholder="${esc(t("st.search"))}" value="${esc(filters.q)}">
      <div class="chips">${["all", "mine", "afford", "new", ...(Object.keys(data.deals).length ? ["deals"] : [])].map((s) => `<button type="button" data-status="${s}" class="${filters.status === s ? "active" : ""}">${s === "deals" ? "🔥 " : ""}${t(`st.f.${s}`)}</button>`).join("")}</div>
      <label class="st-sort" title="${esc(t("st.sortLabel"))}">⇅<select name="sort">${["featured", "price_asc", "price_desc", "newest"].map((s) => `<option value="${s}" ${filters.sort === s ? "selected" : ""}>${t(`st.sort.${s}`)}</option>`).join("")}</select></label>
      <a class="chip-link" href="#rewards">🎁 ${t("st.rewards")}</a>
    </div>
    ${col ? `<div class="st-pill">📦 ${t("st.colFilter", { name: esc(colName(col)) })} <button class="link" data-col-clear>✕</button></div>` : ""}`;
}

function rowHTML(key, items, status) {
  if (!items.length) return "";
  return `<section class="st-rowsec">
    <div class="section-head"><h2>${t(`st.rows.${key}`)} <span class="muted small">${items.length}</span></h2>${status ? `<button class="link" data-see="${status}">${t("st.seeAllRow")}</button>` : ""}</div>
    ${key === "deals" ? `<p class="hint">${t("st.dealsReset", { n: data.deal_off })}</p>` : ""}
    <div class="st-row">${items.slice(0, 12).map(card).join("")}</div></section>`;
}

function landingHTML() {
  const shelf = data.items.filter((i) => !levelUnlock(i) && i.active);
  const u = data.user;
  const deals = shelf.filter((i) => i.id in data.deals);
  const fresh = shelf.filter(isNew).sort((a, b) => b.created_at - a.created_at);
  const afford = u ? shelf.filter((i) => !owned(i) && forSale(i) && priceOf(i) <= u.coins).sort((a, b) => priceOf(b) - priceOf(a)) : [];
  const almost = u ? shelf.filter((i) => !owned(i) && forSale(i) && priceOf(i) > u.coins && priceOf(i) - u.coins <= ALMOST).sort((a, b) => priceOf(a) - priceOf(b)) : [];
  const tiles = GROUPS.map(([g, ic]) => {
    const its = shelf.filter((i) => sectionOf(i.type)?.group === g);
    return `<button class="card st-tile" data-group="${g}"><span class="st-tile-art">${its.slice(0, 3).map((i) => `<span>${itemPreview(i, me, 34)}</span>`).join("")}</span>
      <b>${ic} ${t(`st.g.${g}`)}</b><span class="small muted">${t(`st.gd.${g}`)} · ${its.length}</span></button>`;
  }).join("");
  return rowHTML("deals", deals, "deals") + rowHTML("new", fresh, "new") + rowHTML("afford", afford, "afford") + rowHTML("almost", almost, "") +
    `<section><div class="section-head"><h2>${t("st.browse")}</h2></div><div class="st-tiles">${tiles}</div></section>`;
}

function render() {
  const u = data.user;
  const l = u ? levelInfo(u.xp) : null;
  const cols = data.collections;
  main.innerHTML = `
    <section>
      ${u ? `
        <div class="card store-head" style="--rank:${l.color}">
          ${avatarHTML(me, 48)}
          <div class="sh-main">
            <div>${nameHTML(me)} ${levelBadge(u.xp)}</div>
            <div class="hint">${t("st.howCoins", { n: u.next_level_coins, level: u.level + 1 })}</div>
          </div>
          <div class="coins">🪙 ${u.coins.toLocaleString()} <span class="small muted">${t("st.coins")}</span></div>
        </div>`
        : `<div class="notice">${t("st.loginNotice", { href: "/auth/login?next=/store" })}</div>`}
    </section>
    ${u ? `<section id="crate"></section>` : ""}
    ${cols.length ? `
      <section id="collections">
        <div class="section-head"><h2>${t("st.collections")}</h2></div>
        <div class="bundle-row">${cols.map(bundleCard).join("")}</div>
      </section>` : ""}
    <div class="st-layout">
      <div class="st-shop">
        <form class="store-filters card" role="search">${chipsHTML()}</form>
        <div id="results"></div>
        <section id="rewards">
          <div class="section-head"><h2>${t("st.rewards")}</h2></div>
          ${rewardTrack()}
        </section>
      </div>
      <aside class="card tryon" id="tryon"></aside>
    </div>`;
  renderResults();
  drawTryOn();
  wire();
}

function renderResults() {
  const box = main.querySelector("#results");
  if (browsing()) { box.innerHTML = landingHTML(); return; }
  const visible = data.items.filter(matches);
  const sections = SECTIONS.filter((s) => !filters.group || s.group === filters.group).map((s) => {
    const items = sorted(visible.filter((i) => i.type === s.type));
    if (!items.length) return "";
    return `
      <section id="${s.id}">
        <div class="section-head"><h2>${t(s.key)} <span class="muted small">${items.length}</span></h2></div>
        ${s.hint ? `<p class="hint">${t(s.hint)}</p>` : ""}
        <div class="store-grid">${items.map(card).join("")}</div>
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

async function buyItem(item) {
  await api("/api/store/buy", { method: "POST", body: { item: item.id } });
}
const equip = (slot, item) => api("/api/store/equip", { method: "POST", body: { slot, item } });

function wire() {
  const f = main.querySelector(".store-filters");
  f.onsubmit = (e) => e.preventDefault();
  let timer;
  f.q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { filters.q = f.q.value.trim(); renderResults(); }, 150); });
  f.sort.onchange = () => { filters.sort = f.sort.value; renderResults(); };

  if (main.dataset.wired) return; // the click handler below is added once
  main.dataset.wired = "1";
  const refilter = () => { const pos = main.querySelector(".store-filters"); render(); main.querySelector(".store-filters").scrollIntoView({ behavior: pos ? "smooth" : "auto", block: "start" }); };
  main.addEventListener("click", async (e) => {
    const t0 = e.target;
    const q = (s) => t0.closest(s);
    if (q("[data-group]")) { filters.group = q("[data-group]").dataset.group; filters.status = filters.status === "deals" ? "all" : filters.status; return refilter(); }
    if (q("[data-status]")) { filters.status = q("[data-status]").dataset.status; return refilter(); }
    if (q("[data-see]")) { filters.status = q("[data-see]").dataset.see; filters.group = ""; return refilter(); }
    if (q("[data-clear]")) { Object.assign(filters, { q: "", status: "all", group: "", collection: "" }); return render(); }
    if (q("[data-col-clear]")) { filters.collection = ""; return refilter(); }
    if (q("[data-show-col]")) { filters.collection = q("[data-show-col]").dataset.showCol; filters.status = "all"; filters.group = ""; return refilter(); }
    if (q("[data-to-toggle]")) { main.querySelector("#tryon").classList.toggle("open"); return; }
    if (q("[data-try-reset]")) { for (const k of Object.keys(trying)) delete trying[k]; return drawTryOn(); }
    if (q("[data-untry]")) {
      const type = q("[data-untry]").dataset.untry;
      // taking off something you have equipped = "wear nothing there"; otherwise just stop trying it
      if (SLOT_TYPES.includes(type) && equippedId(type) && trying[type]?.id === equippedId(type)) trying[type] = null; else delete trying[type];
      return drawTryOn();
    }
    if (q("[data-try-apply]")) {
      const btn = q("[data-try-apply]");
      const toBuy = tryList().map(([, it]) => it).filter((it) => !owned(it) && forSale(it));
      if (toBuy.length) {
        const total = tryCost();
        const ok = toBuy.length === 1 ? await confirmPurchase({ item: { ...toBuy[0], price: total } })
          : await confirmPurchase({ bundle: { icon: "🪞", name: t("st.tryOn"), name_es: t("st.tryOn"), description: t("st.tryBuyDesc"), description_es: t("st.tryBuyDesc"), item_ids: toBuy.map((i) => i.id), price: total, your_price: total } });
        if (!ok) return;
      }
      btn.disabled = true;
      try {
        for (const it of toBuy) await buyItem(it);
        for (const [type, it] of Object.entries(trying)) if (SLOT_TYPES.includes(type) && (it?.id || null) !== equippedId(type)) await equip(type, it ? it.id : null);
        toast(toBuy.length ? t("st.tryBought", { n: toBuy.length }) : t("st.tryWorn"));
        if (trying.part) toast(t("st.partsHint"));
        location.reload();
      } catch (err) { toast(err.message, true); btn.disabled = false; load(); }
      return;
    }
    const bundle = q("[data-bundle]");
    if (bundle) {
      const c = data.collections.find((x) => x.id === bundle.dataset.bundle);
      if (!(await confirmPurchase({ bundle: c }))) return;
      bundle.disabled = true;
      try { const r = await api(`/api/store/collections/${encodeURIComponent(c.id)}/buy`, { method: "POST" }); toast(t("st.boughtBundle", { n: r.items.length })); load(); }
      catch (err) { toast(err.message, true); bundle.disabled = false; }
      return;
    }
    const buy = q("[data-buy]");
    if (buy) {
      const item = data.items.find((i) => i.id === buy.dataset.buy);
      if (!(await confirmPurchase({ item: { ...item, price: priceOf(item) } }))) return;
      buy.disabled = true;
      try {
        await buyItem(item);
        toast(t("st.bought", { name: itemName(item) }));
        if (SLOT_TYPES.includes(item.type)) await equip(item.type, item.id);
        location.reload();
      } catch (err) { toast(err.message, true); buy.disabled = false; }
      return;
    }
    const eq = q("[data-equip]");
    if (eq) {
      try { await equip(eq.dataset.slot, eq.dataset.equip); location.reload(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    // anywhere else on a card → try it on
    const tc = q("[data-try]");
    if (tc && !q("a, button, select, input")) {
      const item = data.items.find((i) => i.id === tc.dataset.try);
      if (item) { toggleTry(item); if (innerWidth < 1100) main.querySelector("#tryon").classList.add("peek"); }
    }
  });
}

load();


/* ---------------- Mystery crate ---------------- */

const RARITY = { common: ["#9aa3b5", "cr.common"], rare: ["#4fb3e8", "cr.rare"], epic: ["#b48cff", "cr.epic"], legendary: ["#f2b33d", "cr.legendary"] };
async function mountCrate() {
  const el = document.getElementById("crate");
  if (!el || el.dataset.ready) return;
  el.dataset.ready = "1";
  let d;
  try { d = await api("/api/crates"); } catch { el.remove(); return; }
  const total = d.tiers.filter((x) => x.left).reduce((n, x) => n + x.weight, 0) || 1;
  el.innerHTML = `
    <div class="card crate">
      <div class="crate-box" id="crate-box">🎁</div>
      <div class="crate-main">
        <h2>${t("cr.title")}</h2>
        <p class="muted small">${t("cr.desc", { n: d.left })}</p>
        <div class="crate-odds">${d.tiers.map((x) => `<span style="border-color:${RARITY[x.key][0]}"><b style="color:${RARITY[x.key][0]}">${t(RARITY[x.key][1])}</b> ${x.left ? Math.round((x.weight / total) * 100) : 0}% · ${x.left}</span>`).join("")}</div>
        <div class="lfg-row"><button class="primary" id="crate-open" ${d.left ? "" : "disabled"}>${t("cr.open", { n: d.price })}</button><span id="crate-result"></span></div>
      </div>
    </div>`;
  el.querySelector("#crate-open").onclick = async (e) => {
    const btn = e.currentTarget, box = el.querySelector("#crate-box"), out = el.querySelector("#crate-result");
    if (!confirm(t("cr.confirm", { n: d.price }))) return;
    btn.disabled = true; out.innerHTML = ""; box.classList.add("shake");
    let r;
    try { r = await api("/api/crates", { method: "POST" }); }
    catch (x) { toast(x.message, true); btn.disabled = false; box.classList.remove("shake"); return; }
    await new Promise((ok) => setTimeout(ok, 1400));
    box.classList.remove("shake");
    const [col, key] = RARITY[r.rarity];
    box.textContent = r.rarity === "legendary" ? "🌟" : r.rarity === "epic" ? "💜" : r.rarity === "rare" ? "💙" : "✨";
    box.style.borderColor = col;
    out.innerHTML = `<b style="color:${col}">${t(key)}:</b> ${esc(itemName(r.item) || r.item.id)} <span class="small muted">· ${t("cr.equip")}</span>`;
    toast(`${t(key)}: ${itemName(r.item) || r.item.id}`);
    setTimeout(() => load(), 2500);
  };
}
const _render = render;
render = function () { _render(); mountCrate(); };
mountCrate();
