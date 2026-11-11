// Home: "Jugando ahora" bar (Discord presence) + "¿Quién se apunta?" (looking for group).
import { api, esc, t, ago, toast, avatarHTML } from "./common.js";

const GAME_ICONS = [[/apex/i, "🎯"], [/league|lol\b/i, "⚔️"], [/forest/i, "🌲"], [/minecraft|ocaso/i, "⛏️"], [/valheim/i, "🪓"],
  [/valorant/i, "🔫"], [/fortnite/i, "🏗️"], [/rocket/i, "🚗"], [/fifa|fc ?2\d/i, "⚽"], [/call of duty|warzone/i, "🪖"]];
const icon = (g) => (GAME_ICONS.find(([re]) => re.test(g)) || [, "🎮"])[1];
const mini = (u) => `<img class="soc-av" src="${esc(u.avatar || "")}" alt="" title="${esc(u.username)}" loading="lazy" onerror="this.style.visibility='hidden'">`;

/* ---------------- Jugando ahora ---------------- */

export async function mountPlaying(el, user) {
  if (!user || user.role === "pending") { el.remove(); return; }
  const load = async () => {
    let d;
    try { d = await api("/api/presence"); } catch { return; }
    const groups = new Map();
    for (const p of d.playing) { if (!groups.has(p.game)) groups.set(p.game, []); groups.get(p.game).push(p); }
    const chips = [...groups].sort((a, b) => b[1].length - a[1].length).map(([game, ps]) => `
      <div class="soc-chip" title="${esc(ps.map((p) => p.username + (p.since ? ` · ${ago(p.since)}` : "")).join("\n"))}">
        <span class="soc-avs">${ps.slice(0, 4).map(mini).join("")}</span>
        <span><b>${esc(ps.length === 1 ? ps[0].username : t("soc.nPeople", { n: ps.length }))}</b> ${ps.some((p) => p.kind === "streaming") ? "🔴 " : ""}${icon(game)} ${esc(game)}</span>
      </div>`);
    for (const s of d.servers) chips.push(`<a class="soc-chip" href="/server?id=${encodeURIComponent(s.id)}"><span>⛏️ <b>${t("soc.nOn", { n: s.players_online })}</b> ${esc(s.name)}</span></a>`);
    el.innerHTML = chips.length
      ? `<div class="soc-bar"><span class="soc-live">🟢 ${t("soc.playingNow")}</span>${chips.join("")}</div>`
      : `<div class="soc-bar quiet"><span class="soc-live">⚪ ${t("soc.nobody")}</span><a href="#lfg">${t("soc.startOne")}</a></div>`;
  };
  await load();
  setInterval(() => { if (!document.hidden) load(); }, 60000);
}

/* ---------------- ¿Quién se apunta? ---------------- */

const SUGGEST = ["Apex Legends", "League of Legends", "Sons of the Forest", "Minecraft (Ocaso)", "Valorant", "Fortnite", "Rocket League"];

function when(p) {
  if (p.starts_at <= Date.now() + 5 * 60000) return p.starts_at < Date.now() - 10 * 60000 ? t("lfg.started", { ago: ago(p.starts_at) }) : t("lfg.now");
  const d = new Date(p.starts_at), today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return t("lfg.todayAt", { time });
  if (d.toDateString() === tomorrow.toDateString()) return t("lfg.tomorrowAt", { time });
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function postCard(p, user) {
  const left = p.slots - p.members.length;
  const slots = Array.from({ length: p.slots }, (_, i) => p.members[i]
    ? `<span class="lfg-slot on" title="${esc(p.members[i].username)}">${mini(p.members[i])}</span>`
    : `<span class="lfg-slot"></span>`).join("");
  let btn = "";
  if (user && user.role !== "pending") {
    if (p.mine) btn = `<button class="small-btn" data-lfg="close" data-id="${p.id}">${t("lfg.close")}</button>`;
    else if (p.joined) btn = `<button class="small-btn" data-lfg="leave" data-id="${p.id}">${t("lfg.leave")}</button>`;
    else if (!p.full) btn = `<button class="primary" data-lfg="join" data-id="${p.id}">🙋 ${t("lfg.join")}</button>`;
  }
  return `
    <div class="card lfg-post ${p.full ? "full" : ""} ${p.joined ? "joined" : ""}">
      <div class="lfg-top">
        <div class="lfg-game">${icon(p.game)}</div>
        <div class="lfg-info"><b>${esc(p.game)}</b>
          <div class="small muted">${esc(when(p))} · ${t("lfg.by", { name: esc(p.host.username) })}</div>
          ${p.note ? `<div class="lfg-note">${esc(p.note)}</div>` : ""}</div>
        <div class="lfg-act">${btn}</div>
      </div>
      <div class="lfg-slots">${slots}<span class="small ${p.full ? "lfg-ok" : "muted"}">${p.full ? "✅ " + t("lfg.full") : t("lfg.left", { n: left })}</span></div>
    </div>`;
}

export async function mountLfg(el, user) {
  el.id = "lfg";
  let d;
  const load = async () => { d = await api("/api/lfg"); render(); };
  const render = () => {
    const can = user && user.role !== "pending";
    const games = [...new Set([...d.recent_games, ...SUGGEST])].slice(0, 10);
    el.innerHTML = `
      <div class="section-head"><h2>🙋 ${t("lfg.title")}</h2>${can ? `<button class="small-btn" id="lfg-new">+ ${t("lfg.new")}</button>` : ""}</div>
      <div id="lfg-form" class="hidden"></div>
      <div class="lfg-list">${d.posts.map((p) => postCard(p, user)).join("") || `<p class="muted small">${can ? t("lfg.empty") : t("lfg.emptyGuest")}</p>`}</div>`;
    const form = el.querySelector("#lfg-form");
    el.querySelector("#lfg-new")?.addEventListener("click", () => {
      form.classList.toggle("hidden");
      if (form.innerHTML) return;
      form.innerHTML = `
        <form class="card lfg-form">
          <label>${t("lfg.game")}<input name="game" list="lfg-games" maxlength="60" required placeholder="Apex Legends"></label>
          <datalist id="lfg-games">${games.map((g) => `<option value="${esc(g)}">`).join("")}</datalist>
          <div class="lfg-quick">${games.slice(0, 6).map((g) => `<button type="button" class="chip" data-g="${esc(g)}">${icon(g)} ${esc(g)}</button>`).join("")}</div>
          <div class="lfg-row">
            <label>${t("lfg.when")}<select name="when"><option value="now">${t("lfg.now")}</option><option value="at">${t("lfg.pickTime")}</option></select></label>
            <label class="lfg-at hidden">${t("lfg.time")}<input type="datetime-local" name="at"></label>
            <label>${t("lfg.slots")}<input type="number" name="slots" min="2" max="30" value="3"></label>
          </div>
          <label>${t("lfg.note")}<input name="note" maxlength="200" placeholder="${esc(t("lfg.notePh"))}"></label>
          <div class="lfg-row"><button class="primary">${t("lfg.post")}</button>${d.discord ? `<span class="hint">${t("lfg.discordHint")}</span>` : ""}</div>
        </form>`;
      const f = form.querySelector("form");
      f.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => {
        f.game.value = b.dataset.g;
        f.slots.value = /apex/i.test(b.dataset.g) ? 3 : /league/i.test(b.dataset.g) ? 5 : /forest/i.test(b.dataset.g) ? 8 : f.slots.value;
      }));
      f.when.onchange = () => f.querySelector(".lfg-at").classList.toggle("hidden", f.when.value !== "at");
      f.onsubmit = async (e) => {
        e.preventDefault();
        const starts = f.when.value === "at" && f.at.value ? new Date(f.at.value).getTime() : null;
        try {
          await api("/api/lfg", { method: "POST", body: { game: f.game.value.trim(), note: f.note.value.trim(), slots: +f.slots.value, starts_at: starts } });
          toast(t("lfg.posted")); form.innerHTML = ""; await load();
        } catch (x) { toast(x.message, true); }
      };
    });
    el.querySelectorAll("[data-lfg]").forEach((b) => (b.onclick = async () => {
      if (b.dataset.lfg === "close" && !confirm(t("lfg.closeQ"))) return;
      b.disabled = true;
      try { await api(`/api/lfg/${b.dataset.id}`, { method: "POST", body: { action: b.dataset.lfg } }); await load(); }
      catch (x) { toast(x.message, true); b.disabled = false; }
    }));
  };
  try { await load(); } catch { el.remove(); return; }
  setInterval(() => { if (!document.hidden && !el.querySelector("#lfg-form:not(.hidden)")) load().catch(() => {}); }, 30000);
}
