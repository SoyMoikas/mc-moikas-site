// "¿Cuándo pueden?": everyone paints the hours they're usually free (in their own time zone);
// the site overlays the next 7 days in YOUR time zone and suggests the best times to play together.
import { api, esc, t, toast, TZ, zonedNow, wallInput, inputToMs } from "./common.js";

const H = 3600000;
const ROWS = Array.from({ length: 24 }, (_, r) => (r + 6) % 24); // a "day" runs 6 am → 5 am, so late nights stay with the evening before
const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const fmts = new Map();
function slotAt(tz, ms) {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" })));
  const p = f.formatToParts(new Date(ms));
  return DOW[p.find((x) => x.type === "weekday").value] * 24 + (+p.find((x) => x.type === "hour").value % 24);
}
const hourLabel = (h) => new Date(Date.UTC(2024, 0, 1, h)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });
const dayName = (i, style = "short") => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(undefined, { weekday: style, timeZone: "UTC" }); // 2024-01-01 was a Monday
const av = (u) => `<img class="soc-av" src="${esc(u.avatar || "")}" alt="" title="${esc(u.username)}" loading="lazy" onerror="this.style.visibility='hidden'">`;

// The next 7 days (from today 6 am, your time) → for each hour, who's free.
function heat(people) {
  const n = zonedNow(), start = inputToMs(wallInput(n.y, n.mo, n.d, 6));
  const sets = people.map((p) => ({ ...p, set: new Set(p.slots) }));
  const cells = [];
  for (let d = 0; d < 7; d++) for (let r = 0; r < 24; r++) {
    const ms = start + (d * 24 + r) * H;
    cells.push({ d, r, ms, free: sets.filter((p) => p.set.has(slotAt(p.tz, ms))) });
  }
  return { cells, start };
}

// Best windows: the busiest future hours, stretched while at least that many people stay free.
function bestWindows(cells, max = 4) {
  const now = Date.now(), used = new Set(), out = [];
  const cand = cells.map((c, i) => ({ ...c, i })).filter((c) => c.ms + H > now && c.free.length >= 2).sort((a, b) => b.free.length - a.free.length || a.ms - b.ms);
  for (const c of cand) {
    if (out.length >= max) break;
    if (used.has(c.i)) continue;
    const k = c.free.length, ok = (j) => cells[j] && !used.has(j) && cells[j].free.length >= k && cells[j].ms + H > now;
    let a = c.i, b = c.i;
    while (ok(a - 1) && b - a < 8) a--;
    while (ok(b + 1) && b - a < 8) b++;
    for (let j = a - 1; j <= b + 1; j++) used.add(j);
    const ids = new Set(c.free.map((p) => p.id));
    for (let j = a; j <= b; j++) for (const id of [...ids]) if (!cells[j].free.some((p) => p.id === id)) ids.delete(id);
    out.push({ from: Math.max(cells[a].ms, now - (now % (15 * 60000))), to: cells[b].ms + H, n: k, people: c.free, all: c.free.filter((p) => ids.has(p.id)) });
  }
  return out.sort((x, y) => x.from - y.from);
}
const range = (w) => {
  const d = new Date(w.from), e = new Date(w.to);
  const day = d.toDateString() === new Date().toDateString() ? t("cu.today") : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return `${day} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${e.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
};

/* ---------------- Jugar → ¿Cuándo? ---------------- */

export async function mountCuando(el, user, mode = null) {
  const d = await api("/api/availability");
  if (!d.mine && mode === null) mode = "edit";
  if (mode === "edit") return editor(el, user, d);
  const { cells } = heat(d.people);
  const top = Math.max(1, ...cells.map((c) => c.free.length));
  const wins = bestWindows(cells);
  const now = Date.now();
  el.innerHTML = `
    <div class="section-head"><p class="muted" style="margin:0">${t("cu.intro", { n: d.people.length })}</p><button class="small-btn" id="cu-edit">✏️ ${t("cu.editMine")}</button></div>
    ${d.missing.length ? `<p class="small muted">${t("cu.missing")} ${d.missing.slice(0, 12).map(av).join("")}</p>` : ""}
    <h3>⭐ ${t("cu.best")}</h3>
    <div class="cu-best">${wins.map((w, i) => `
      <div class="card cu-win">
        <div><b>${esc(range(w))}</b><div class="small">${t("cu.free", { n: w.n })} ${w.people.map(av).join("")}</div></div>
        <div class="lfg-row"><button class="primary" data-lfg="${i}">🙋 ${t("cu.lfg")}</button><a class="small-btn btn" href="/play?time=${w.from}#noches">🎉 ${t("cu.night")}</a></div>
        <div class="cu-go" id="cu-go-${i}"></div>
      </div>`).join("") || `<p class="muted">${d.people.length < 2 ? t("cu.needMore") : t("cu.noOverlap")}</p>`}</div>
    <h3>🗓️ ${t("cu.week")} <span class="small muted">· ${esc(TZ)}</span></h3>
    <div class="cu-wrap"><div class="cu-grid heat" style="--cols:7">
      <div></div>${Array.from({ length: 7 }, (_, i) => `<div class="cu-h">${esc(new Date(cells[i * 24].ms).toLocaleDateString(undefined, { weekday: "short", day: "numeric" }))}</div>`).join("")}
      ${ROWS.map((h, r) => `<div class="cu-rl ${r >= 18 ? "late" : ""}">${hourLabel(h)}</div>${Array.from({ length: 7 }, (_, dd) => {
        const c = cells[dd * 24 + r], n = c.free.length, past = c.ms + H < now;
        return `<div class="cu-c ${past ? "past" : ""}" style="--a:${n ? 0.15 + (n / top) * 0.85 : 0}" title="${esc(c.free.map((p) => p.username).join(", "))}" data-c="${dd * 24 + r}">${n || ""}</div>`;
      }).join("")}`).join("")}
    </div></div>
    <div id="cu-detail" class="small"></div>`;
  el.querySelector("#cu-edit").onclick = () => mountCuando(el, user, "edit");
  el.querySelectorAll("[data-c]").forEach((c) => (c.onclick = () => {
    const x = cells[+c.dataset.c];
    el.querySelector("#cu-detail").innerHTML = `<div class="card">${esc(new Date(x.ms).toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" }))}: ${x.free.length ? x.free.map((p) => `${av(p)} ${esc(p.username)}`).join(" · ") : t("cu.nobody")}</div>`;
  }));
  el.querySelectorAll("[data-lfg]").forEach((b) => (b.onclick = () => {
    const w = wins[+b.dataset.lfg], box = el.querySelector(`#cu-go-${b.dataset.lfg}`);
    if (box.innerHTML) { box.innerHTML = ""; return; }
    box.innerHTML = `<form class="lfg-row"><input name="game" required maxlength="60" placeholder="${esc(t("cu.whatGame"))}" list="cu-games"><datalist id="cu-games">${["Apex Legends", "League of Legends", "Sons of the Forest", "Minecraft (Ocaso)", "Valorant", "Fortnite"].map((g) => `<option value="${g}">`).join("")}</datalist>
      <button class="primary">${t("cu.post")}</button></form>`;
    box.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api("/api/lfg", { method: "POST", body: { game: e.target.game.value, starts_at: w.from, slots: Math.max(2, Math.min(30, w.n)), note: t("cu.note", { names: w.people.map((p) => p.username).join(", ") }).slice(0, 200) } });
        toast(t("cu.posted")); location.href = "/#lfg";
      } catch (x) { toast(x.message, true); }
    };
  }));
}

function editor(el, user, d) {
  const tz = TZ;
  // If you saved in another zone before, convert those hours into this one.
  let mine = new Set(d.mine?.slots || []);
  if (d.mine && d.mine.tz !== tz) {
    const map = new Map(), base = Date.now() - (Date.now() % H); // walk this real week (today's DST offsets) and map their hour → your hour
    for (let k = 0; k < 168; k++) { const ms = base + k * H; map.set(slotAt(d.mine.tz, ms), slotAt(tz, ms)); }
    mine = new Set([...mine].map((s) => map.get(s)).filter((x) => x !== undefined));
  }
  const slotOf = (dow, r) => (dow * 24 + ROWS[r] + (ROWS[r] < 6 ? 24 : 0)) % 168;
  el.innerHTML = `
    <p class="muted">${t("cu.editIntro", { tz: esc(tz) })}</p>
    <div class="lfg-row cu-presets">
      <button class="small-btn" data-p="weeknights">🌙 ${t("cu.p.weeknights")}</button>
      <button class="small-btn" data-p="weekends">🎉 ${t("cu.p.weekends")}</button>
      <button class="small-btn" data-p="late">🦉 ${t("cu.p.late")}</button>
      <button class="link small" data-p="clear">${t("cu.p.clear")}</button>
    </div>
    <div class="cu-wrap"><div class="cu-grid edit" style="--cols:7" id="cu-paint">
      <div></div>${Array.from({ length: 7 }, (_, i) => `<div class="cu-h">${esc(dayName(i))}</div>`).join("")}
      ${ROWS.map((h, r) => `<div class="cu-rl ${r >= 18 ? "late" : ""}">${hourLabel(h)}</div>${Array.from({ length: 7 }, (_, dow) => `<div class="cu-c ${mine.has(slotOf(dow, r)) ? "on" : ""}" data-s="${slotOf(dow, r)}"></div>`).join("")}`).join("")}
    </div></div>
    <p class="hint">${t("cu.lateHint")}</p>
    <div class="lfg-row"><button class="primary" id="cu-save">${t("acc.save")} (<span id="cu-n">${mine.size}</span> h)</button>${d.mine ? `<button class="link" id="cu-cancel">${t("cancel")}</button>` : ""}</div>`;
  const grid = el.querySelector("#cu-paint");
  const draw = () => { grid.querySelectorAll("[data-s]").forEach((c) => c.classList.toggle("on", mine.has(+c.dataset.s))); el.querySelector("#cu-n").textContent = mine.size; };
  let painting = null;
  const paint = (c) => { if (!c?.dataset?.s) return; const s = +c.dataset.s; painting ? mine.add(s) : mine.delete(s); c.classList.toggle("on", painting); el.querySelector("#cu-n").textContent = mine.size; };
  grid.addEventListener("pointerdown", (e) => { const c = e.target.closest("[data-s]"); if (!c) return; e.preventDefault(); painting = !mine.has(+c.dataset.s); paint(c); });
  grid.addEventListener("pointermove", (e) => { if (painting === null) return; paint(document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-s]")); });
  addEventListener("pointerup", () => (painting = null));
  const PRESET = {
    weeknights: () => { for (let dw = 0; dw < 5; dw++) for (let h = 19; h <= 23; h++) mine.add(dw * 24 + h); },
    weekends: () => { for (const dw of [5, 6]) for (let h = 12; h <= 23; h++) mine.add(dw * 24 + h); for (const dw of [4, 5]) for (let h = 0; h <= 1; h++) mine.add(((dw + 1) * 24 + h) % 168); },
    late: () => { for (let dw = 0; dw < 7; dw++) for (let h = 0; h <= 2; h++) mine.add(((dw + 1) * 24 + h) % 168); },
    clear: () => mine.clear(),
  };
  el.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { PRESET[b.dataset.p](); draw(); }));
  el.querySelector("#cu-cancel")?.addEventListener("click", () => mountCuando(el, user, "view"));
  el.querySelector("#cu-save").onclick = async () => {
    try { await api("/api/availability", { method: "POST", body: { tz, slots: [...mine] } }); toast(t("cu.saved")); mountCuando(el, user, "view"); }
    catch (x) { toast(x.message, true); }
  };
}

/* ---------------- Home (Jugar pane): the next good time ---------------- */

export async function mountCuandoHome(el) {
  let d;
  try { d = await api("/api/availability"); } catch { el.remove(); return; }
  const w = bestWindows(heat(d.people).cells, 1)[0];
  el.innerHTML = w
    ? `<a class="card cu-home" href="/play#cuando"><span>🕒</span><div><b>${t("cu.homeBest")}</b> ${esc(range(w))}<div class="small">${t("cu.free", { n: w.n })} ${w.people.slice(0, 8).map(av).join("")}</div></div><span>→</span></a>`
    : d.mine ? "" : `<a class="card cu-home" href="/play#cuando"><span>🕒</span><div><b>${t("cu.homeAsk")}</b><div class="small muted">${t("cu.homeAskSub")}</div></div><span>→</span></a>`;
}
