// How store items look. Items come from the database (Admin → Store); this file turns them into HTML.
// visual: frame {color, style: solid|glow|pulse|rainbow|shimmer} · color {color, style: solid|glow|rainbow}
//         hat {emoji | image | halo} · sticker {emoji | text | image}
import { t, lang } from "./i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "#9aa0aa");
const safeUrl = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(u || "") ? u : "");

let CATALOG = {};
export async function loadCatalog() {
  try {
    const r = await fetch("/api/store/catalog");
    if (r.ok) CATALOG = (await r.json()).items || {};
  } catch { /* render without cosmetics */ }
}
export const catalogItem = (id) => (id ? CATALOG[id] : null);

export const itemName = (item) => (item ? (lang === "es" && item.name_es ? item.name_es : item.name) : "");

export const STICKER_RE = /^\[\[sticker:([a-z0-9_]{1,40})\]\]$/;
export const stickerCode = (id) => `[[sticker:${id}]]`;

function frameAttrs(item) {
  if (!item) return { cls: "", style: "" };
  const v = item.visual || {};
  return { cls: ` framed fs-${esc(v.style || "solid")}`, style: `--fc:${safeColor(v.color)};` };
}

function hatHTML(item) {
  if (!item) return "";
  const v = item.visual || {};
  if (v.halo) return `<span class="av-halo"></span>`;
  if (v.image && safeUrl(v.image)) return `<span class="av-hat"><img src="${esc(v.image)}" alt=""></span>`;
  if (v.emoji) return `<span class="av-hat">${esc(v.emoji)}</span>`;
  return "";
}

// Avatar with equipped frame and hat. Pass `over` = {frame, hat} item objects to preview unsaved items.
export function avatarHTML(u, size = 32, over = {}) {
  const img = esc(u?.avatar || "https://cdn.discordapp.com/embed/avatars/0.png");
  const frame = "frame" in over ? over.frame : catalogItem(u?.eq_frame);
  const hat = "hat" in over ? over.hat : catalogItem(u?.eq_hat);
  const f = frameAttrs(frame);
  return `<span class="av${f.cls}" style="--av:${size}px;${f.style}"><img src="${img}" alt="" loading="lazy">${hatHTML(hat)}</span>`;
}

// Username with equipped name color. `over` = color item to preview.
export function nameHTML(u, fallback = "", over) {
  const item = over !== undefined ? over : catalogItem(u?.eq_color);
  const v = item?.visual || {};
  const style = item && v.style !== "rainbow" ? ` style="color:${safeColor(v.color)}"` : "";
  const cls = item ? ` nc-${esc(v.style || "solid")}` : "";
  return `<b class="uname-c${cls}"${style}>${esc(u?.username || fallback)}</b>`;
}

// Sticker by id (from catalog) or from an item object (preview).
export function stickerHTML(idOrItem, { small = false } = {}) {
  const item = typeof idOrItem === "string" ? catalogItem(idOrItem) : idOrItem;
  if (!item) return "";
  const v = item.visual || {};
  const title = esc(itemName(item));
  if (v.image && safeUrl(v.image)) return `<span class="sticker img ${small ? "small" : ""}" title="${title}"><img src="${esc(v.image)}" alt="${title}"></span>`;
  if (v.text) return `<span class="sticker word ${small ? "small" : ""}" title="${title}">${esc(v.text)}</span>`;
  return `<span class="sticker ${small ? "small" : ""}" title="${title}">${esc(v.emoji || "?")}</span>`;
}

// Preview of any item, used by the store and the admin editor.
export function itemPreview(item, user, size = 56) {
  const base = user || { username: t("st.you"), avatar: null };
  if (item.type === "frame") return avatarHTML(base, size, { frame: item, hat: null });
  if (item.type === "hat") return avatarHTML(base, size, { frame: null, hat: item });
  if (item.type === "color") return `<span class="color-preview">${nameHTML(base, "", item)}</span>`;
  if (item.type === "banner") return `<span class="banner-preview has-art ${item.visual?.animate ? "art-anim" : ""}" style="${bgStyle(item)}">${avatarHTML({ ...base, eq_frame: null, eq_hat: null }, 30, { frame: null, hat: null })}<b>${esc(base.username || "")}</b></span>`;
  if (item.type === "wallpaper") return `<span class="wp-preview has-art ${item.visual?.animate ? "art-anim" : ""}" style="${bgStyle(item)}"><i></i><i></i><i></i></span>`;
  return stickerHTML(item);
}

// Banner / wallpaper look → CSS background value. visual: {color, color2, pattern, image, animate}
export function bgCSS(v = {}) {
  const c = safeColor(v.color || "#181c28"), c2 = safeColor(v.color2 || v.color || "#212637");
  if (v.image && safeUrl(v.image)) return `url('${v.image}') center/cover no-repeat, ${c}`;
  switch (v.pattern) {
    case "dots": return `radial-gradient(${c2} 1.2px, transparent 1.8px) 0 0/18px 18px, ${c}`;
    case "grid": return `linear-gradient(${c2} 1px, transparent 1px) 0 0/24px 24px, linear-gradient(90deg, ${c2} 1px, transparent 1px) 0 0/24px 24px, ${c}`;
    case "stripes": return `repeating-linear-gradient(45deg, ${c} 0 14px, ${c2} 14px 28px)`;
    case "blocks": return `conic-gradient(${c2} 25%, ${c} 0 50%, ${c2} 0 75%, ${c} 0) 0 0/32px 32px`;
    default: return `linear-gradient(120deg, ${c}, ${c2}, ${c})`;
  }
}
// Inline style for an element showing a banner/wallpaper (item object or id).
export function bgStyle(itemOrId) {
  const item = typeof itemOrId === "string" ? catalogItem(itemOrId) : itemOrId;
  if (!item) return "";
  return `--bg-art:${bgCSS(item.visual)};`;
}
export const bgAnimated = (itemOrId) => {
  const item = typeof itemOrId === "string" ? catalogItem(itemOrId) : itemOrId;
  return !!item?.visual?.animate;
};

// Author fields on posts come prefixed (author_avatar, author_frame…).
export const fromAuthor = (p) => ({
  username: p.author, avatar: p.author_avatar, xp: p.author_xp,
  eq_frame: p.author_frame, eq_hat: p.author_hat, eq_color: p.author_color,
});
