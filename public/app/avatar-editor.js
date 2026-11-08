// Profile → Avatar: choose Discord picture or a built avatar (parts from the store), and fit your accessory.
import { api, esc, t, toast } from "./common.js";
import { catalogItem, itemName, buildSVG, parseBuild, hatPlacement, avatarHTML } from "./cosmetics.js";
import { PART_SLOTS, REQUIRED_SLOTS, DEFAULT_COLORS } from "./avatar-parts.js";

const parseJSON = (s) => { if (!s) return null; if (typeof s === "object") return s; try { return JSON.parse(s); } catch { return null; } };

export async function mountAvatarEditor(el, me) {
  el.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const { items, user } = await api("/api/store");
  const owned = new Set(user?.owned || []);
  const mine = (slot) => items.filter((i) => i.type === "part" && i.visual?.slot === slot && owned.has(i.id));

  const saved = parseBuild(me.avatar_build) || {};
  const state = {
    use: !!saved.use,
    body: saved.body || DEFAULT_COLORS.body,
    bg: saved.bg || DEFAULT_COLORS.bg,
    parts: { ...(saved.parts || {}) },
  };
  // first time: start from your starter parts
  if (!state.parts.shape) for (const slot of PART_SLOTS) { const first = mine(slot)[0]; if (first && (REQUIRED_SLOTS.includes(slot) || slot !== "brows")) state.parts[slot] = first.id; }

  const hat = catalogItem(me.eq_hat);
  const canFit = hat && !hat.visual?.halo;
  const defFit = canFit ? hatPlacement(hat.visual) : null;
  const fit = canFit ? hatPlacement({ ...hat.visual, ...(parseJSON(me.hat_fit) || {}) }) : null;

  el.innerHTML = `
    <div class="card avatar-editor">
      <div class="ae-stage" title="${canFit ? esc(t("av.dragHint")) : ""}"></div>
      <div class="ae-side stack">
        <div class="ae-mode chips">
          <button type="button" data-use="0">${t("av.discord")}</button>
          <button type="button" data-use="1">${t("av.built")}</button>
        </div>
        <div class="ae-builder stack">
          <div class="row ae-colors">
            <label>${t("av.body")}<input type="color" name="body" value="${esc(state.body)}"></label>
            <label>${t("av.bg")}<input type="color" name="bg" value="${esc(state.bg)}"></label>
          </div>
          <div class="ae-parts"></div>
          <a class="small" href="/store#avatar-parts">${t("av.getParts")} →</a>
        </div>
        ${canFit ? `
          <div class="ae-fit stack">
            <b>🎯 ${esc(t("av.fitTitle", { name: itemName(hat) }))}</b>
            <p class="hint" style="margin:0">${t("av.dragHint")}</p>
            ${[["size", "ad.hatSize", 30, 200, "%"], ["x", "ad.hatX", -100, 100, ""], ["y", "ad.hatY", -120, 100, ""], ["rotate", "ad.hatRot", -180, 180, "°"]].map(([k, l, lo, hi, u]) =>
              `<label class="fit-slider">${t(l)} <b data-v="${k}"></b><input type="range" data-k="${k}" data-u="${u}" min="${lo}" max="${hi}" step="1"></label>`).join("")}
            <button type="button" class="link small" data-fit-reset>${t("st.fitReset")}</button>
          </div>` : `<p class="hint">${t("av.noHat")} <a href="/store#hats">${t("nav.store")}</a></p>`}
        <div class="actions"><span style="flex:1"></span><button type="button" data-revert>${t("av.revert")}</button><button type="button" class="primary" data-save>${t("save")}</button></div>
      </div>
    </div>`;

  const stage = el.querySelector(".ae-stage"), partsBox = el.querySelector(".ae-parts");
  const preview = () => avatarHTML(me, 150, { frame: catalogItem(me.eq_frame), hat: hat || null, fit, build: { ...state } });

  function chip(slot, it) {
    const on = (state.parts[slot] || null) === (it?.id || null);
    const sample = { body: state.body, bg: state.bg, parts: slot === "shape" ? { shape: it } : { shape: state.parts.shape || "part_shape_round", [slot]: it } };
    return `<button type="button" class="ae-chip ${on ? "on" : ""}" data-slot="${slot}" data-part="${esc(it?.id || "")}" title="${esc(it ? itemName(it) : t("av.none"))}">
      ${it ? `<span class="av" style="--av:44px">${buildSVG(sample)}</span>` : `<span class="ae-none">∅</span>`}</button>`;
  }
  function draw() {
    stage.innerHTML = preview();
    el.querySelectorAll("[data-use]").forEach((b) => b.classList.toggle("active", (b.dataset.use === "1") === state.use));
    el.querySelector(".ae-builder").classList.toggle("dim", !state.use);
    partsBox.innerHTML = PART_SLOTS.map((slot) => {
      const list = mine(slot);
      return `<div class="ae-row"><b class="small">${t(`av.slot.${slot}`)}</b><div class="ae-chips">
        ${REQUIRED_SLOTS.includes(slot) ? "" : chip(slot, null)}
        ${list.map((it) => chip(slot, it)).join("") || `<span class="hint">${t("av.noParts")}</span>`}</div></div>`;
    }).join("");
    if (fit) el.querySelectorAll("[data-k]").forEach((r) => { r.value = fit[r.dataset.k]; el.querySelector(`[data-v="${r.dataset.k}"]`).textContent = fit[r.dataset.k] + r.dataset.u; });
  }

  el.querySelectorAll("[data-use]").forEach((b) => b.onclick = () => { state.use = b.dataset.use === "1"; draw(); });
  el.querySelector("[name=body]").oninput = (e) => { state.body = e.target.value; draw(); };
  el.querySelector("[name=bg]").oninput = (e) => { state.bg = e.target.value; draw(); };
  partsBox.addEventListener("click", (e) => {
    const c = e.target.closest("[data-slot]");
    if (!c) return;
    state.parts[c.dataset.slot] = c.dataset.part || null;
    state.use = true; // picking a part means you want the built avatar
    draw();
  });
  if (fit) {
    el.querySelectorAll("[data-k]").forEach((r) => r.oninput = () => { fit[r.dataset.k] = Number(r.value); draw(); });
    el.querySelector("[data-fit-reset]").onclick = () => { Object.assign(fit, defFit); draw(); };
    // drag the accessory right on the big preview
    stage.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".av-hat")) return;
      e.preventDefault();
      const av = stage.querySelector(".av").getBoundingClientRect();
      const move = (ev) => { fit.x = Math.round(((ev.clientX - av.left) / av.width - 0.5) * 100); fit.y = Math.round(((ev.clientY - av.top) / av.height - 0.5) * 100); draw(); };
      const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
      addEventListener("pointermove", move); addEventListener("pointerup", up);
    });
  }
  el.querySelector("[data-revert]").onclick = () => mountAvatarEditor(el, me);
  el.querySelector("[data-save]").onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      if (state.use && !state.parts.shape) throw new Error(t("av.needShape"));
      const parts = Object.fromEntries(Object.entries(state.parts).filter(([, v]) => v));
      await api("/api/avatar", { method: "POST", body: { use: state.use, body: state.body, bg: state.bg, parts } });
      if (fit) {
        const isDefault = ["size", "x", "y", "rotate"].every((k) => defFit[k] === fit[k]);
        await api("/api/store/hat-fit", { method: "POST", body: isDefault ? { reset: true } : fit });
      }
      toast(t("saved"));
      setTimeout(() => location.reload(), 400);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
  draw();
}
