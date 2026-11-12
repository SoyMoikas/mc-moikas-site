// "Ruedas": picker wheels — Apex legends, guns, what to play tonight, or anything you type.
// Presets live here (edit them freely: weapons rotate every season); your own wheels are saved via /api/wheels.
import { ask, api, esc, t, toast, SITE } from "./common.js";

const L = (cls, names) => names.map((name) => ({ name, tag: cls }));
export const PRESETS = [
  { key: "legends", icon: "🧑‍🚀", entries: [
    ...L("Assault", ["Bangalore", "Revenant", "Fuse", "Mad Maggie", "Ballistic", "Ash"]),
    ...L("Skirmisher", ["Pathfinder", "Wraith", "Octane", "Horizon", "Valkyrie", "Alter", "Axle"]),
    ...L("Recon", ["Bloodhound", "Crypto", "Seer", "Vantage", "Sparrow"]),
    ...L("Support", ["Gibraltar", "Lifeline", "Mirage", "Loba", "Newcastle", "Conduit"]),
    ...L("Controller", ["Caustic", "Wattson", "Rampart", "Catalyst"]),
  ] },
  { key: "guns", icon: "🔫", entries: [
    ...L("AR", ["R-301", "Flatline", "Hemlok", "Havoc", "Nemesis"]),
    ...L("SMG", ["R-99", "Alternator", "Prowler", "Volt", "C.A.R."]),
    ...L("LMG", ["Spitfire", "Devotion", "L-STAR", "Rampage"]),
    ...L("Marksman", ["G7 Scout", "Triple Take", "30-30 Repeater", "Bocek"]),
    ...L("Sniper", ["Longbow", "Charge Rifle", "Sentinel", "Kraber"]),
    ...L("Shotgun", ["Peacekeeper", "EVA-8", "Mastiff", "Mozambique"]),
    ...L("Pistol", ["Wingman", "RE-45", "P2020"]),
  ] },
  { key: "games", icon: "🎮", entries: null }, // filled from the site's games + a few classics
  { key: "drop", icon: "🪂", entries: L("", ["Hot drop", "Edge of the map", "Follow the jumpmaster", "Furthest point", "Closest to the ship", "Wherever the last person pings"]) },
];
const presetEntries = (p) => p.entries || [...new Set([...(SITE.games || []).map((g) => g.name || g.id), "Apex Legends", "Minecraft", "League of Legends", "Marvel Rivals", "Fortnite", "Valorant", "Rocket League", "Among Us"])].filter(Boolean).map((name) => ({ name }));

const COLORS = ["#e8b33d", "#4fb3e8", "#e8584f", "#5ec46d", "#b48cff", "#f08a3c", "#3cc9b5", "#e86fae", "#8a93a8", "#d9d14a"];
const splitLines = (txt) => txt.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [name, tag] = l.split("|").map((x) => x.trim()); return { name, tag: tag || undefined }; });
const toLines = (entries) => entries.map((e) => (e.tag ? `${e.name} | ${e.tag}` : e.name)).join("\n");

export async function mountWheels(el, user) {
  let d = await api("/api/wheels");
  // current wheel being spun: { id?, title, entries, shared, mine, preset? }
  let cur = null, pool = [], tags = new Set(), rot = 0, spinning = false, history = [];
  let removeAfter = false, people = "";

  const allTags = () => [...new Set(cur.entries.map((e) => e.tag).filter(Boolean))];
  const activePool = () => pool.filter((e) => !tags.size || tags.has(e.tag));
  const open = (w) => { cur = { ...w, entries: w.entries.map((e) => ({ ...e })) }; pool = cur.entries.map((e) => ({ ...e })); tags = new Set(); history = []; rot = 0; draw(); };

  function wheelSVG(items) {
    const n = items.length;
    if (!n) return `<div class="wh-empty">${t("wh.emptyPool")}</div>`;
    const R = 160, seg = (2 * Math.PI) / n;
    const pt = (a, r = R) => `${(R + 6 + r * Math.sin(a)).toFixed(2)},${(R + 6 - r * Math.cos(a)).toFixed(2)}`;
    const slices = items.map((e, i) => {
      const a0 = i * seg, a1 = (i + 1) * seg, mid = (a0 + a1) / 2;
      const path = n === 1 ? `<circle cx="${R + 6}" cy="${R + 6}" r="${R}" fill="${COLORS[0]}"/>` : `<path d="M${R + 6},${R + 6} L${pt(a0)} A${R},${R} 0 ${seg > Math.PI ? 1 : 0} 1 ${pt(a1)} Z" fill="${COLORS[i % COLORS.length]}"/>`;
      const fs = n > 40 ? 8 : n > 24 ? 10 : n > 14 ? 12 : 14;
      const label = e.name.length > 16 ? e.name.slice(0, 15) + "…" : e.name;
      return `${path}<text transform="rotate(${((mid * 180) / Math.PI - 90).toFixed(2)} ${R + 6} ${R + 6})" x="${2 * R - 6}" y="${R + 6}" text-anchor="end" dominant-baseline="middle" font-size="${fs}" class="wh-lbl">${esc(label)}</text>`;
    }).join("");
    return `<svg viewBox="0 0 ${2 * R + 12} ${2 * R + 12}" class="wh-svg"><g id="wh-rot" style="transform:rotate(${rot}deg);transform-origin:50% 50%">${slices}</g>
      <circle cx="${R + 6}" cy="${R + 6}" r="${R}" fill="none" stroke="#5a3a1e" stroke-width="6"/><circle cx="${R + 6}" cy="${R + 6}" r="18" fill="#20160c" stroke="#c9a227" stroke-width="3"/></svg>`;
  }

  function listHTML() {
    const mine = d.wheels.filter((w) => w.mine), shared = d.wheels.filter((w) => !w.mine);
    const item = (w) => `<button class="wh-item ${cur && cur.id === w.id ? "on" : ""}" data-open="${w.id}">${esc(w.title)} <span class="small muted">${w.entries.length}${w.mine ? (w.shared ? " · 🌐" : "") : ` · ${esc(w.owner)}`}</span></button>`;
    return `
      <b class="small muted">${t("wh.presets")}</b>
      ${PRESETS.map((p) => `<button class="wh-item ${cur?.preset === p.key ? "on" : ""}" data-preset="${p.key}">${p.icon} ${t(`wh.p.${p.key}`)}</button>`).join("")}
      <b class="small muted">${t("wh.mine")}</b>
      ${mine.map(item).join("") || `<span class="hint">${t("wh.noneMine")}</span>`}
      <button class="small-btn" data-new>➕ ${t("wh.new")}</button>
      ${shared.length ? `<b class="small muted">${t("wh.shared")}</b>${shared.map(item).join("")}` : ""}`;
  }

  function draw() {
    const items = cur ? activePool() : [];
    el.innerHTML = `
      <p class="muted">${t("wh.intro")}</p>
      <div class="wh-layout">
        <aside class="card wh-list">${listHTML()}</aside>
        <div class="wh-main">${!cur ? `<p class="muted">${t("wh.pick")}</p>` : `
          <div class="wh-head"><h3>${esc(cur.title)}</h3>
            <span class="small muted">${t("wh.left", { n: items.length, total: cur.entries.length })}</span><span style="flex:1"></span>
            <button class="small-btn" data-edit>✏️ ${cur.preset || !cur.mine ? t("wh.copy") : t("wh.edit")}</button>
            ${cur.mine && cur.id ? `<button class="small-btn danger" data-del>🗑</button>` : ""}</div>
          ${allTags().length ? `<div class="chips wh-tags">${allTags().map((g) => `<button class="${tags.has(g) ? "active" : ""}" data-tag="${esc(g)}">${esc(g)}</button>`).join("")}
            ${tags.size ? `<button class="link" data-tags-clear>${t("wh.allTags")}</button>` : ""}</div>` : ""}
          <div class="wh-stage"><div class="wh-pointer">▼</div>${wheelSVG(items)}</div>
          <div class="wh-opts">
            <label class="small"><input type="checkbox" id="wh-remove" ${removeAfter ? "checked" : ""}> ${t("wh.removeAfter")}</label>
            <label class="small wh-people">${t("wh.people")} <input id="wh-people" value="${esc(people)}" placeholder="${esc(t("wh.peoplePh"))}"></label>
          </div>
          <div class="lfg-row"><button class="primary wh-go" data-spin ${items.length && !spinning ? "" : "disabled"}>🎲 ${t(people.trim() ? "wh.spinAll" : "wh.spin")}</button>
            <button class="small-btn" data-reset>↺ ${t("wh.reset")}</button>
            ${history.length ? `<button class="small-btn" data-copy>📋 ${t("wh.copyRes")}</button>` : ""}</div>
          <div class="wh-res" id="wh-res">${history.map((h) => `<div class="wh-hit">${h.who ? `<b>${esc(h.who)}</b> → ` : ""}<span>${esc(h.name)}</span>${h.tag ? ` <span class="small muted">${esc(h.tag)}</span>` : ""}</div>`).join("")}</div>
          <div id="wh-editor"></div>`}
        </div>
      </div>`;
  }

  const spinOnce = async () => {
    const items = activePool();
    if (!items.length) return null;
    const i = Math.floor(Math.random() * items.length);
    const seg = 360 / items.length;
    const target = 360 - (i * seg + seg / 2);
    rot = rot - (rot % 360) + 360 * 4 + target;
    const g = el.querySelector("#wh-rot");
    g.style.transition = "transform 3.2s cubic-bezier(.17,.67,.12,1)";
    g.style.transform = `rotate(${rot}deg)`;
    await new Promise((ok) => setTimeout(ok, 3300));
    return items[i];
  };

  function editor() {
    const box = el.querySelector("#wh-editor");
    const copy = cur.preset || !cur.mine;
    box.innerHTML = `<form class="card wh-ed">
      <label>${t("wh.name")}<input name="title" maxlength="50" required value="${esc(copy ? `${cur.title}${cur.preset ? "" : " (copia)"}` : cur.title)}"></label>
      <label>${t("wh.options")}<textarea name="lines" rows="10">${esc(toLines(cur.entries))}</textarea></label>
      <p class="hint">${t("wh.optionsHint")}</p>
      <label class="small"><input type="checkbox" name="shared" ${cur.shared && !copy ? "checked" : ""}> 🌐 ${t("wh.share")}</label>
      <div class="lfg-row"><button class="primary">${t("wh.save")}</button><button type="button" class="small-btn" data-ed-cancel>${t("cancel")}</button></div></form>`;
    const f = box.querySelector("form");
    f.querySelector("[data-ed-cancel]").onclick = () => (box.innerHTML = "");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const entries = splitLines(f.lines.value);
      try {
        const r = await api("/api/wheels", { method: "POST", body: { action: "save", id: copy ? undefined : cur.id, title: f.title.value, entries, shared: f.shared.checked } });
        d = await api("/api/wheels");
        toast(t("wh.saved"));
        open(d.wheels.find((w) => w.id === r.id));
      } catch (x) { toast(x.message, true); }
    };
    f.title.focus();
  }

  el.addEventListener("click", async (e) => {
    const q = (s) => e.target.closest(s);
    if (q("[data-preset]")) { const p = PRESETS.find((x) => x.key === q("[data-preset]").dataset.preset); return open({ title: `${p.icon} ${t(`wh.p.${p.key}`)}`, entries: presetEntries(p), preset: p.key, mine: false }); }
    if (q("[data-open]")) return open(d.wheels.find((w) => w.id === +q("[data-open]").dataset.open));
    if (q("[data-new]")) { open({ title: t("wh.newTitle"), entries: [{ name: "A" }, { name: "B" }], mine: true }); return editor(); }
    if (q("[data-edit]")) return editor();
    if (q("[data-del]")) {
      if (!(await ask(t("wh.delQ"), { danger: true }))) return;
      try { await api("/api/wheels", { method: "POST", body: { action: "delete", id: cur.id } }); d = await api("/api/wheels"); cur = null; draw(); } catch (x) { toast(x.message, true); }
      return;
    }
    if (q("[data-tag]")) { const g = q("[data-tag]").dataset.tag; tags.has(g) ? tags.delete(g) : tags.add(g); return draw(); }
    if (q("[data-tags-clear]")) { tags.clear(); return draw(); }
    if (q("[data-reset]")) { pool = cur.entries.map((x) => ({ ...x })); history = []; return draw(); }
    if (q("[data-copy]")) {
      const txt = `🎲 ${cur.title}\n` + history.map((h) => `${h.who ? `${h.who} → ` : ""}${h.name}`).join("\n");
      try { await navigator.clipboard.writeText(txt); toast(t("wh.copied")); } catch { toast(txt); }
      return;
    }
    if (q("[data-spin]")) {
      if (spinning) return;
      removeAfter = el.querySelector("#wh-remove").checked;
      people = el.querySelector("#wh-people").value;
      const names = people.split(",").map((s) => s.trim()).filter(Boolean);
      spinning = true; q("[data-spin]").disabled = true;
      const round = [];
      // one spin per person (each gets a different pick), or a single spin
      for (const who of names.length ? names : [null]) {
        const pick = await spinOnce();
        if (!pick) break;
        round.push({ ...pick, who });
        if (removeAfter || names.length) pool.splice(pool.findIndex((x) => x.name === pick.name && x.tag === pick.tag), 1);
        el.querySelector("#wh-res").insertAdjacentHTML("afterbegin", `<div class="wh-hit new">${who ? `<b>${esc(who)}</b> → ` : ""}<span>${esc(pick.name)}</span></div>`);
        if (names.length) { draw(); await new Promise((ok) => setTimeout(ok, 350)); }
      }
      // with several people the pool shrinks only for this round, unless "remove after" is on
      if (names.length && !removeAfter) for (const p of round) pool.push({ name: p.name, tag: p.tag });
      history = [...round, ...history].slice(0, 30);
      spinning = false;
      draw();
    }
  });
  el.addEventListener("change", (e) => {
    if (e.target.id === "wh-remove") removeAfter = e.target.checked;
    if (e.target.id === "wh-people") { people = e.target.value; const b = el.querySelector("[data-spin]"); if (b) b.textContent = `🎲 ${t(people.trim() ? "wh.spinAll" : "wh.spin")}`; }
  });
  void user;
  draw();
}
