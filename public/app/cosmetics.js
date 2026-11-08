// How store items look. Items come from the database (Admin → Store); this file turns them into HTML.
// visual: frame {color, style: solid|glow|pulse|rainbow|shimmer} · color {color, style: solid|glow|rainbow}
//         hat {emoji | image | halo} · sticker {emoji | text | image}
//         font / textstyle {font, effect: none|solid|gradient|rainbow|glow|graffiti|3d, color, color2, animate}
import { t, lang } from "./i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "#9aa0aa");
const safeUrl = (u) => (/^(https:\/\/[^\s"'<>]+|\/[\w\-./]+\.(png|webp|gif|jpe?g|svg))$/i.test(u || "") ? u : "");

let CATALOG = {};
export async function loadCatalog() {
  try {
    const r = await fetch("/api/store/catalog");
    if (r.ok) { const d = await r.json(); CATALOG = d.items || {}; (d.fonts || []).forEach(registerFont); }
  } catch { /* render without cosmetics */ }
}
export const catalogItem = (id) => (id ? CATALOG[id] : null);

export const itemName = (item) => (item ? (lang === "es" && item.name_es ? item.name_es : item.name) : "");

// Self-hosted fonts (public/fonts, @font-face in style.css). Keep in sync with FONTS in lib/catalog.js.
export const FONTS = {
  default: "Site font", marker: "Permanent Marker", spray: "Rubik Spray Paint", graffiti: "Sedgwick Ave Display",
  bubbles: "Rubik Bubbles", bungee: "Bungee", shade: "Bungee Shade", bangers: "Bangers", pixel: "Silkscreen",
  arcade: "Press Start 2P", creepy: "Creepster", script: "Pacifico", neon: "Monoton", glitch: "Rubik Glitch",
};
export const EFFECTS = ["none", "solid", "gradient", "rainbow", "glow", "graffiti", "3d"];

// Uploaded fonts (ids start with u_): add an @font-face + .tf-<id> rule. The browser only downloads a font once
// something on the page actually uses it.
export function registerFont(f) {
  if (!/^u_[a-z0-9_]{1,30}$/.test(f?.id || "") || FONTS[f.id]) return;
  FONTS[f.id] = f.name;
  let el = document.getElementById("uploaded-fonts");
  if (!el) { el = document.createElement("style"); el.id = "uploaded-fonts"; document.head.appendChild(el); }
  const fmt = { woff2: "woff2", woff: "woff", truetype: "truetype", opentype: "opentype" }[f.format] || "woff2";
  el.textContent += `@font-face{font-family:"uf-${f.id}";src:url("/api/fonts/${f.id}") format("${fmt}");font-display:swap}`
    + `.tf-${f.id}{font-family:"uf-${f.id}",sans-serif;font-weight:400}`;
}

// Classes + CSS variables for a font/textstyle item.
export function textFx(itemOrId) {
  const item = typeof itemOrId === "string" ? catalogItem(itemOrId) : itemOrId;
  if (!item) return { cls: "", style: "", effect: false };
  const v = item.visual || {};
  const font = FONTS[v.font] && v.font !== "default" ? ` tf-${v.font}` : "";
  const effect = EFFECTS.includes(v.effect) && v.effect !== "none" ? v.effect : "";
  const cls = `${font}${effect ? ` fx-${effect}` : ""}${effect && v.animate ? " fx-anim" : ""}`;
  const style = effect ? `--c1:${safeColor(v.color || "#ffffff")};--c2:${safeColor(v.color2 || v.color || "#ffffff")};` : "";
  return { cls, style, effect: !!effect };
}
// For message/post bodies: `<div class="body${cls}" style="...">`. `over` = textstyle item to preview.
export function textAttrs(u, over) {
  const f = textFx(over !== undefined ? over : u?.eq_text);
  return { cls: f.cls, style: f.style };
}

export const STICKER_RE = /^\[\[sticker:([a-z0-9_]{1,40})\]\]$/;
export const stickerCode = (id) => `[[sticker:${id}]]`;

function frameAttrs(item) {
  if (!item) return { cls: "", style: "", img: "" };
  const v = item.visual || {};
  // Image frame: a PNG laid over the avatar at 1.5× its size (art can stick out 25% on every side).
  if (v.image && safeUrl(v.image)) return { cls: " framed-img", style: "", img: `<img class="av-frame" src="${esc(v.image)}" alt="" loading="lazy">` };
  return { cls: ` framed fs-${esc(v.style || "solid")}`, style: `--fc:${safeColor(v.color)};`, img: "" };
}

function hatHTML(item) {
  if (!item) return "";
  const v = item.visual || {};
  if (v.halo) return `<span class="av-halo"></span>`;
  // size: % of the avatar width (default 62) · pos: corner (default) | top | face
  const size = Number(v.size) >= 30 && Number(v.size) <= 200 ? Number(v.size) : 62;
  const cls = `av-hat${["top", "face"].includes(v.pos) ? ` hp-${v.pos}` : ""}`;
  const style = size !== 62 ? ` style="--hs:${size / 100}"` : "";
  if (v.image && safeUrl(v.image)) return `<span class="${cls}"${style}><img src="${esc(v.image)}" alt=""></span>`;
  if (v.emoji) return `<span class="${cls}"${style}>${esc(v.emoji)}</span>`;
  return "";
}

// Avatar with equipped frame and hat. Pass `over` = {frame, hat} item objects to preview unsaved items.
export function avatarHTML(u, size = 32, over = {}) {
  const img = esc(u?.avatar || "https://cdn.discordapp.com/embed/avatars/0.png");
  const frame = "frame" in over ? over.frame : catalogItem(u?.eq_frame);
  const hat = "hat" in over ? over.hat : catalogItem(u?.eq_hat);
  const f = frameAttrs(frame);
  return `<span class="av${f.cls}" style="--av:${size}px;${f.style}"><img src="${img}" alt="" loading="lazy">${f.img}${hatHTML(hat)}</span>`;
}

// Username with equipped name color + name style (font/effect). `over` / `fontOver` = items to preview.
// A name style with its own effect (rainbow, graffiti…) wins over the name color; a plain font keeps the color.
export function nameHTML(u, fallback = "", over, fontOver) {
  const fx = textFx(fontOver !== undefined ? fontOver : u?.eq_font);
  const item = fx.effect ? null : over !== undefined ? over : catalogItem(u?.eq_color);
  const v = item?.visual || {};
  const style = (item && v.style !== "rainbow" ? `color:${safeColor(v.color)};` : "") + fx.style;
  const cls = (item ? ` nc-${esc(v.style || "solid")}` : "") + fx.cls;
  return `<b class="uname-c${cls}"${style ? ` style="${style}"` : ""}>${esc(u?.username || fallback)}</b>`;
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
  if (item.type === "color") return `<span class="color-preview">${nameHTML({ ...base, eq_font: null }, "", item)}</span>`;
  if (item.type === "font") return `<span class="color-preview font-preview">${nameHTML(base, "", undefined, item)}</span>`;
  if (item.type === "textstyle") { const a = textAttrs(null, item); return `<span class="text-preview"><span class="body${a.cls}" style="${a.style}">${esc(t("st.textSample"))}</span></span>`; }
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
    case "bricks": return `${bricksSVG(c, c2)} 0 0/72px 48px, ${c}`;
    default: return `linear-gradient(120deg, ${c}, ${c2}, ${c})`;
  }
}
// Brick wall tile (running bond) as an inline SVG: c = brick, c2 = mortar. A few bricks get a lighter/darker shade.
function bricksSVG(c, c2) {
  const m = c2.replace("#", "%23"), b = c.replace("#", "%23");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='72' height='48'><rect width='72' height='48' fill='${b}'/>`
    + `<rect x='3' y='3' width='30' height='18' fill='%23ffffff' opacity='.06'/><rect x='39' y='27' width='30' height='18' fill='%23000000' opacity='.12'/>`
    + `<rect x='-15' y='27' width='30' height='18' fill='%23000000' opacity='.06'/>`
    + `<g fill='${m}'><rect width='72' height='3'/><rect y='24' width='72' height='3'/><rect x='0' width='3' height='24'/><rect x='36' width='3' height='24'/>`
    + `<rect x='18' y='24' width='3' height='24'/><rect x='54' y='24' width='3' height='24'/></g></svg>`;
  // single-quoted url + encoded quotes/brackets, so it survives inside style="…" attributes
  return `url('data:image/svg+xml,${svg.replace(/'/g, "%27").replace(/</g, "%3C").replace(/>/g, "%3E")}')`;
}

// Inline style for an element showing a banner/wallpaper (item object or id).
export function bgStyle(itemOrId) {
  const item = typeof itemOrId === "string" ? catalogItem(itemOrId) : itemOrId;
  if (!item) return "";
  return `--bg-art:${bgCSS(item.visual)};`;
}
// Brick-wall banners cover the whole post (the "graffiti on a wall" look) instead of just its top strip.
export const bgWall = (itemOrId) => {
  const item = typeof itemOrId === "string" ? catalogItem(itemOrId) : itemOrId;
  return item?.visual?.pattern === "bricks";
};
export const bgAnimated = (itemOrId) => {
  const item = typeof itemOrId === "string" ? catalogItem(itemOrId) : itemOrId;
  return !!item?.visual?.animate;
};

// Author fields on posts come prefixed (author_avatar, author_frame…).
export const fromAuthor = (p) => ({
  username: p.author, avatar: p.author_avatar, xp: p.author_xp,
  eq_frame: p.author_frame, eq_hat: p.author_hat, eq_color: p.author_color, eq_font: p.author_font,
});
