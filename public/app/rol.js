// 🐉 Rol: async tabletop RPG. Campaign list → campaign page (story, party, your turn, narrator panel).
import { api, esc, t, initPage, toast, ago } from "./common.js";
import { lang } from "./i18n.js";

const user = await initPage();
const main = document.getElementById("main");
const q = new URLSearchParams(location.search);
const SIMPLE = ["fuerza", "agilidad", "mente", "carisma"];
const ADV = ["fue", "des", "con", "int", "sab", "car"];
const ARRAY = [15, 14, 13, 12, 10, 8];
const CLASSES = { guerrero: "⚔️", picaro: "🗡️", mago: "🔮", clerigo: "✨", explorador: "🏹", bardo: "🎻" };
const ICONS = ["🧙", "🧝", "🧛", "🧟", "🦹", "🥷", "🧚", "🐺", "🦊", "🐉", "🤖", "👑", "🏹", "🛡️", "🔥", "💀"];
const mod = (v) => Math.floor((v - 10) / 2);
const sign = (n) => (n >= 0 ? "+" : "") + n;
const av = (u) => `<img class="soc-av" src="${esc(u?.avatar || "")}" alt="" onerror="this.style.visibility='hidden'">`;
// tiny markdown: paragraphs, **bold**, *italic*
const md = (s) => esc(s || "").split(/\n{2,}/).map((p) => `<p>${p.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/\n/g, "<br>")}</p>`).join("");
const left = (ms) => { const s = Math.max(0, ms - Date.now()) / 1000; return s > 86400 ? `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`; };
let poll = null;

if (!user || user.role === "pending") main.innerHTML = `<section><h1>🐉 ${t("rol.title")}</h1><p class="muted">${t("lfg.emptyGuest")}</p></section>`;
else if (q.get("c")) campaign(+q.get("c")).catch((x) => (main.innerHTML = `<section><p class="muted">${esc(x.message)}</p></section>`));
else list().catch((x) => (main.innerHTML = `<section><p class="muted">${esc(x.message)}</p></section>`));

/* ---------------- list ---------------- */

async function list() {
  const d = await api("/api/rpg");
  main.innerHTML = `
    <section>
      <div class="section-head"><h1>🐉 ${t("rol.title")}</h1><button class="primary" id="rp-new">+ ${t("rol.new")}</button></div>
      <p class="muted">${t("rol.intro")}</p>
      <div id="rp-form"></div>
      <div class="rp-grid">${d.campaigns.map((c) => `
        <a class="card rp-card ${c.status}" href="/rol?c=${c.id}">
          <div class="rp-card-top"><b>${esc(c.title)}</b><span class="rp-chip ${c.status}">${t("rol.st." + c.status)}</span></div>
          <div class="small muted">${t("rol.rules." + c.rules)} · ${t("rol.dm." + c.dm_mode)} · ${av({ avatar: c.dm_avatar })} ${esc(c.dm_name)}</div>
          ${c.setting ? `<div class="small rp-setting">${esc(c.setting.slice(0, 140))}${c.setting.length > 140 ? "…" : ""}</div>` : ""}
          <div class="small">👥 ${c.players}/${c.max_players} · 📜 ${t("rol.scenes", { n: c.scenes || 0 })}${c.deadline ? ` · ⏳ ${left(c.deadline)}` : ""}</div>
          ${c.joined && c.deadline && !c.acted ? `<div class="rp-yourturn">🎲 ${t("rol.yourTurn")}</div>` : c.status === "recruiting" && !c.joined ? `<div class="small lfg-ok">${t("rol.open")}</div>` : ""}
        </a>`).join("") || `<p class="muted">${t("rol.none")}</p>`}</div>
    </section>`;
  main.querySelector("#rp-new").onclick = () => newForm(main.querySelector("#rp-form"), d.ai);
}

function newForm(box, ai) {
  if (box.innerHTML) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <form class="card lfg-form rp-new">
      <label>${t("rol.f.title")}<input name="title" maxlength="80" required placeholder="${esc(t("rol.f.titlePh"))}"></label>
      <label>${t("rol.f.setting")}<textarea name="setting" rows="3" maxlength="1200" placeholder="${esc(t("rol.f.settingPh"))}"></textarea></label>
      <div class="rp-choice"><b>${t("rol.f.rules")}</b>
        <label class="card"><input type="radio" name="rules" value="simple" checked> <b>${t("rol.rules.simple")}</b><span class="small muted">${t("rol.rules.simpleD")}</span></label>
        <label class="card"><input type="radio" name="rules" value="advanced"> <b>${t("rol.rules.advanced")}</b><span class="small muted">${t("rol.rules.advancedD")}</span></label></div>
      <div class="rp-choice"><b>${t("rol.f.dm")}</b>
        <label class="card"><input type="radio" name="dm_mode" value="human" checked> <b>${t("rol.dm.human")}</b><span class="small muted">${t("rol.dm.humanD")}</span></label>
        <label class="card ${ai ? "" : "off"}"><input type="radio" name="dm_mode" value="assist" ${ai ? "" : "disabled"}> <b>${t("rol.dm.assist")}</b><span class="small muted">${t("rol.dm.assistD")}</span></label>
        <label class="card ${ai ? "" : "off"}"><input type="radio" name="dm_mode" value="ai" ${ai ? "" : "disabled"}> <b>${t("rol.dm.ai")}</b><span class="small muted">${t("rol.dm.aiD")}</span></label></div>
      ${ai ? "" : `<p class="hint">${t("rol.noAi")}</p>`}
      <div class="lfg-row"><label>${t("rol.f.turn")}<select name="turn_hours">${[12, 24, 48, 72].map((h) => `<option value="${h}" ${h === 24 ? "selected" : ""}>${h} h</option>`).join("")}</select></label>
        <label>${t("rol.f.max")}<input type="number" name="max_players" min="1" max="10" value="5"></label></div>
      <button class="primary">${t("rol.create")}</button>
    </form>`;
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api("/api/rpg", { method: "POST", body: { action: "create", title: f.title.value, setting: f.setting.value, rules: f.rules.value, dm_mode: f.dm_mode.value,
        turn_hours: +f.turn_hours.value, max_players: +f.max_players.value, lang: lang === "en" ? "en" : "es" } });
      location.href = `/rol?c=${r.id}`;
    } catch (x) { toast(x.message, true); }
  };
}

/* ---------------- campaign ---------------- */

async function campaign(id) {
  const d = await api(`/api/rpg/${id}`);
  const c = d.campaign, open = d.scenes.find((s) => s.status === "open");
  const post = (body) => api(`/api/rpg/${id}`, { method: "POST", body });
  const reload = () => campaign(id).catch((x) => toast(x.message, true));
  clearInterval(poll);
  if (c.resolving) poll = setInterval(reload, 8000);
  document.title = `${c.title} · Rol · Moikas`;
  const acted = new Set(open ? open.actions.map((a) => a.character_id) : []);
  const canJoin = !d.me && c.status !== "ended" && (c.dm_id !== user.id || c.dm_mode === "ai") && d.party.length < c.max_players;

  main.innerHTML = `
    <section>
      <p><a href="/rol">← ${t("rol.title")}</a></p>
      <div class="card rp-head">
        <div><h1>${esc(c.title)}</h1>
          <div class="small">${t("rol.rules." + c.rules)} · ${t("rol.dm." + c.dm_mode)} · ${t("rol.turnEvery", { h: c.turn_hours })} · ${av(d.dm)} ${esc(d.dm.username)}</div>
          ${c.setting ? `<div class="small muted rp-setting">${esc(c.setting)}</div>` : ""}</div>
        <span class="rp-chip ${c.status}">${t("rol.st." + c.status)}</span>
      </div>
      ${c.resolving ? `<div class="card rp-ai-working">🤖 ${t("rol.aiWorking")}</div>` : ""}
      <div class="rp-layout">
        <div class="rp-story">
          ${d.scenes.map((s) => scene(s, d)).join("") || `<p class="muted">${t(c.dm_mode === "ai" ? "rol.noScenesAi" : "rol.noScenes")}</p>`}
          ${open && d.me ? composer(open, d) : ""}
          ${open && !d.me && !d.is_dm ? `<p class="muted small">${t("rol.watching")}</p>` : ""}
          ${d.is_dm && c.status !== "ended" ? dmPanel(d, open, acted) : ""}
        </div>
        <aside class="rp-party">
          <h3>👥 ${t("rol.party")} <span class="muted small">${d.party.length}/${c.max_players}</span></h3>
          ${d.party.map((p) => charCard(p, d, open, acted)).join("") || `<p class="muted small">${t("rol.noParty")}</p>`}
          ${canJoin ? `<button class="primary" id="rp-join">🧙 ${t("rol.join")}</button><div id="rp-joinbox"></div>` : ""}
          ${d.me && c.status !== "ended" ? `<button class="link small" id="rp-leave">${t("rol.leave")}</button>` : ""}
        </aside>
      </div>
    </section>`;

  // ---- wiring
  main.querySelector("#rp-join")?.addEventListener("click", () => joinForm(main.querySelector("#rp-joinbox"), c, post, reload));
  main.querySelector("#rp-leave")?.addEventListener("click", () => confirm(t("rol.leaveQ")) && post({ action: "leave" }).then(reload));
  main.querySelectorAll("[data-kick]").forEach((b) => (b.onclick = () => confirm(t("rol.kickQ")) && post({ action: "kick", character_id: +b.dataset.kick }).then(reload)));
  main.querySelector("#rp-notes")?.addEventListener("change", (e) => post({ action: "sheet", notes: e.target.value }).then(() => toast("✓")));
  bindComposer(c, d, open, post, reload);
  bindDm(c, d, open, post, reload);
  if (open && d.me && !acted.has(d.me.id)) main.querySelector("#rp-act")?.scrollIntoView({ block: "center" });
}

function scene(s, d) {
  const party = new Map(d.party.map((p) => [p.id, p]));
  return `
    <article class="card rp-scene ${s.status}">
      <div class="rp-scene-head"><b>📜 ${t("rol.scene", { n: s.num })}</b><span class="small muted">${s.author === "ai" ? "🤖 " + t("rol.byAi") : "🎲 " + t("rol.byDm")} · ${esc(ago(s.opened_at))}</span>
        ${s.status === "open" ? `<span class="rp-chip active">⏳ ${t("rol.closesIn", { left: left(s.deadline) })}</span>` : ""}</div>
      ${s.effects.length ? `<div class="rp-effects">${s.effects.map((e) => effectChip(e)).join("")}</div>` : ""}
      <div class="rp-narr">${md(s.narration)}</div>
      ${s.actions.length ? `<div class="rp-actions">${s.actions.map((a) => { const p = party.get(a.character_id); return `
        <div class="rp-act"><span class="rp-ico">${esc(p?.icon || "❔")}</span><div><b>${esc(p?.name || "?")}</b> <span class="small muted">${esc(p?.username || "")}</span>
          <div>${esc(a.text)}</div>${a.rolls.map(rollChip).join("")}</div></div>`; }).join("")}</div>` : ""}
      ${s.status === "open" ? `<div class="small muted">${t("rol.acted", { n: s.actions.length, of: d.party.length })}${d.party.filter((p) => !s.actions.some((a) => a.character_id === p.id)).map((p) => ` · <span>${esc(p.icon)} ${esc(p.name)}</span>`).join("")}</div>` : ""}
    </article>`;
}
const rollLabel = (l) => (SIMPLE.includes(l) ? t("rol.s." + l) : ADV.includes(l) ? l.toUpperCase() : l);
const rollChip = (r) => `<span class="rp-roll ${r.nat === 20 ? "crit" : r.nat === 1 ? "fumble" : ""}" title="${esc(r.rolls.join(", "))}">🎲 ${r.label ? `<b>${esc(rollLabel(r.label))}</b> ` : ""}${esc(r.expr)} → <b>${r.total}</b>${r.rolls.length > 1 ? ` <span class="muted">(${r.rolls.join(", ")})</span>` : ""}${r.nat === 20 ? " ✨" : r.nat === 1 ? " 💥" : ""}</span>`;
const effectChip = (e) => [
  e.hp_change ? `<span class="rp-eff ${e.hp_change < 0 ? "bad" : "good"}">${esc(e.name)} ❤ ${sign(e.hp_change)}</span>` : "",
  e.xp ? `<span class="rp-eff">${esc(e.name)} +${e.xp} XP</span>` : "",
  e.gold ? `<span class="rp-eff">${esc(e.name)} 🪙 ${sign(e.gold)}</span>` : "",
  ...(e.items_add || []).map((i) => `<span class="rp-eff good">${esc(e.name)} 🎒 ${esc(i)}</span>`),
  ...(e.items_remove || []).map((i) => `<span class="rp-eff">${esc(e.name)} ✖ ${esc(i)}</span>`),
  e.level_up ? `<span class="rp-eff lvl">⬆️ ${esc(e.name)} ${t("rol.level")} ${e.level_up}</span>` : "",
  e.down ? `<span class="rp-eff bad">💀 ${esc(e.name)} ${t("rol.down")}</span>` : "",
].join("");

function charCard(p, d, open, acted) {
  const c = d.campaign, pct = Math.round((p.hp / Math.max(1, p.max_hp)) * 100);
  const stats = c.rules === "simple" ? SIMPLE.map((k) => `<span><b>${t("rol.s." + k)}</b> ${sign(p.stats[k])}</span>`).join("")
    : ADV.map((k) => `<span><b>${k.toUpperCase()}</b> ${p.stats[k]} <i>(${sign(mod(p.stats[k]))})</i></span>`).join("");
  return `
    <div class="card rp-char ${p.mine ? "mine" : ""} ${p.hp <= 0 ? "dead" : ""}">
      <div class="rp-char-head"><span class="rp-ico big">${esc(p.icon || "🧙")}</span>
        <div><b>${esc(p.name)}</b><div class="small muted">${p.class ? esc(t("rol.c." + p.class)) + " · " : ""}${t("rol.level")} ${p.level} · ${av(p)} ${esc(p.username)}</div></div>
        ${open ? `<span class="small" title="${esc(t(acted.has(p.id) ? "rol.hasActed" : "rol.waiting"))}">${acted.has(p.id) ? "✅" : "⏳"}</span>` : ""}</div>
      <div class="rp-hp"><i style="width:${pct}%" class="${pct <= 25 ? "low" : ""}"></i><span>❤ ${p.hp}/${p.max_hp}</span></div>
      <div class="small">🛡 ${c.rules === "simple" ? t("rol.defense") : "CA"} ${p.ac} · 🪙 ${p.gold} · ⭐ ${p.xp} XP</div>
      ${p.mine || d.is_dm ? `<div class="rp-stats small">${stats}</div>
        ${p.inventory.length ? `<div class="small">🎒 ${p.inventory.map(esc).join(" · ")}</div>` : ""}
        ${p.concept ? `<div class="small muted">${esc(p.concept)}</div>` : ""}
        ${p.mine ? `<textarea id="rp-notes" rows="2" maxlength="1500" placeholder="${esc(t("rol.notesPh"))}">${esc(p.notes || "")}</textarea>` : ""}
        ${d.is_dm && !p.mine ? `<button class="link small" data-kick="${p.id}">${t("rol.kick")}</button>` : ""}` : ""}
    </div>`;
}

/* ---------------- your turn ---------------- */

function composer(open, d) {
  const mine = open.actions.find((a) => a.character_id === d.me.id);
  const c = d.campaign, stats = c.rules === "simple" ? SIMPLE : ADV;
  return `
    <form class="card rp-compose" id="rp-act">
      <b>🎲 ${mine ? t("rol.yourAction") : t("rol.whatDo", { name: esc(d.me.name) })}</b>
      <textarea name="text" rows="4" maxlength="1500" required placeholder="${esc(t("rol.actPh"))}">${esc(mine?.text || "")}</textarea>
      ${mine?.rolls.length ? `<div>${mine.rolls.map(rollChip).join("")}</div>` : ""}
      <div class="rp-dice">
        <span class="small">${t("rol.addRoll")}:</span>
        <select name="stat"><option value="">${t("rol.check")}…</option>${stats.map((k) => `<option value="${k}">${c.rules === "simple" ? t("rol.s." + k) : k.toUpperCase()} (${sign(c.rules === "simple" ? d.me.stats[k] : mod(d.me.stats[k]))})</option>`).join("")}</select>
        ${c.rules === "advanced" ? `<label class="small"><input type="checkbox" name="prof"> ${t("rol.prof")}</label>` : ""}
        <select name="adv"><option value="">${t("rol.normal")}</option><option value="adv">${t("rol.adv")}</option><option value="dis">${t("rol.dis")}</option></select>
        <input name="label" maxlength="40" placeholder="${esc(t("rol.rollFor"))}" style="max-width:150px">
        <button type="button" class="small-btn" data-addroll>+ ${t("rol.check")}</button>
        <input name="expr" maxlength="20" placeholder="2d6+1" style="max-width:90px"><button type="button" class="small-btn" data-adddice>+ ${t("rol.dice")}</button>
      </div>
      <div id="rp-queued"></div>
      <p class="hint">${t("rol.rollHint")}</p>
      <button class="primary">${mine ? t("rol.update") : t("rol.send")}</button>
    </form>`;
}
function bindComposer(c, d, open, post, reload) {
  const f = main.querySelector("#rp-act");
  if (!f) return;
  const queued = [];
  const draw = () => (f.querySelector("#rp-queued").innerHTML = queued.map((r, i) => `<span class="rp-roll pending">🎲 ${esc(r.label || r.stat || r.expr)} ${r.stat ? (r.adv ? `(${t("rol." + r.adv)})` : "") : esc(r.expr)} <button type="button" class="link" data-rm="${i}">✕</button></span>`).join(""));
  f.addEventListener("click", (e) => { const rm = e.target.closest("[data-rm]"); if (rm) { queued.splice(+rm.dataset.rm, 1); draw(); } });
  f.querySelector("[data-addroll]").onclick = () => {
    if (!f.stat.value) return toast(t("rol.pickStat"), true);
    queued.push({ stat: f.stat.value, prof: !!f.prof?.checked, adv: f.adv.value || null, label: f.label.value.trim() || null });
    f.label.value = ""; draw();
  };
  f.querySelector("[data-adddice]").onclick = () => {
    if (!/^\d{0,2}d\d{1,3}\s*([+-]\s*\d{1,3})?$/i.test(f.expr.value.trim())) return toast(t("rol.badDice"), true);
    queued.push({ expr: f.expr.value.trim(), label: f.label.value.trim() || null }); f.expr.value = ""; f.label.value = ""; draw();
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector("button.primary"); btn.disabled = true;
    try {
      const r = await post({ action: "act", text: f.text.value, rolls: queued });
      const fresh = r.rolls.slice(-queued.length || r.rolls.length);
      toast(queued.length ? `🎲 ${fresh.map((x) => `${x.label || x.expr}: ${x.total}`).join(" · ")}` : t("rol.sent"));
      reload();
    } catch (x) { toast(x.message, true); btn.disabled = false; }
  };
}

function joinForm(box, c, post, reload) {
  if (box.innerHTML) { box.innerHTML = ""; return; }
  const simple = c.rules === "simple";
  box.innerHTML = `
    <form class="card lfg-form rp-joinform">
      <label>${t("rol.j.name")}<input name="name" maxlength="40" required></label>
      <div class="rp-icons">${ICONS.map((i, n) => `<label><input type="radio" name="icon" value="${i}" ${n ? "" : "checked"}><span>${i}</span></label>`).join("")}</div>
      ${simple ? "" : `<div class="small"><b>${t("rol.j.class")}</b></div><div class="rp-classes">${Object.entries(CLASSES).map(([k, i], n) => `<label class="card"><input type="radio" name="class" value="${k}" ${n ? "" : "checked"}> ${i} <b>${t("rol.c." + k)}</b><span class="small muted">${t("rol.cd." + k)}</span></label>`).join("")}</div>`}
      <div class="small"><b>${simple ? t("rol.j.simpleStats") : t("rol.j.advStats")}</b></div>
      <div class="rp-assign">${(simple ? SIMPLE : ADV).map((k, i) => `<label>${simple ? t("rol.s." + k) : k.toUpperCase()}<select name="st_${k}">${(simple ? [2, 1, 1, 0] : ARRAY).map((v, j) => `<option ${j === i ? "selected" : ""}>${v}</option>`).join("")}</select>
        <span class="small muted">${simple ? t("rol.sd." + k) : t("rol.sd." + k)}</span></label>`).join("")}</div>
      <div class="small" id="rp-preview"></div>
      <label>${t("rol.j.concept")}<textarea name="concept" rows="2" maxlength="300" placeholder="${esc(t("rol.j.conceptPh"))}"></textarea></label>
      <button class="primary">${t("rol.j.create")}</button>
    </form>`;
  const f = box.querySelector("form");
  const keys = simple ? SIMPLE : ADV;
  const preview = () => {
    const st = Object.fromEntries(keys.map((k) => [k, +f[`st_${k}`].value]));
    const ok = [...Object.values(st)].sort((a, z) => z - a).join() === (simple ? "2,1,1,0" : ARRAY.join());
    let txt;
    if (simple) txt = `❤ ${10 + st.fuerza * 2} · 🛡 ${t("rol.defense")} ${10 + st.agilidad}`;
    else {
      const m = Object.fromEntries(keys.map((k) => [k, mod(st[k])]));
      const cls = f.class.value, hd = { guerrero: 10, picaro: 8, mago: 6, clerigo: 8, explorador: 10, bardo: 8 }[cls];
      const ac = { guerrero: 16, clerigo: 16, picaro: 11 + m.des, bardo: 11 + m.des, mago: 10 + m.des, explorador: 13 + m.des }[cls];
      txt = `❤ ${Math.max(1, hd + m.con)} · 🛡 CA ${ac}`;
    }
    f.querySelector("#rp-preview").innerHTML = ok ? txt : `<span class="warn">${t(simple ? "rol.j.useSimple" : "rol.j.useArray")}</span>`;
  };
  f.addEventListener("change", preview); preview();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await post({ action: "join", name: f.name.value, icon: f.icon.value, concept: f.concept.value, class: f.class?.value, stats: Object.fromEntries(keys.map((k) => [k, +f[`st_${k}`].value])) });
      toast(t("rol.joined")); reload();
    } catch (x) { toast(x.message, true); }
  };
}

/* ---------------- narrator panel ---------------- */

function dmPanel(d, open, acted) {
  const c = d.campaign, aiOk = d.ai && c.dm_mode !== "human";
  return `
    <div class="card rp-dm">
      <b>🎲 ${t("rol.dmPanel")}</b>
      ${!open ? `<p class="small muted">${t("rol.openingHow")}</p>` : `<p class="small muted">${t("rol.resolveHow", { n: acted.size, of: d.party.length })}</p>`}
      ${c.dm_mode === "ai" ? `<p class="small">🤖 ${t("rol.aiAuto")}</p>` : ""}
      <form id="rp-dmform">
        <textarea name="narration" rows="7" maxlength="8000" placeholder="${esc(t(open ? "rol.narrPh" : "rol.openPh"))}"></textarea>
        ${open && d.party.length ? `<div class="small"><b>${t("rol.effects")}</b></div><table class="rp-efftable"><thead><tr><th></th><th>❤ ±</th><th>XP</th><th>🪙 ±</th><th>🎒 +</th></tr></thead><tbody>
          ${d.party.map((p) => `<tr data-ch="${p.id}"><td>${esc(p.icon)} ${esc(p.name)} <span class="muted small">${p.hp}/${p.max_hp}</span></td><td><input type="number" name="hp" value="0"></td><td><input type="number" name="xp" value="0" min="0"></td><td><input type="number" name="gold" value="0"></td><td><input name="item" maxlength="60"></td></tr>`).join("")}
          </tbody></table>` : ""}
        <div class="lfg-row">
          ${aiOk ? `<button type="button" class="small-btn" data-draft>✨ ${t("rol.draft")}</button>` : ""}
          ${aiOk ? `<button type="button" class="small-btn" data-aigo>🤖 ${t(open ? "rol.aiResolve" : "rol.aiOpen")}</button>` : ""}
          <button class="primary">${t(open ? "rol.publish" : "rol.start")}</button>
        </div>
      </form>
      <details class="rp-settings"><summary class="small">⚙️ ${t("rol.settings")}</summary>
        <form id="rp-setform" class="lfg-form">
          <label>${t("rol.f.title")}<input name="title" maxlength="80" value="${esc(c.title)}"></label>
          <label>${t("rol.f.setting")}<textarea name="setting" rows="2" maxlength="1200">${esc(c.setting || "")}</textarea></label>
          <div class="lfg-row"><label>${t("rol.f.dm")}<select name="dm_mode">${["human", "assist", "ai"].map((m) => `<option value="${m}" ${c.dm_mode === m ? "selected" : ""} ${m !== "human" && !d.ai ? "disabled" : ""}>${t("rol.dm." + m)}</option>`).join("")}</select></label>
            <label>${t("rol.f.turn")}<input type="number" name="turn_hours" min="2" max="168" value="${c.turn_hours}"></label>
            <label>${t("rol.f.max")}<input type="number" name="max_players" min="1" max="10" value="${c.max_players}"></label></div>
          ${c.summary ? `<div class="small muted"><b>${t("rol.summary")}:</b> ${esc(c.summary)}</div>` : ""}
          <div class="lfg-row"><button class="small-btn">${t("acc.save")}</button><button type="button" class="danger" data-end>🏁 ${t("rol.end")}</button></div>
        </form></details>
    </div>`;
}
function bindDm(c, d, open, post, reload) {
  const f = main.querySelector("#rp-dmform");
  if (!f) return;
  const effects = () => [...f.querySelectorAll("tr[data-ch]")].map((r) => ({ character_id: +r.dataset.ch, hp_change: +r.querySelector("[name=hp]").value || 0,
    xp: +r.querySelector("[name=xp]").value || 0, gold: +r.querySelector("[name=gold]").value || 0, items_add: r.querySelector("[name=item]").value.trim() ? [r.querySelector("[name=item]").value.trim()] : [] }))
    .filter((e) => e.hp_change || e.xp || e.gold || e.items_add.length);
  f.querySelector("[data-draft]")?.addEventListener("click", async (e) => {
    const b = e.target; b.disabled = true; b.textContent = "✨ " + t("rol.thinking");
    try {
      const r = await post({ action: "draft" });
      f.narration.value = r.narration;
      for (const ef of r.effects || []) {
        const row = f.querySelector(`tr[data-ch="${ef.character_id}"]`);
        if (!row) continue;
        row.querySelector("[name=hp]").value = ef.hp_change || 0; row.querySelector("[name=xp]").value = ef.xp || 0;
        row.querySelector("[name=gold]").value = ef.gold || 0; row.querySelector("[name=item]").value = (ef.items_add || [])[0] || "";
      }
      toast(t("rol.draftReady"));
    } catch (x) { toast(x.message, true); }
    b.disabled = false; b.textContent = "✨ " + t("rol.draft");
  });
  f.querySelector("[data-aigo]")?.addEventListener("click", async () => {
    if (!confirm(t("rol.aiGoQ"))) return;
    try { await post({ action: open ? "resolve" : "start", ai: true }); toast(t("rol.aiStarted")); setTimeout(reload, 1500); } catch (x) { toast(x.message, true); }
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm(t(open ? "rol.publishQ" : "rol.startQ"))) return;
    try { await post({ action: open ? "resolve" : "start", narration: f.narration.value, effects: effects() }); toast(t("rol.published")); reload(); }
    catch (x) { toast(x.message, true); }
  };
  const s = main.querySelector("#rp-setform");
  s.onsubmit = async (e) => {
    e.preventDefault();
    try { await post({ action: "settings", title: s.title.value, setting: s.setting.value, dm_mode: s.dm_mode.value, turn_hours: +s.turn_hours.value, max_players: +s.max_players.value }); toast("✓"); reload(); }
    catch (x) { toast(x.message, true); }
  };
  s.querySelector("[data-end]").onclick = async () => { if (confirm(t("rol.endQ"))) { await post({ action: "end" }).catch((x) => toast(x.message, true)); reload(); } };
}
