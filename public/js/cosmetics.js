// How store items look. Frames and name colors are CSS classes (style.css); hats and stickers are emoji.
import { t } from "./i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const HATS = {
  hat_party: "🎉", hat_cap: "🧢", hat_flower: "🌸", hat_tophat: "🎩", hat_grad: "🎓",
  hat_star: "⭐", hat_fire: "🔥", hat_halo: "", hat_crown: "👑",
};

// emoji, or text for word stickers
export const STICKERS = {
  st_gg: { text: "GG" }, st_heart: { emoji: "❤️" }, st_hi: { emoji: "👋" }, st_brb: { text: "BRB" },
  st_pick: { emoji: "⛏️" }, st_lol: { emoji: "😂" }, st_sad: { emoji: "😭" }, st_sleep: { emoji: "😴" },
  st_gem: { emoji: "💎" }, st_swords: { emoji: "⚔️" }, st_fire: { emoji: "🔥" }, st_alv: { text: "ALV" },
  st_skull: { emoji: "💀" }, st_cake: { emoji: "🎂" }, st_party: { emoji: "🥳" }, st_rip: { emoji: "🪦" },
  st_trophy: { emoji: "🏆" },
};

export const STICKER_RE = /^\[\[sticker:([a-z0-9_]{1,40})\]\]$/;
export const stickerCode = (id) => `[[sticker:${id}]]`;

export const itemName = (id) => t(`item.${id}`);

// Avatar with equipped frame and hat. `u` needs avatar, eq_frame, eq_hat.
export function avatarHTML(u, size = 32) {
  const img = esc(u?.avatar || "https://cdn.discordapp.com/embed/avatars/0.png");
  const frame = u?.eq_frame ? ` ${esc(u.eq_frame.replace(/_/g, "-"))}` : "";
  const hat = u?.eq_hat;
  let hatHTML = "";
  if (hat === "hat_halo") hatHTML = `<span class="av-halo"></span>`;
  else if (hat && HATS[hat]) hatHTML = `<span class="av-hat">${HATS[hat]}</span>`;
  return `<span class="av${frame}" style="--av:${size}px"><img src="${img}" alt="" loading="lazy">${hatHTML}</span>`;
}

// Username with equipped name color.
export function nameHTML(u, fallback = "") {
  const color = u?.eq_color ? ` ${esc(u.eq_color.replace(/_/g, "-"))}` : "";
  return `<b class="uname-c${color}">${esc(u?.username || fallback)}</b>`;
}

export function stickerHTML(id, { small = false } = {}) {
  const s = STICKERS[id];
  if (!s) return "";
  return `<span class="sticker ${small ? "small" : ""} ${s.text ? "word" : ""}" title="${esc(itemName(id))}">${s.text ? esc(s.text) : s.emoji}</span>`;
}

// Author fields on posts come prefixed (author_avatar, author_frame…).
export const fromAuthor = (p) => ({
  username: p.author, avatar: p.author_avatar, xp: p.author_xp,
  eq_frame: p.author_frame, eq_hat: p.author_hat, eq_color: p.author_color,
});
