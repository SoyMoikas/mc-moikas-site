import { ask, api, esc, t, initPage, toast, ago, inputToMs, zonedNow, wallInput } from "./common.js";
import { renderMarkdown } from "./markdown.js";

const user = await initPage();
const main = document.getElementById("main");
const id = new URLSearchParams(location.search).get("id");
const canPlay = user && user.role !== "pending";
const ICON = (g) => (/apex/i.test(g) ? "🎯" : /league|lol\b/i.test(g) ? "⚔️" : /forest/i.test(g) ? "🌲" : /minecraft/i.test(g) ? "⛏️" : "🎮");
const STATUS = { signup: "🟢", running: "▶️", done: "🏁" };
const fmt = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const FMTS = ["bracket", "double", "roundrobin", "swiss", "points", "koth"];
const fmtLabel = (x) => t(`tr.fmt.${x.format}`) + (x.config?.best_of > 1 ? ` · Bo${x.config.best_of}` : "");
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
        <div class="small muted">${esc(x.game)} · ${t(`tr.fmt.${x.format}`)} · ${x.team_size === 1 ? t("tr.solo") : t("tr.teamsOf", { n: x.team_size })}</div>
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
  const n = zonedNow();
  const local = wallInput(n.y, n.mo, n.d + 2, 20); // two days from now, 8 pm your time
  box.innerHTML = `
    <form class="card lfg-form">
      <div class="lfg-row"><label>${t("tr.fTitle")}<input name="title" required maxlength="80" placeholder="Copa Apex de Noviembre"></label>
        <label>${t("lfg.game")}<input name="game" required maxlength="60" list="tr-games" placeholder="Apex Legends"></label></div>
      <datalist id="tr-games"><option value="Apex Legends"><option value="League of Legends"><option value="Valorant"><option value="Rocket League"><option value="Minecraft"></datalist>
      <div class="lfg-row">
        <label>${t("tr.fFormat")}<select name="format">${FMTS.map((f) => `<option value="${f}">${t(`tr.fmt.${f}`)} — ${t(`tr.fmtHint.${f}`)}</option>`).join("")}</select></label>
        <label>${t("tr.fTeamSize")}<input type="number" name="team_size" min="1" max="10" value="3"></label>
        <label>${t("tr.fMax")}<input type="number" name="max_teams" min="2" max="64" value="8"></label></div>
      <div class="lfg-row"><label>${t("tr.fStart")}<input type="datetime-local" name="starts_at" value="${local}" required></label>
        <label>${t("tr.fPrize")}<input type="number" name="prize_coins" min="0" value="200"></label></div>
      <div class="lfg-row tr-opts">
        <label class="tr-o-bo">${t("tr.fBestOf")}<select name="best_of"><option value="1">Bo1</option><option value="3">Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></label>
        <label class="tr-o-sw hidden">${t("tr.fSwissRounds")}<input type="number" name="swiss_rounds" min="1" max="10" placeholder="${esc(t("tr.auto"))}"></label>
        <label class="tr-o-po hidden">${t("tr.fPlayoff")}<select name="playoff"><option value="0">${t("tr.noPlayoff")}</option><option value="2">${t("tr.top", { n: 2 })}</option><option value="4">${t("tr.top", { n: 4 })}</option><option value="8">${t("tr.top", { n: 8 })}</option></select></label>
      </div>
      <p class="hint tr-fmt-hint"></p>
      <div class="lfg-row tr-pts hidden"><label>${t("tr.fPlacement")}<input name="placement" value="12 9 7 5 4 3 3 2 2 2 1 1 1 1 1"></label>
        <label style="max-width:140px">${t("tr.fKill")}<input type="number" name="kill" min="0" step="0.5" value="1"></label></div>
      <label>${t("tr.fRules")}<textarea name="rules" rows="4" maxlength="3000" placeholder="${esc(t("tr.fRulesPh"))}"></textarea></label>
      <div class="lfg-row"><button class="primary">${t("tr.create")}</button><span class="hint">${t("tr.prizeHint")}</span></div>
    </form>`;
  const f = box.querySelector("form");
  const showOpts = () => {
    const v = f.format.value;
    f.querySelector(".tr-pts").classList.toggle("hidden", v !== "points");
    f.querySelector(".tr-o-bo").classList.toggle("hidden", v === "points");
    f.querySelector(".tr-o-sw").classList.toggle("hidden", v !== "swiss");
    f.querySelector(".tr-o-po").classList.toggle("hidden", v !== "roundrobin" && v !== "swiss");
    f.querySelector(".tr-fmt-hint").textContent = t(`tr.fmtLong.${v}`);
  };
  const presets = () => {
    if (/apex|fortnite|warzone|pubg/i.test(f.game.value)) { f.format.value = "points"; f.team_size.value = 3; f.max_teams.value = 20; }
    else if (/league|lol\b|valorant|marvel/i.test(f.game.value)) { f.format.value = "double"; f.team_size.value = 5; f.max_teams.value = 8; }
    else if (/smash|tekken|street fighter|mortal|chess|ajedrez/i.test(f.game.value)) { f.format.value = "double"; f.team_size.value = 1; f.max_teams.value = 16; }
    showOpts();
  };
  f.game.onchange = presets;
  f.format.onchange = showOpts;
  showOpts();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/tournaments", { method: "POST", body: {
        title: f.title.value, game: f.game.value, format: f.format.value, team_size: +f.team_size.value, max_teams: +f.max_teams.value,
        starts_at: inputToMs(f.starts_at.value), prize_coins: +f.prize_coins.value, rules: f.rules.value,
        points: { placement: f.placement.value, kill: +f.kill.value },
        config: { best_of: +f.best_of.value, swiss_rounds: f.swiss_rounds.value ? +f.swiss_rounds.value : null, playoff: +f.playoff.value } } });
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
  if (confirmText && !await ask(confirmText)) return;
  try {
    const r = await api(`/api/tournaments/${tr.id}`, { method: "POST", body });
    if (r.deleted) { location.href = "/tournaments"; return; }
    tr = r.tournament; staff = r.staff; render();
  } catch (x) { toast(x.message, true); }
}

const teamName = (tid) => (tid === -1 ? t("tr.bye") : tr.teams.find((x) => x.id === tid)?.name || "—");

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
          <div class="muted">${esc(tr.game)} · ${fmtLabel(tr)} · ${solo ? t("tr.solo") : t("tr.teamsOf", { n: tr.team_size })}</div>
          <div>${STATUS[tr.status]} ${t("tr.st." + tr.status)} · ${fmt(tr.starts_at)}${tr.prize_coins ? ` · 🪙 ${t("tr.prize", { n: tr.prize_coins, half: Math.floor(tr.prize_coins / 2) })}` : ""}</div></div>
        <div class="tr-head-act">${signup}</div>
      </div>
      ${winner ? `<div class="card tr-champ">🏆 <b>${t("tr.champions")}: ${esc(winner.name)}</b> ${winner.members.map(av).join("")}</div>` : ""}
      ${tr.rules ? `<details class="card tr-rules" ${tr.status === "signup" ? "open" : ""}><summary>${t("tr.rules")}</summary><div class="md">${renderMarkdown(tr.rules)}</div></details>` : ""}

      ${tr.status !== "signup" ? formatHTML() + `<div id="tr-report"></div>` : ""}

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
        ${["points", "koth", "roundrobin", "swiss"].includes(tr.format) && tr.status === "running" ? `<button data-a="finish">🏁 ${t(tr.format === "points" ? "tr.finish" : "tr.finishEarly")}</button>` : ""}
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

const betLink = () => (tr.status === "running" ? `<a class="small" href="/casino#apuestas">🪙 ${t("mk.betOnIt")}</a>` : "");
function matchHTML(m) {
  const side = (tid, score) => {
    if (tid == null) return `<div class="tr-side empty">…</div>`;
    if (tid === -1) return `<div class="tr-side empty">${t("tr.bye")}</div>`;
    const win = m.winner === tid, lose = m.winner && m.winner !== tid;
    return `<div class="tr-side ${win ? "win" : ""} ${lose ? "lose" : ""} ${tid === tr.my_team_id ? "mine" : ""}"><span>${esc(teamName(tid))}</span><b>${score ?? (win ? "✓" : "")}</b></div>`;
  };
  return `<div class="tr-match">${side(m.team_a, m.score_a)}${side(m.team_b, m.score_b)}
    ${staff && m.can_report ? `<button class="tr-report small-btn" data-match="${m.id}">${m.winner ? t("tr.edit") : t("tr.report")}</button>` : ""}</div>`;
}
// columns of matches by round
function cols(ms, label) {
  const rounds = [...new Set(ms.map((m) => m.round))].sort((a, b) => a - b);
  return `<div class="tr-bracket">${rounds.map((r, i) => `<div class="tr-round"><div class="small muted tr-r-label">${label(r, i, rounds.length)}</div>
    ${ms.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot).map(matchHTML).join("")}</div>`).join("")}</div>`;
}
const elimLabel = (r, i, n) => (i === n - 1 ? t("tr.final") : i === n - 2 ? t("tr.semis") : t("tr.round", { n: i + 1 }));
function tableHTML() {
  const rows = tr.table || [];
  const koth = tr.format === "koth";
  return `<div class="card table-wrap"><table class="tr-table"><thead><tr><th>#</th><th>${tr.team_size === 1 ? t("tr.player") : t("tr.team")}</th>
    ${koth ? `<th>${t("tr.bestStreak")}</th><th>${t("tr.wins")}</th><th>${t("tr.losses")}</th>` : `<th>${t("tr.wins")}</th><th>${t("tr.losses")}</th>${tr.format === "swiss" ? `<th title="${esc(t("tr.buchholzHint"))}">Buchholz</th>` : ""}<th>${t("tr.diff")}</th>`}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${r.team_id === tr.my_team_id ? "mine" : ""}"><td>${i + 1}</td><td><b>${esc(r.name)}</b></td>
      ${koth ? `<td><b>${r.best}</b>${r.cur > 1 ? ` <span class="small">🔥${r.cur}</span>` : ""}</td><td>${r.wins}</td><td>${r.losses}</td>`
        : `<td><b>${r.wins}</b>${r.byes ? ` <span class="small muted">(${r.byes} bye)</span>` : ""}</td><td>${r.losses}</td>${tr.format === "swiss" ? `<td>${r.buchholz}</td>` : ""}<td>${r.pf - r.pa > 0 ? "+" : ""}${r.pf - r.pa}</td>`}</tr>`).join("")}</tbody></table></div>`;
}
function formatHTML() {
  const ms = tr.matches;
  const bo = tr.config?.best_of > 1 ? ` <span class="small muted">· Bo${tr.config.best_of}</span>` : "";
  const head = (title) => `<div class="section-head"><h2>${title}${bo}</h2>${betLink()}</div>`;
  const po = ms.filter((m) => m.stage === "PO");
  const playoff = po.length ? head(`🏆 ${t("tr.playoff")}`) + cols(po, elimLabel) : "";
  let out = "";
  if (tr.format === "points") return pointsHTML();
  if (tr.format === "bracket") out = head(t("tr.bracket")) + cols(ms, elimLabel);
  else if (tr.format === "double") {
    const gf = ms.filter((m) => m.stage === "GF" && (m.round === 201 || m.team_a != null));
    out = head(`⬆️ ${t("tr.upper")}`) + cols(ms.filter((m) => m.stage === "W"), elimLabel)
      + `<h3>⬇️ ${t("tr.lower")}</h3><p class="hint">${t("tr.lowerHint")}</p>` + cols(ms.filter((m) => m.stage === "L"), (r, i) => t("tr.round", { n: i + 1 }))
      + `<h3>👑 ${t("tr.grandFinal")}</h3>` + cols(gf, (r) => (r === 202 ? t("tr.reset") : t("tr.grandFinal")));
  } else if (tr.format === "roundrobin" || tr.format === "swiss") {
    const group = ms.filter((m) => m.stage === "RR" || m.stage === "SW");
    const total = tr.format === "swiss" ? tr.config.swiss_rounds : null;
    out = playoff + head(tr.format === "swiss" ? `🧭 ${t("tr.swissTable")}` : `📋 ${t("tr.league")}`) + tableHTML()
      + (tr.config.playoff ? `<p class="hint">${t("tr.playoffHint", { n: tr.config.playoff })}</p>` : "")
      + `<h3>${t("tr.matchdays")}${total ? ` <span class="small muted">· ${t("tr.ofRounds", { n: Math.max(...group.map((m) => m.round), 0), total })}</span>` : ""}</h3>`
      + cols(group.filter((m) => m.team_b !== -1), (r) => t("tr.matchday", { n: r }));
    const byes = group.filter((m) => m.team_b === -1);
    if (byes.length) out += `<p class="hint">${byes.map((m) => t("tr.sitsOut", { name: esc(teamName(m.team_a)), n: m.round })).join(" · ")}</p>`;
    return out;
  } else if (tr.format === "koth") {
    const kh = ms.filter((m) => m.stage === "KH");
    const cur = kh.find((m) => !m.winner);
    const done = kh.filter((m) => m.winner).reverse();
    const holder = done[0]?.winner;
    out = head(`👑 ${t("tr.hill")}`)
      + (cur && tr.status === "running" ? `<div class="card tr-hill"><div class="tr-hill-k">👑 <b>${esc(teamName(cur.team_a))}</b>${holder === cur.team_a ? ` <span class="small">🔥 ${tr.table.find((r) => r.team_id === holder)?.cur || 0}</span>` : ""}</div>
          <span class="tr-vs">VS</span><div class="tr-hill-c">⚔️ <b>${esc(teamName(cur.team_b))}</b></div>
          ${staff ? `<button class="primary small-btn" data-match="${cur.id}">${t("tr.report")}</button>` : ""}</div>` : "")
      + `<p class="hint">${t("tr.kothHint")}</p>` + tableHTML()
      + (done.length ? `<h3>${t("tr.history")}</h3><div class="tr-hist">${done.slice(0, 20).map((m) => `<div class="small">#${m.round} · <b>${esc(teamName(m.winner))}</b> ${t("tr.beat")} ${esc(teamName(m.winner === m.team_a ? m.team_b : m.team_a))}${m.score_a != null ? ` (${m.winner === m.team_a ? `${m.score_a}-${m.score_b}` : `${m.score_b}-${m.score_a}`})` : ""}${staff && m.can_report ? ` <button class="link" data-match="${m.id}">${t("tr.edit")}</button>` : ""}</div>`).join("")}</div>` : "");
    return out;
  }
  return out;
}

function bindBracket() {
  main.querySelectorAll("[data-match]").forEach((b) => (b.onclick = () => {
    const m = tr.matches.find((x) => x.id === +b.dataset.match);
    const box = main.querySelector("#tr-report");
    const bo = tr.config?.best_of || 1;
    box.innerHTML = `<form class="card lfg-form"><b>${esc(teamName(m.team_a))} vs ${esc(teamName(m.team_b))}</b>${bo > 1 ? ` <span class="small muted">· ${t("tr.boHint", { n: bo, w: Math.ceil(bo / 2) })}</span>` : ""}
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
    <div class="section-head"><h2>${t("tr.standings")} <span class="small muted">· ${t("tr.gamesPlayed", { n: tr.games_played })}</span></h2>${tr.status === "running" ? `<a class="small" href="/casino#apuestas">🪙 ${t("mk.betOnIt")}</a>` : ""}</div>
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
