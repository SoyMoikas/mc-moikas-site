// Auto-translate what people write (chat, posts, announcements, answers, comments) into your language.
// The UI is already translated by i18n.js; this does the rest. Each translated block gets a small 🌐 —
// click it to see the original. Turn it off in ⚙️ Ajustes (saved in this browser).
import { lang } from "./i18n.js";

// where people's own words show up
const TARGETS = [
  ".body", ".post h3", ".qd-q", ".qd-text", ".task-body", ".rp-narr", "[data-tr]",
].join(",");
// UI samples and editors — never touch these
const SKIP = ".text-preview, .to-text, form, [contenteditable], .no-tr";

const KEY = "autotr";
export const autoTrOn = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
export function setAutoTr(on) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch {}
  location.reload();
}

// text → translation ("" = nothing to change). Shared by every block on the page; kept for this visit.
const CACHE = new Map();
const SS = "autotr:" + lang;
try { for (const [k, v] of JSON.parse(sessionStorage.getItem(SS) || "[]")) CACHE.set(k, v); } catch {}
let saveT = 0;
function saveCache() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { sessionStorage.setItem(SS, JSON.stringify([...CACHE].slice(-600))); } catch {} }, 500);
}

const ORIG = new WeakMap(); // text node → original text
const queue = new Set();     // strings waiting for the server
let busy = false, timer = 0, retryAt = 0;

const worth = (s) => s.length >= 2 && /[a-záéíóúñ]{2}/i.test(s) && !/^https?:\/\/\S+$/.test(s);

function textNodes(el) {
  const out = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("a, button, code, .tr-tag, .uname, .sticker") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  while (w.nextNode()) out.push(w.currentNode);
  return out;
}

function apply(el) {
  if (el.dataset.trOff === "1") return;
  let changed = false;
  for (const n of textNodes(el)) {
    const src = ORIG.get(n) ?? n.data;
    const s = src.trim();
    if (!worth(s)) continue;
    if (!CACHE.has(s)) { queue.add(s); continue; }
    const tr = CACHE.get(s);
    if (!tr) continue;
    if (!ORIG.has(n)) ORIG.set(n, src);
    const lead = src.match(/^\s*/)[0], trail = src.match(/\s*$/)[0];
    const next = lead + tr + trail;
    if (n.data !== next) n.data = next;
    changed = true;
  }
  if (changed && !el.querySelector(":scope > .tr-tag")) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tr-tag";
    b.textContent = "🌐";
    b.title = lang === "es" ? "Traducido automáticamente · clic para ver el original" : "Auto-translated · click to see the original";
    b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const off = el.dataset.trOff !== "1";
      el.dataset.trOff = off ? "1" : "0";
      for (const n of textNodes(el)) {
        if (!ORIG.has(n)) continue;
        const src = ORIG.get(n);
        if (off) n.data = src;
        else { const tr = CACHE.get(src.trim()); if (tr) n.data = src.match(/^\s*/)[0] + tr + src.match(/\s*$/)[0]; }
      }
      b.classList.toggle("off", off);
    };
    el.appendChild(b);
  }
}

function scan(root = document) {
  const els = [];
  if (root.nodeType === 1 && root.matches?.(TARGETS)) els.push(root);
  root.querySelectorAll?.(TARGETS).forEach((e) => els.push(e));
  for (const el of els) if (!el.closest(SKIP)) apply(el);
  if (queue.size) kick();
}

function kick() {
  clearTimeout(timer);
  timer = setTimeout(flush, Math.max(250, retryAt - Date.now()));
}

async function flush() {
  if (busy || !queue.size) return;
  busy = true;
  const batch = [...queue].slice(0, 40);
  batch.forEach((s) => queue.delete(s));
  let later = [];
  try {
    const r = await fetch("/api/translate", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: lang, texts: batch }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    const wait = new Set(d.later || []);
    batch.forEach((s, i) => { if (wait.has(i)) later.push(s); else CACHE.set(s, d.out?.[i] || ""); });
    saveCache();
  } catch {
    later = batch;
  }
  busy = false;
  // anything the server couldn't do yet (daily limit, a hiccup): try again in a minute
  if (later.length) { retryAt = Date.now() + 60_000; setTimeout(() => { later.forEach((s) => queue.add(s)); kick(); }, 60_000); }
  scan();
  if (queue.size) kick();
}

export function startAutoTr() {
  if (!autoTrOn() || window.__autotr) return;
  window.__autotr = true;
  scan();
  let pend = new Set(), raf = 0;
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.target.nodeType === 1 && m.target.closest?.(".tr-tag")) continue;
      if (m.type === "characterData") { const p = m.target.parentElement?.closest(TARGETS); if (p) pend.add(p); continue; }
      m.addedNodes.forEach((n) => { if (n.nodeType === 1 && !n.classList?.contains("tr-tag")) pend.add(n); });
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const p = pend; pend = new Set(); p.forEach((n) => n.isConnected && scan(n)); });
  }).observe(document.body, { childList: true, subtree: true });
}
