// Profile → Customize: everything about how you look, in one place, with a live preview.
// Tabs: Avatar (Discord picture or built from parts, each part movable) · Frame · Accessory (+ fit) · Name (color + style)
//       · Chat text · Banner · Wallpaper. Save applies it all at once.
import { api, esc, t, toast } from "./common.js";
import { catalogItem, itemName, itemPreview, buildSVG, parseBuild, hatPlacement, avatarHTML, nameHTML, textAttrs, bgStyle, bgAnimated } from "./cosmetics.js";
import { PART_SLOTS, REQUIRED_SLOTS, DEFAULT_COLORS } from "./avatar-parts.js";
import { applyTheme } from "./themes.js";

const parseJSON = (s) => { if (!s) return null; if (typeof s === "object") return s; try { return JSON.parse(s); } catch { return null; } };
// equip slots (store item type → equipped key from /api/store)
const EQUIP = ["frame", "hat", "color", "font", "textstyle", "banner", "wallpaper", "theme"];
const TABS = ["avatar", "frame", "hat", "name", "textstyle", "banner", "wallpaper", "theme"];
let tab = "avatar";

export async function mountAvatarEditor(el, me) {
  el.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const { items, user } = await api("/api/store");
  const owned = new Set(user?.owned || []);
  const mineOf = (type) => items.filter((i) => i.type === type && owned.has(i.id));
  const partsOf = (slot) => mineOf("part").filter((i) => i.visual?.slot === slot);

  // ---- state (what you're editing) vs saved (what's live)
  const savedEq = { ...(user?.equipped || {}) };
  const eq = { ...savedEq };
  const savedBuild = parseBuild(me.avatar_build) || {};
  const build = {
    use: !!savedBuild.use, body: savedBuild.body || DEFAULT_COLORS.body, bg: savedBuild.bg || DEFAULT_COLORS.bg,
    parts: { ...(savedBuild.parts || {}) }, adjust: JSON.parse(JSON.stringify(savedBuild.adjust || {})),
  };
  if (!build.parts.shape) for (const slot of PART_SLOTS) { const first = partsOf(slot)[0]; if (first && slot !== "brows") build.parts[slot] = first.id; }
  const savedFit = parseJSON(user?.hat_fit ?? me.hat_fit);
  let fit = null;
  const resetFit = (keepSaved) => {
    const hat = catalogItem(eq.hat);
    fit = hat && !hat.visual?.halo ? hatPlacement({ ...hat.visual, ...(keepSaved && savedFit ? savedFit : {}) }) : null;
  };
  resetFit(true);
  const openAdjust = new Set();
  const snapshot = () => JSON.stringify({ eq, build, fit });
  const initial = snapshot();

  el.innerHTML = `
    <div class="card cz">
      <div class="cz-preview">
        <div class="cz-wall"></div>
        <div class="cz-card">
          <div class="cz-banner"></div>
          <div class="cz-stage" title="${esc(t("av.dragHint"))}"></div>
          <div class="cz-name"></div>
          <div class="cz-chat"></div>
        </div>
      </div>
      <div class="cz-side">
        <div class="cz-tabs">${TABS.map((k) => `<button type="button" data-tab="${k}">${t(`cz.tab.${k}`)}</button>`).join("")}</div>
        <div class="cz-panel"></div>
        <div class="cz-save actions"><span class="hint cz-dirty"></span><span style="flex:1"></span>
          <button type="button" data-undo>${t("av.revert")}</button><button type="button" class="primary" data-save>${t("save")}</button></div>
      </div>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const panel = $(".cz-panel");

  // ---- live preview
  function drawPreview() {
    const look = { ...me, eq_color: eq.color, eq_font: eq.font, eq_text: eq.textstyle };
    $(".cz-stage").innerHTML = avatarHTML(me, 120, { frame: catalogItem(eq.frame), hat: catalogItem(eq.hat), fit, build: { ...build } });
    $(".cz-name").innerHTML = nameHTML(look, "", catalogItem(eq.color), catalogItem(eq.font));
    const a = textAttrs(null, eq.textstyle || null);
    $(".cz-chat").innerHTML = `<div class="cz-bubble"><div class="body${a.cls}" style="${a.style}">${esc(t("st.textSample"))}</div></div>`;
    const ban = $(".cz-banner");
    ban.className = `cz-banner ${eq.banner ? "has-art" : ""} ${bgAnimated(eq.banner) ? "art-anim" : ""}`; ban.style.cssText = eq.banner ? bgStyle(eq.banner) : "";
    const wall = $(".cz-wall");
    wall.className = `cz-wall ${eq.wallpaper ? "has-art" : ""} ${bgAnimated(eq.wallpaper) ? "art-anim" : ""}`; wall.style.cssText = eq.wallpaper ? bgStyle(eq.wallpaper) : "";
    $(".cz-dirty").textContent = snapshot() !== initial ? t("cz.unsaved") : "";
  }

  // ---- chips
  const chipFor = (type, it, on, attrs) => `
    <button type="button" class="cz-chip ${on ? "on" : ""}" ${attrs} title="${esc(it ? itemName(it) : t("av.none"))}">
      <span class="cz-chip-prev">${it ? itemPreview(it, me, 40) : `<span class="ae-none">∅</span>`}</span>
      <span class="small">${esc(it ? itemName(it) : type === "theme" ? t("cz.siteDefault") : t("av.none"))}</span></button>`;
  const equipRow = (type, label) => {
    const list = mineOf(type);
    return `${label ? `<b class="small cz-label">${label}</b>` : ""}<div class="cz-chips">
      ${chipFor(type, null, !eq[type], `data-eq="${type}" data-id=""`)}
      ${list.map((it) => chipFor(type, it, eq[type] === it.id, `data-eq="${type}" data-id="${esc(it.id)}"`)).join("")}
    </div>${list.length ? "" : `<p class="hint">${t("cz.noneOwned")} <a href="/store">${t("nav.store")}</a></p>`}`;
  };
  const sliders = (rows, attr) => rows.map(([k, label, lo, hi, val, unit]) =>
    `<label class="fit-slider">${t(label)} <b>${val}${unit}</b><input type="range" ${attr}="${k}" min="${lo}" max="${hi}" step="1" value="${val}" data-unit="${unit}"></label>`).join("");

  function drawPanel() {
    el.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    if (tab === "avatar") {
      panel.innerHTML = `
        <div class="ae-mode">
          <button type="button" class="${build.use ? "" : "active"}" data-use="0">${t("av.discord")}</button>
          <button type="button" class="${build.use ? "active" : ""}" data-use="1">${t("av.built")}</button>
        </div>
        <div class="ae-builder stack ${build.use ? "" : "dim"}">
          <div class="ae-colors">
            <label>${t("av.body")}<input type="color" name="body" value="${esc(build.body)}"></label>
            <label>${t("av.bg")}<input type="color" name="bg" value="${esc(build.bg)}"></label>
          </div>
          ${PART_SLOTS.map((slot) => {
            const list = partsOf(slot), cur = build.parts[slot] || null, a = build.adjust[slot] || {};
            const chip = (it) => {
              const sample = { body: build.body, bg: build.bg, parts: slot === "shape" ? { shape: it } : { shape: build.parts.shape || "part_shape_round", [slot]: it } };
              return `<button type="button" class="ae-chip ${cur === (it?.id || null) ? "on" : ""}" data-slot="${slot}" data-part="${esc(it?.id || "")}" title="${esc(it ? itemName(it) : t("av.none"))}">
                ${it ? `<span class="av" style="--av:44px">${buildSVG(sample)}</span>` : `<span class="ae-none">∅</span>`}</button>`;
            };
            return `<div class="ae-row"><b class="small">${t(`av.slot.${slot}`)}</b><div class="ae-chips">
                ${REQUIRED_SLOTS.includes(slot) ? "" : chip(null)}${list.map(chip).join("") || `<span class="hint">${t("av.noParts")}</span>`}</div>
                ${cur ? `<button type="button" class="link small ae-move ${openAdjust.has(slot) ? "on" : ""}" data-move="${slot}">✥ ${t("cz.move")}</button>` : ""}</div>
              ${cur && openAdjust.has(slot) ? `<div class="ae-adjust" data-adjust-slot="${slot}">
                ${sliders([["x", "ad.hatX", -30, 30, a.x || 0, ""], ["y", "ad.hatY", -30, 30, a.y || 0, ""], ["s", "ad.hatSize", 50, 150, a.s || 100, "%"]], "data-part-k")}
                <button type="button" class="link small" data-adjust-reset="${slot}">${t("st.fitReset")}</button></div>` : ""}`;
          }).join("")}
          <a class="small" href="/store#avatar-parts">${t("av.getParts")} →</a>
        </div>`;
    } else if (tab === "hat") {
      const hat = catalogItem(eq.hat);
      panel.innerHTML = equipRow("hat") + (fit ? `
        <div class="ae-fit stack"><b>🎯 ${esc(t("av.fitTitle", { name: itemName(hat) }))}</b>
          <p class="hint" style="margin:0">${t("av.dragHint")}</p>
          ${sliders([["size", "ad.hatSize", 30, 200, fit.size, "%"], ["x", "ad.hatX", -100, 100, fit.x, ""], ["y", "ad.hatY", -120, 100, fit.y, ""], ["rotate", "ad.hatRot", -180, 180, fit.rotate, "°"]], "data-fit-k")}
          <button type="button" class="link small" data-fit-reset>${t("st.fitReset")}</button></div>` : "");
    } else if (tab === "name") {
      panel.innerHTML = equipRow("color", t("cz.nameColor")) + equipRow("font", t("cz.nameStyle")) + `<p class="hint">${t("cz.nameHint")}</p>`;
    } else if (tab === "textstyle") {
      panel.innerHTML = equipRow("textstyle") + `<p class="hint">${t("cz.textHint")}</p>`;
    } else {
      panel.innerHTML = equipRow(tab) + (tab === "wallpaper" ? `<p class="hint">${t("st.wallpaperHint")}</p>` : tab === "theme" ? `<p class="hint">${t("cz.themeHint")}</p>` : "");
    }
  }
  const draw = () => { drawPanel(); drawPreview(); };

  // ---- events
  el.querySelector(".cz-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; drawPanel(); } });
  panel.addEventListener("click", (e) => {
    const q = (s) => e.target.closest(s);
    if (q("[data-eq]")) {
      const b = q("[data-eq]"); eq[b.dataset.eq] = b.dataset.id || null;
      if (b.dataset.eq === "theme") applyTheme(catalogItem(eq.theme), false); // try it on the whole page (Undo/leaving puts yours back)
      if (b.dataset.eq === "hat") resetFit(b.dataset.id === savedEq.hat);
      return draw();
    }
    if (q("[data-use]")) { build.use = q("[data-use]").dataset.use === "1"; return draw(); }
    if (q("[data-slot]")) { const b = q("[data-slot]"); build.parts[b.dataset.slot] = b.dataset.part || null; build.use = true; return draw(); }
    if (q("[data-move]")) { const s = q("[data-move]").dataset.move; openAdjust.has(s) ? openAdjust.delete(s) : openAdjust.add(s); return drawPanel(); }
    if (q("[data-adjust-reset]")) { delete build.adjust[q("[data-adjust-reset]").dataset.adjustReset]; return draw(); }
    if (q("[data-fit-reset]")) { fit = hatPlacement(catalogItem(eq.hat).visual); return draw(); }
  });
  panel.addEventListener("input", (e) => {
    const r = e.target;
    const label = () => { const b = r.parentElement.querySelector("b"); if (b) b.textContent = r.value + (r.dataset.unit || ""); };
    if (r.name === "body" || r.name === "bg") { build[r.name] = r.value; return draw(); }
    if (r.dataset.partK) { const slot = r.closest("[data-adjust-slot]").dataset.adjustSlot; (build.adjust[slot] ||= { x: 0, y: 0, s: 100 })[r.dataset.partK] = Number(r.value); label(); return drawPreview(); }
    if (r.dataset.fitK) { fit[r.dataset.fitK] = Number(r.value); label(); return drawPreview(); }
  });
  // drag the accessory on the preview
  $(".cz-stage").addEventListener("pointerdown", (e) => {
    if (!fit || !e.target.closest(".av-hat")) return;
    e.preventDefault();
    const av = $(".cz-stage .av").getBoundingClientRect();
    const move = (ev) => {
      fit.x = Math.round(((ev.clientX - av.left) / av.width - 0.5) * 100); fit.y = Math.round(((ev.clientY - av.top) / av.height - 0.5) * 100);
      drawPreview(); if (tab === "hat") drawPanel();
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  $("[data-undo]").onclick = () => { applyTheme(catalogItem(savedEq.theme), false); mountAvatarEditor(el, me); };
  $("[data-save]").onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      if (build.use && !build.parts.shape) throw new Error(t("av.needShape"));
      for (const slot of EQUIP) if ((eq[slot] || null) !== (savedEq[slot] || null))
        await api("/api/store/equip", { method: "POST", body: { slot, item: eq[slot] || null } });
      const parts = Object.fromEntries(Object.entries(build.parts).filter(([, v]) => v));
      await api("/api/avatar", { method: "POST", body: { use: build.use, body: build.body, bg: build.bg, parts, adjust: build.adjust } });
      if (fit) {
        const d = hatPlacement(catalogItem(eq.hat).visual);
        const isDefault = ["size", "x", "y", "rotate"].every((k) => d[k] === fit[k]);
        await api("/api/store/hat-fit", { method: "POST", body: isDefault ? { reset: true } : fit });
      }
      toast(t("saved"));
      setTimeout(() => location.reload(), 400);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
  draw();
}
