// Site themes: a store item (type "theme") that changes how the whole site looks for the player wearing it.
// visual = { bg, panel, border, text, muted, accent?, texture, strength 0–100, image?, edge, radius 0–24, font?, heading? }
// Applied as CSS variables + classes on <html>; the rules live in style.css under "Site themes".
// Keep TEXTURES / EDGES in sync with lib/catalog.js.
import { FONTS } from "./cosmetics.js";

export const TEXTURES = ["none", "grain", "paper", "dots", "grid", "stripes", "pixel", "bricks", "scanlines", "image"];
export const EDGES = ["solid", "dashed", "double", "pixel", "glow", "none"];
const HEX = /^#[0-9a-f]{6}$/i;
const IMG = /^(https:\/\/[^\s"'<>()]+|\/[\w\-./]+\.(png|webp|gif|jpe?g|svg))$/i;

const svgURL = (svg) => `url('data:image/svg+xml,${svg.replace(/#/g, "%23").replace(/'/g, "%27").replace(/</g, "%3C").replace(/>/g, "%3E")}')`;

// The texture drawn on every block, tinted with the theme's text colour so it works on light and dark themes.
export function textureCSS(v) {
  const s = Math.min(100, Math.max(0, Number(v.strength ?? 50))) / 100;
  const ink = (pct) => `color-mix(in srgb, ${v.text} ${Math.round(pct * s)}%, transparent)`;
  switch (v.texture) {
    case "grain":
    case "paper": {
      const f = v.texture === "paper" ? ".55" : ".9";
      return svgURL(`<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${f}' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)' opacity='${(0.28 * s).toFixed(2)}'/></svg>`);
    }
    case "dots": return `radial-gradient(${ink(22)} 1.2px, transparent 1.8px)`;
    case "grid": return `linear-gradient(${ink(12)} 1px, transparent 1px), linear-gradient(90deg, ${ink(12)} 1px, transparent 1px)`;
    case "stripes": return `repeating-linear-gradient(45deg, ${ink(9)} 0 8px, transparent 8px 18px)`;
    case "pixel": return `conic-gradient(${ink(9)} 25%, transparent 0 50%, ${ink(9)} 0 75%, transparent 0)`;
    case "scanlines": return `repeating-linear-gradient(0deg, rgba(0,0,0,${(0.35 * s).toFixed(2)}) 0 1px, transparent 1px 3px)`;
    case "bricks": {
      const a = (0.5 * s).toFixed(2);
      return svgURL(`<svg xmlns='http://www.w3.org/2000/svg' width='72' height='48'><g fill='${v.text}' opacity='${a}'><rect width='72' height='2'/><rect y='24' width='72' height='2'/><rect width='2' height='24'/><rect x='36' width='2' height='24'/><rect x='18' y='24' width='2' height='24'/><rect x='54' y='24' width='2' height='24'/></g></svg>`);
    }
    case "image": return IMG.test(v.image || "") ? `url('${v.image}')` : "none";
    default: return "none";
  }
}
const TEX_SIZE = { dots: "14px 14px", grid: "22px 22px", pixel: "16px 16px", bricks: "72px 48px", image: "64px 64px" };

const family = (id) => (!id || id === "default" ? "" : id.startsWith("u_") ? `"uf-${id}", sans-serif` : FONTS[id] ? `"${FONTS[id]}", sans-serif` : "");

// CSS variables for a theme (also used for the small previews in the store and Customize page).
export function themeVars(v) {
  if (!v || !["bg", "panel", "border", "text", "muted"].every((k) => HEX.test(v[k] || ""))) return null;
  const vars = {
    "--bg": v.bg, "--panel": v.panel, "--panel-2": `color-mix(in srgb, ${v.panel} 85%, ${v.text})`, "--border": v.border,
    "--text": v.text, "--muted": v.muted, "--radius": `${Math.min(24, Math.max(0, Number(v.radius ?? 8)))}px`,
    "--tex": textureCSS(v), "--tex-size": TEX_SIZE[v.texture] || "auto",
    "--wp-dim": `${Math.min(100, Math.max(0, Number(v.dim ?? 70)))}%`,
  };
  const blocks = Math.min(100, Math.max(20, Number(v.blocks ?? 100)));
  if (blocks < 100) { vars["--panel"] = `color-mix(in srgb, ${v.panel} ${blocks}%, transparent)`; vars["--panel-2"] = `color-mix(in srgb, ${v.panel} ${Math.min(100, blocks + 10)}%, transparent)`; }
  // light themes: darker status colours (staff/announcement labels, info, errors) so they stay readable
  const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
  if (lum(v.bg) > 0.55) Object.assign(vars, { "--warn": "#9a5b00", "--info": "#1f5f99", "--bad": "#b0352a" });
  if (HEX.test(v.accent || "")) { vars["--accent"] = v.accent; vars["--accent-dim"] = `color-mix(in srgb, ${v.accent} 55%, ${v.bg})`; }
  if (family(v.font)) vars["--theme-font"] = family(v.font);
  if (family(v.heading)) vars["--theme-heading"] = family(v.heading);
  return vars;
}
export const themeClasses = (v) => ["themed", Number(v?.blocks ?? 100) < 100 ? "see-through" : "", `te-${EDGES.includes(v?.edge) ? v.edge : "solid"}`, v?.font ? "tf-body" : "", v?.heading ? "tf-head" : ""].filter(Boolean);

// Apply to the whole page (null = back to the site's normal look). `remember` caches it so the next page
// can paint it before anything loads.
let applied = [];
const CACHE = "moikas.theme";
export function applyCachedTheme() {
  try { const v = JSON.parse(localStorage.getItem(CACHE) || "null"); if (v) applyTheme({ visual: v }, false); } catch { /* storage off */ }
}
export function applyTheme(item, remember = true) {
  if (remember) try { item?.visual ? localStorage.setItem(CACHE, JSON.stringify(item.visual)) : localStorage.removeItem(CACHE); } catch { /* storage off */ }
  const root = document.documentElement;
  for (const k of applied) root.style.removeProperty(k);
  root.classList.remove(...[...root.classList].filter((c) => c === "themed" || c === "see-through" || c.startsWith("te-") || c === "tf-body" || c === "tf-head"));
  applied = [];
  const v = item?.visual, vars = themeVars(v);
  if (!vars) return;
  for (const [k, val] of Object.entries(vars)) { root.style.setProperty(k, val); applied.push(k); }
  root.classList.add(...themeClasses(v));
}

// Inline style + classes for a small preview box.
export function themePreviewHTML(item, label = "Aa") {
  const v = item?.visual, vars = themeVars(v);
  if (!vars) return "";
  const style = Object.entries(vars).map(([k, val]) => `${k}:${val}`).join(";").replace(/"/g, "&quot;");
  return `<span class="theme-preview ${themeClasses(v).join(" ")}" style="${style}">
    <span class="tp-card"><b class="tp-h">${label}</b><span class="tp-line"></span><span class="tp-line short"></span><span class="tp-btn"></span></span></span>`;
}
