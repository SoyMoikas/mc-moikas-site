import { api, esc, t, initPage, toast, ago } from "./common.js";
import { renderMarkdown } from "./markdown.js";

const user = await initPage();
const main = document.getElementById("main");
const id = new URLSearchParams(location.search).get("id");
const canPlay = user && user.role !== "pending";
const ICON = (g) => (/apex/i.test(g) ? "🎯" : /league|lol\b/i.test(g) ? "⚔️" : /forest/i.test(g) ? "🌲" : /minecraft/i.test(g) ? "⛏️" : "🎮");
const STATUS = { signup: "🟢", running: "▶️", done: "🏁" };
const fmt = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const av = (m) => `<img class="soc-av" src="${esc(m.avatar || "")}" alt="" title="${esc(m.username)}" onerror="this.style.visibility='hidden'">`;

if (id) detail(); else list();

/* ---------------- list ---------------- */

async function list() {
  document.title = `${t("tr.title")} · Moikas`;
  const { tournaments } = await api("/api/tournaments");
  const staff = user && ["staff", "subadmin", "admin"].includes(user.role);
  const card = (x) => `
    <a class="card tr-card" href="/tournaments?id=${x.id}">
      <div class="tr-ico">${ICON(x.game)}</div>
      <div class="tr-c-info"><b>${esc(x.title)}</b>
        <div class="small muted">${esc(x.game)} · ${x.format === "points" ? t("tr.fmtPoints") : t("tr.fmtBracket")} · ${x.team_size === 1 ? t("tr.solo") : t("tr.teamsOf", { n: x.team_size })}</div>
        <div class="small">${STATUS[x.status]} ${t("tr.st." + x.status)} · ${x.status === "done" && x.winner ? `🏆 ${esc(x.winner)}` : fmt(x.starts_at)}</div></div>
      <div class="tr-c-side"><b>${x.teams}/${x.max_teams}</b><span class="small muted">${x.team_size === 1 ? t("tr.players") : t("tr.teams")}</span>
        ${x.prize_coins ? `<span class="small">🪙 ${x.prize_coins}</span>` : ""}${x.joined ? `<span class="small lfg-ok">✓ ${t("tr.youreIn")}</span>` : ""}</div>
    </a>`;
  const open = tournaments.filter((x) => x.status !== "done"), done = tournaments.filter((x) => x.status === "done");
  main.innerHTML = `
    <section>
      <div class="section-head"><h1>🏆 ${t("tr.title")}</h1>${staff ? `<button class="primary" id="tr-new">+ ${t("tr.new")}</button>` : ""}</div>
      <p class="muted">${t("tr.intro")}</p>
      <div id="tr-form"></div>
      <div class="tr-list">${open.map(card).join("") || `<p class="muted">${t("tr.none")}</p>`}</div>
      ${done.length ? `<h2 style="margin-top:24px">🏁 ${t("tr.past")}</h2><div class="tr-list">${done.map(card).join("")}</div>` : ""}
    </section>`;
  main.querySelector("#tr-new")?.addEventListener("click", newForm);
}

function newForm() {
  const box = main.querySelector("#tr-form");
  if (box.innerHTML) { box.innerHTML = ""; return; }
  const d = new Date(Date.now() + 2 * 86400000); d.setHours(20, 0, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  box.innerHTML = `
    <form class="card lfg-form">
      <div class="lfg-row"><label>${t("tr.fTitle")}<input name="title" required maxlength="80" placeholder="Copa Apex de Noviembre"></label>
        <label>${t("lfg.game")}<input name="game" required maxlength="60" list="tr-games" placeholder="Apex Legends"></label></div>
      <datalist id="tr-games"><option value="Apex Legends"><option value="League of Legends"><option value="Valorant"><option value="Rocket League"><option value="Minecraft"></datalist>
      <div class="lfg-row">
        <label>${t("tr.fFormat")}<select name="format"><option value="bracket">${t("tr.fmtBracket")} — ${t("tr.fmtBracketHint")}</option><option value="points">${t("tr.fmtPoints")} — ${t("tr.fmtPointsHint")}</option></select></label>
        <label>${t("tr.fTeamSize")}<input type="number" name="team_size" min="1" max="10" value="3"></label>
        <label>${t("tr.fMax")}<input type="number" name="max_teams" min="2" max="64" value="8"></label></div>
      <div class="lfg-row"><label>${t("tr.fStart")}<input type="datetime-local" name="starts_at" value="${local}" required></label>
        <label>${t("tr.fPrize")}<input type="number" name="prize_coins" min="0" value="200"></label></div>
      <div class="lfg-row tr-pts hidden"><label>${t("tr.fPlacement")}<input name="placement" value="12 9 7 5 4 3 3 2 2 2 1 1 1 1 1"></label>
        <label style="max-width:140px">${t("tr.fKill")}<input type="number" name="kill" min="0" step="0.5" value="1"></label></div>
      <label>${t("tr.fRules")}<textarea name="rules" rows="4" maxlength="3000" placeholder="${esc(t("tr.fRulesPh"))}"></textarea></label>
      <div class="lfg-row"><button class="primary">${t("tr.create")}</button><span class="hint">${t("tr.prizeHint")}</span></div>
    </form>`;
  const f = box.querySelector("form");
  const presets = () => {
    if (/apex/i.test(f.game.value)) { f.format.value = "points"; f.team_size.value = 3; f.max_teams.value = 20; }
    else if (/league|lol\b/i.test(f.game.value)) { f.format.value = "bracket"; f.team_size.value = 5; f.max_teams.value = 8; }
    f.querySelector(".tr-pts").classList.toggle("hidden", f.format.value !== "points");
  };
  f.game.onchange = presets;
  f.format.onchange = () => f.querySelector(".tr-pts").classList.toggle("hidden", f.format.value !== "points");
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/tournaments", { method: "POST", body: {
        title: f.title.value, game: f.game.value, format: f.format.value, team_size: +f.team_size.value, max_teams: +f.max_teams.value,
        starts_at: new Date(f.starts_at.value).getTime(), prize_coins: +f.prize_coins.value, rules: f.rules.value,
        points: { placement: f.placement.value, kill: +f.kill.value } } });
      location.href = `/tournaments?id=${r.id}`;
    } catch (x) { toast(x.message, true); }
  };
}

/* ---------------- detail ---------------- */

let tr, staff;
async function detail() {
  try { ({ tournament: tr, staff } = await api(`/api/tournaments/${encodeURIComponent(id)}`)); }
  catch (x) { main.innerHTML = `<p class="muted">${esc(x.message)}</p>`; return; }
  render();
}

async function act(body, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  try {
    const r = await api(`/api/tournaments/${tr.id}`, { method: "POST", body });
    if (r.deleted) { location.href = "/tournaments"; return; }
    tr = r.tournament; staff = r.staff; render();
  } catch (x) { toast(x.message, true); }
}

const teamName = (tid) => tr.teams.find((x) => x.id === tid)?.name || "—";

function render() {
  document.title = `${tr.title} · Moikas`;
  const solo = tr.team_size === 1;
  const mine = tr.my_team_id;
  const winner = tr.teams.find((x) => x.id === tr.winner_team_id);
  let signup = "";
  if (tr.status === "signup" && canPlay) {
    if (mine) signup = `<button class="small-btn" data-a="leave">${t("tr.leave")}</button>`;
    else if (tr.teams.length < tr.max_teams || !solo) signup = solo
      ? `<button class="primary" data-a="signup">🙋 ${t("tr.signup")}</button>`
      : `<form class="tr-inline" id="tr-team"><input name="team_name" maxlength="40" placeholder="${esc(t("tr.teamName"))}" required><button class="primary">${t("tr.createTeam")}</button></form>`;
  } else if (tr.status === "signup" && !canPlay) signup = `<p class="hint">${t("lfg.emptyGuest")}</p>`;

  main.innerHTML = `
    <section>
      <p><a href="/tournaments">← ${t("tr.title")}</a></p>
      <div class="card tr-head">
        <div class="tr-ico big">${ICON(tr.game)}</div>
        <div style="flex:1"><h1>${esc(tr.title)}</h1>
          <div class="muted">${esc(tr.game)} · ${tr.format === "points" ? t("tr.fmtPoints") : t("tr.fmtBracket")} · ${solo ? t("tr.solo") : t("tr.teamsOf", { n: tr.team_size })}</div>
          <div>${STATUS[tr.status]} ${t("tr.st." + tr.status)} · ${fmt(tr.starts_at)}${tr.prize_coins ? ` · 🪙 ${t("tr.prize", { n: tr.prize_coins, half: Math.floor(tr.prize_coins / 2) })}` : ""}</div></div>
        <div class="tr-head-act">${signup}</div>
      </div>
      ${winner ? `<div class="card tr-champ">🏆 <b>${t("tr.champions")}: ${esc(winner.name)}</b> ${winner.members.map(av).join("")}</div>` : ""}
      ${tr.rules ? `<details class="card tr-rules" ${tr.status === "signup" ? "open" : ""}><summary>${t("tr.rules")}</summary><div class="md">${renderMarkdown(tr.rules)}</div></details>` : ""}

      ${tr.format === "bracket" && tr.status !== "signup" ? bracketHTML() : ""}
      ${tr.format === "points" && tr.status !== "signup" ? pointsHTML() : ""}

      <h2>${solo ? t("tr.players") : t("tr.teams")} (${tr.teams.length}/${tr.max_teams})</h2>
      <div class="tr-teams">${tr.teams.map((tm) => `
        <div class="card tr-team ${tm.id === mine ? "mine" : ""}">
          <b>${esc(tm.name)}</b>${solo ? "" : ` <span class="small muted">${tm.members.length}/${tr.team_size}</span>`}
          <div class="tr-mem">${tm.members.map((m) => `<span>${av(m)} ${esc(m.username)}${!solo && m.id === tm.captain_id ? " ⭐" : ""}</span>`).join("")}</div>
          ${!solo && tr.status === "signup" && canPlay && !mine && tm.members.length < tr.team_size ? `<button class="small-btn" data-a="join_team" data-team="${tm.id}">${t("tr.joinTeam")}</button>` : ""}
          ${staff && tr.status === "signup" ? `<button class="small-btn danger" data-a="kick" data-team="${tm.id}">${t("tr.kick")}</button>` : ""}
        </div>`).join("") || `<p class="muted">${t("tr.noTeams")}</p>`}</div>

      ${staff ? `<div class="card tr-staff"><b>🛠 ${t("tr.staffTools")}</b>
        ${tr.status === "signup" ? `<button class="primary" data-a="start">▶️ ${t("tr.start")}</button>` : ""}
        ${tr.format === "points" && tr.status === "running" ? `<button data-a="finish">🏁 ${t("tr.finish")}</button>` : ""}
        <button class="danger" data-a="delete">${t("tr.delete")}</button></div>` : ""}
    </section>`;

  main.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
    const a = b.dataset.a;
    const confirms = { start: t("tr.startQ"), finish: t("tr.finishQ"), delete: t("tr.deleteQ"), kick: t("tr.kickQ"), leave: t("tr.leaveQ") };
    act({ action: a, team_id: b.dataset.team ? +b.dataset.team : undefined }, confirms[a]);
  }));
  const tf = main.querySelector("#tr-team");
  if (tf) tf.onsubmit = (e) => { e.preventDefault(); act({ action: "signup", team_name: tf.team_name.value.trim() }); };
  bindBracket(); bindPoints();
}

function bracketHTML() {
  const rounds = Math.max(0, ...tr.matches.map((m) => m.round));
  const label = (r) => (r === rounds ? t("tr.final") : r === rounds - 1 ? t("tr.semis") : t("tr.round", { n: r }));
  const side = (m, tid, score) => {
    if (!tid) return `<div class="tr-side empty">${m.round === 1 ? t("tr.bye") : "…"}</div>`;
    const win = m.winner === tid, lose = m.winner && m.winner !== tid;
    return `<div class="tr-side ${win ? "win" : ""} ${lose ? "lose" : ""} ${tid === tr.my_team_id ? "mine" : ""}"><span>${esc(teamName(tid))}</span><b>${score ?? (win ? "✓" : "")}</b></div>`;
  };
  return `<h2>${t("tr.bracket")}</h2><div class="tr-bracket">${Array.from({ length: rounds }, (_, i) => i + 1).map((r) => `
    <div class="tr-round"><div class="small muted tr-r-label">${label(r)}</div>
      ${tr.matches.filter((m) => m.round === r).map((m) => `
        <div class="tr-match">${side(m, m.team_a, m.score_a)}${side(m, m.team_b, m.score_b)}
          ${staff && tr.status === "running" && m.team_a && m.team_b ? `<button class="tr-report small-btn" data-match="${m.id}">${m.winner ? t("tr.edit") : t("tr.report")}</button>` : ""}
        </div>`).join("")}</div>`).join("")}</div><div id="tr-report"></div>`;
}

function bindBracket() {
  main.querySelectorAll("[data-match]").forEach((b) => (b.onclick = () => {
    const m = tr.matches.find((x) => x.id === +b.dataset.match);
    const box = main.querySelector("#tr-report");
    box.innerHTML = `<form class="card lfg-form"><b>${esc(teamName(m.team_a))} vs ${esc(teamName(m.team_b))}</b>
      <div class="lfg-row"><label>${esc(teamName(m.team_a))}<input type="number" name="sa" min="0" value="${m.score_a ?? ""}" placeholder="${t("tr.scoreOpt")}"></label>
        <label>${esc(teamName(m.team_b))}<input type="number" name="sb" min="0" value="${m.score_b ?? ""}" placeholder="${t("tr.scoreOpt")}"></label></div>
      <div class="lfg-row"><button class="primary" data-w="${m.team_a}">🏆 ${esc(teamName(m.team_a))}</button><button class="primary" data-w="${m.team_b}">🏆 ${esc(teamName(m.team_b))}</button></div></form>`;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    box.querySelectorAll("[data-w]").forEach((w) => (w.onclick = (e) => {
      e.preventDefault();
      const f = box.querySelector("form");
      act({ action: "report", match_id: m.id, winner: +w.dataset.w, score_a: f.sa.value, score_b: f.sb.value });
    }));
  }));
}

function pointsHTML() {
  const games = [...new Set(tr.results.map((r) => r.game_no))];
  const st = tr.standings;
  return `
    <h2>${t("tr.standings")} <span class="small muted">· ${t("tr.gamesPlayed", { n: tr.games_played })}</span></h2>
    <div class="card table-wrap"><table class="tr-table">
      <thead><tr><th>#</th><th>${tr.team_size === 1 ? t("tr.player") : t("tr.team")}</th><th>${t("tr.pts")}</th><th>${t("tr.wins")}</th><th>${t("tr.kills")}</th>
        ${games.map((g) => `<th class="small">#${g}${staff && tr.status === "running" ? ` <a href="#" data-undo="${g}" title="${esc(t("tr.undo"))}">✕</a>` : ""}</th>`).join("")}</tr></thead>
      <tbody>${st.map((s, i) => `<tr class="${s.team_id === tr.my_team_id ? "mine" : ""}"><td>${i === 0 && s.games ? "🥇" : i === 1 && s.games ? "🥈" : i === 2 && s.games ? "🥉" : i + 1}</td>
        <td><b>${esc(s.name)}</b></td><td><b>${s.points}</b></td><td>${s.wins}</td><td>${s.kills}</td>
        ${games.map((g) => { const r = tr.results.find((x) => x.game_no === g && x.team_id === s.team_id); return `<td class="small muted">${r ? `#${r.placement} · ${r.kills}K` : "—"}</td>`; }).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <p class="hint">${t("tr.pointsRule", { list: tr.points.placement.slice(0, 10).join(", "), kill: tr.points.kill })}</p>
    ${staff && tr.status === "running" ? `
    <form class="card lfg-form" id="tr-game"><b>➕ ${t("tr.addGame", { n: games.length + 1 })}</b>
      <div class="tr-entry">${tr.teams.map((tm) => `
        <div class="tr-e-row"><span>${esc(tm.name)}</span>
          <input type="number" min="1" max="99" data-place="${tm.id}" placeholder="${t("tr.place")}">
          <input type="number" min="0" max="99" data-kills="${tm.id}" placeholder="${t("tr.kills")}"></div>`).join("")}</div>
      <div class="lfg-row"><button class="primary">${t("tr.saveGame")}</button><span class="hint">${t("tr.blankHint")}</span></div>
    </form>` : ""}`;
}

function bindPoints() {
  const f = main.querySelector("#tr-game");
  if (f) f.onsubmit = (e) => {
    e.preventDefault();
    const results = tr.teams.map((tm) => ({ team_id: tm.id, placement: parseInt(f.querySelector(`[data-place="${tm.id}"]`).value), kills: parseInt(f.querySelector(`[data-kills="${tm.id}"]`).value) || 0 }))
      .filter((r) => r.placement > 0);
    act({ action: "add_game", results });
  };
  main.querySelectorAll("[data-undo]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); act({ action: "undo_game", game_no: +a.dataset.undo }, t("tr.undoQ")); }));
}
