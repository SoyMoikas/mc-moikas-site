// Casino: playable Texas Hold'em tables, a fair roulette (no zero, daily cap), IRL prize raffles and the bets.
import { ask, askText, notice, api, esc, t, initPage, toast, inputToMs } from "./common.js";
import { mountBets } from "./bets.js";

const user = await initPage();
const main = document.getElementById("main");
document.title = `${t("nav.casino")} · Moikas`;
const TABS = [["poker", "🃏"], ["ruleta", "🎡"], ["rifas", "🎟️"], ["apuestas", "🤑"]];
const av = (u, cls = "soc-av") => `<img class="${cls}" src="${esc(u.avatar || "https://cdn.discordapp.com/embed/avatars/0.png")}" alt="" title="${esc(u.name || u.username || "")}" loading="lazy" onerror="this.style.visibility='hidden'">`;
const fmt = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
let tab = "poker", timer = null;
const stopPolling = () => { clearTimeout(timer); timer = null; };

function parseHash() {
  const [h, arg] = location.hash.slice(1).split("-");
  tab = TABS.some(([k]) => k === h) ? h : "poker";
  return arg;
}

if (!user || user.role === "pending") {
  main.innerHTML = `<section><h1>🎰 ${t("nav.casino")}</h1><p class="muted">${t("cs.guest")}</p></section>`;
} else {
  frame();
  addEventListener("hashchange", frame);
}

function frame() {
  stopPolling();
  const arg = parseHash();
  main.innerHTML = `
    <section>
      <h1>🎰 ${t("nav.casino")}</h1>
      <div class="play-tabs">${TABS.map(([k, ic]) => `<a href="#${k}" class="${k === tab ? "active" : ""}">${ic} ${t(`cs.tab.${k}`)}</a>`).join("")}</div>
      <div id="cs-body"><p class="muted">${t("loading")}</p></div>
    </section>`;
  const body = main.querySelector("#cs-body");
  const run = { poker: () => (arg ? pokerTable(body, +arg) : pokerLobby(body)), ruleta: () => roulette(body), rifas: () => raffles(body), apuestas: () => mountBets(body, user) }[tab];
  run().catch((x) => (body.innerHTML = `<p class="muted">${esc(x.message)}</p>`));
}

/* =================================== POKER =================================== */
const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
const cardHTML = (c, cls = "") => !c ? `<span class="pc empty ${cls}"></span>` : c === "??" ? `<span class="pc back ${cls}"></span>`
  : `<span class="pc ${"hd".includes(c[1]) ? "red" : ""} ${cls}"><b>${c[0] === "T" ? "10" : c[0]}</b><i>${SUIT[c[1]]}</i></span>`;
const handName = (k) => (k ? t(`pk.h.${k}`) : "");

async function pokerLobby(el) {
  const d = await api("/api/casino/poker");
  el.innerHTML = `
    <p class="muted">${t("pk.intro")}</p>
    <div class="pk-lobby">${d.tables.map((tb) => `
      <a class="card pk-tcard" href="#poker-${tb.id}">
        <div class="pk-felt-mini">${tb.playing ? "🃏" : "♠"}</div>
        <div><b>${esc(tb.name)}</b>${tb.mine ? ` <span class="lfg-ok small">· ${t("pk.youSit")}</span>` : ""}
          <div class="small muted">${t("pk.blinds")} ${tb.sb}/${tb.bb} · ${t("pk.buyin")} 🪙 ${tb.min_buyin}–${tb.max_buyin}</div>
          <div class="small">${tb.seated}/${tb.seats} ${t("pk.seated")} <span class="gn-avs">${tb.players.slice(0, 6).map((p) => av(p)).join("")}</span></div></div>
        <span class="btn ${tb.mine ? "primary" : ""}">${tb.mine ? t("pk.back") : t("pk.open")}</span>
      </a>`).join("") || `<p class="muted">${t("pk.noTables")}</p>`}</div>
    ${d.staff ? `<details class="card pk-new"><summary>➕ ${t("pk.newTable")}</summary>
      <form class="pk-newf">
        <label>${t("pk.name")}<input name="name" maxlength="40" value="Mesa ${d.tables.length + 1}"></label>
        <label>${t("pk.sb")}<input name="sb" type="number" min="1" value="5"></label>
        <label>${t("pk.bb")}<input name="bb" type="number" min="2" value="10"></label>
        <label>${t("pk.minBuy")}<input name="min_buyin" type="number" value="100"></label>
        <label>${t("pk.maxBuy")}<input name="max_buyin" type="number" value="1000"></label>
        <label>${t("pk.seats")}<input name="seats" type="number" min="2" max="9" value="6"></label>
        <button class="primary">${t("pk.create")}</button></form></details>` : ""}
    <p class="hint">${t("pk.rules")}</p>`;
  el.querySelector(".pk-newf")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, v = (k) => f[k].value;
    try { await api("/api/casino/poker", { method: "POST", body: { action: "create", name: v("name"), sb: +v("sb"), bb: +v("bb"), min_buyin: +v("min_buyin"), max_buyin: +v("max_buyin"), seats: +v("seats") } }); pokerLobby(el); }
    catch (x) { toast(x.message, true); }
  });
}

async function pokerTable(el, id) {
  let v = null, lastKey = "", raiseTo = 0, busy = false, countdown = null;
  const post = async (body) => {
    if (busy) return; busy = true;
    try { v = await api("/api/casino/poker", { method: "POST", body: { id, ...body } }); draw(true); }
    catch (x) { toast(x.message, true); }
    finally { busy = false; }
  };
  const poll = async () => {
    if (tab !== "poker" || !document.body.contains(el)) return;
    if (!document.hidden && !busy) { try { v = await api(`/api/casino/poker?id=${id}`); draw(false); } catch (x) { if (/not found/i.test(x.message)) { location.hash = "#poker"; return; } } }
    timer = setTimeout(poll, v?.me ? (v.me.turn ? 2500 : 2000) : 5000);
  };

  el.innerHTML = `
    <div class="pk-top"><a href="#poker" class="small">← ${t("pk.lobby")}</a><b id="pk-name"></b><span class="small muted" id="pk-info"></span>
      <span style="flex:1"></span><span id="pk-mine"></span></div>
    <div class="pk-wrap"><div class="pk-table" id="pk-table"></div></div>
    <div id="pk-result"></div>
    <div class="card pk-bar" id="pk-bar"></div>
    <details class="pk-log"><summary class="small">📜 ${t("pk.log")}</summary><div id="pk-log" class="small muted"></div></details>`;

  const seatPos = (i, n, mine) => { // spread seats around an oval, you at the bottom
    const off = mine >= 0 ? mine : 0;
    const a = Math.PI / 2 + ((i - off) / n) * Math.PI * 2;
    return `left:${50 + 44 * Math.cos(a)}%;top:${50 + 40 * Math.sin(a)}%`;
  };

  function draw(force) {
    if (!v) return;
    el.querySelector("#pk-name").textContent = v.name;
    el.querySelector("#pk-info").textContent = `${t("pk.blinds")} ${v.sb}/${v.bb} · ${t("pk.buyin")} 🪙 ${v.min_buyin}–${v.max_buyin}`;
    const me = v.me, h = v.hand, n = v.seats.length;
    el.querySelector("#pk-mine").innerHTML = me ? `🪙 <b>${me.chips}</b> ${t("pk.chips")}` : "";
    const seats = v.seats.map((s, i) => {
      const pos = seatPos(i, n, me ? me.seat : -1);
      if (!s) return `<div class="pk-seat empty" style="${pos}">${me ? "" : `<button class="small-btn" data-sit="${i}">${t("pk.sitHere")}</button>`}</div>`;
      const turn = h && h.toAct === i;
      const cards = s.shown && !h ? s.shown : s.cards;
      return `<div class="pk-seat ${turn ? "turn" : ""} ${s.folded ? "folded" : ""} ${me?.seat === i ? "me" : ""} ${s.sitOut ? "away" : ""}" style="${pos}">
        <div class="pk-cards">${cards ? cards.map((c) => cardHTML(c, "sm")).join("") : ""}</div>
        <div class="pk-plate">${av(s)}<div><b>${esc(s.name)}</b><div class="small">🪙 ${s.chips}${s.allin ? ` · <span class="pk-allin">ALL-IN</span>` : ""}${s.sitOut ? ` · ${t("pk.away")}` : ""}</div></div>
          ${s.dealer ? `<span class="pk-btn d">D</span>` : ""}${s.sb ? `<span class="pk-btn">SB</span>` : ""}${s.bb ? `<span class="pk-btn">BB</span>` : ""}</div>
        ${turn ? `<div class="pk-timer"><i style="animation-duration:${Math.round(h.turnLeft)}ms"></i></div>` : ""}
        ${s.bet ? `<div class="pk-bet">🪙 ${s.bet}</div>` : ""}
      </div>`;
    }).join("");
    const board = h ? h.board : v.last?.board || [];
    el.querySelector("#pk-table").innerHTML = `
      <div class="pk-felt"><div class="pk-board">${[0, 1, 2, 3, 4].map((k) => cardHTML(board[k])).join("")}</div>
        <div class="pk-pot">${h ? `${t("pk.pot")}: 🪙 <b>${h.pot}</b> · ${t(`pk.st.${h.street}`)}` : v.nextIn != null && v.seats.filter((s) => s && !s.sitOut && s.chips > 0).length >= 2 ? t("pk.nextHand") : t("pk.waiting")}</div></div>
      ${seats}`;
    el.querySelector("#pk-result").innerHTML = !h && v.last ? `<div class="card pk-res">🏆 ${v.last.winners.map((w) => `<b>${esc(w.name)}</b> +🪙 ${w.amount}${w.hand ? ` <span class="muted">(${handName(w.hand)})</span>` : ""}`).join(" · ")}</div>` : "";
    el.querySelector("#pk-log").innerHTML = v.log.slice().reverse().map((l) => `<div>${esc(l)}</div>`).join("");

    // action bar: only rebuilt when something relevant changed (so the raise slider isn't reset mid-drag)
    const key = JSON.stringify([v.version, me?.turn, me?.chips, me?.sitOut, !!h]);
    if (!force && key === lastKey) return;
    lastKey = key;
    const bar = el.querySelector("#pk-bar");
    if (!me) { bar.innerHTML = `<span class="muted">${t("pk.spectating")}</span>`; return; }
    const myP = v.seats[me.seat];
    const inHand = h && myP?.inHand && !myP.folded;
    raiseTo = Math.max(me.minRaiseTo, Math.min(raiseTo || me.minRaiseTo, me.maxRaiseTo));
    bar.innerHTML = `
      <div class="pk-actions">${me.turn ? `
        <button class="danger" data-mv="fold">${t("pk.fold")}</button>
        ${me.canCheck ? `<button data-mv="check">${t("pk.check")}</button>` : `<button class="primary" data-mv="call">${t("pk.call")} 🪙 ${me.toCall}</button>`}
        ${me.maxRaiseTo > (h.currentBet || 0) ? `
          <div class="pk-raise">
            <input type="range" id="pk-r" min="${me.minRaiseTo}" max="${me.maxRaiseTo}" step="${v.bb > 1 ? Math.max(1, Math.floor(v.bb / 2)) : 1}" value="${raiseTo}">
            <input type="number" id="pk-rn" min="${me.minRaiseTo}" max="${me.maxRaiseTo}" value="${raiseTo}">
            <span class="pk-presets"><button class="small-btn" data-pre="half">½</button><button class="small-btn" data-pre="pot">${t("pk.pot")}</button><button class="small-btn" data-pre="all">All-in</button></span>
            <button class="primary" data-mv="raise">${h.currentBet ? t("pk.raiseTo") : t("pk.bet")} <span id="pk-rv">${raiseTo}</span></button>
          </div>` : ""}`
        : inHand ? `<span class="muted">⏳ ${t("pk.waitTurn")}</span>${me.best ? ` <span class="small">· ${t("pk.youHave")} <b>${handName(me.best)}</b></span>` : ""}`
        : `<span class="muted">${me.sitOut ? t("pk.youAway") : me.chips === 0 ? t("pk.broke") : t("pk.nextIn")}</span>`}
      </div>
      <div class="pk-seatctl">
        ${me.turn && me.best ? `<span class="small">${t("pk.youHave")} <b>${handName(me.best)}</b></span>` : ""}
        ${me.sitOut ? `<button class="primary small-btn" data-ctl="back">${t("pk.imBack")}</button>` : `<button class="small-btn" data-ctl="away">${t("pk.sitOut")}</button>`}
        ${!inHand ? `<button class="small-btn" data-ctl="rebuy">➕ ${t("pk.addChips")}</button>` : ""}
        <button class="small-btn" data-ctl="leave">🚪 ${t("pk.leave")}</button>
      </div>`;
    const r = bar.querySelector("#pk-r"), rn = bar.querySelector("#pk-rn"), rv = bar.querySelector("#pk-rv");
    const setR = (x) => { raiseTo = Math.max(me.minRaiseTo, Math.min(me.maxRaiseTo, Math.round(x))); if (r) r.value = raiseTo; if (rn) rn.value = raiseTo; if (rv) rv.textContent = raiseTo; };
    r?.addEventListener("input", () => setR(+r.value));
    rn?.addEventListener("change", () => setR(+rn.value));
    bar.querySelectorAll("[data-pre]").forEach((b) => (b.onclick = () => {
      const pot = h.pot + me.toCall;
      setR(b.dataset.pre === "all" ? me.maxRaiseTo : h.currentBet + (b.dataset.pre === "half" ? pot / 2 : pot));
    }));
  }

  el.addEventListener("click", async (e) => {
    const q = (s) => e.target.closest(s);
    if (q("[data-mv]")) {
      const mv = q("[data-mv]").dataset.mv;
      const all = mv === "raise" && raiseTo >= v.me.maxRaiseTo;
      if (mv === "fold" && v.me.canCheck && !(await ask(t("pk.foldQ")))) return;
      return post({ action: "act", move: all ? "allin" : mv, amount: raiseTo });
    }
    if (q("[data-sit]")) {
      const def = Math.min(v.max_buyin, Math.max(v.min_buyin, v.bb * 50));
      const x = await askText(t("pk.buyinQ", { min: v.min_buyin, max: v.max_buyin }), String(def), { ok: t("pk.sit") });
      if (x == null) return;
      return post({ action: "sit", seat: +q("[data-sit]").dataset.sit, buyin: parseInt(x) });
    }
    const ctl = q("[data-ctl]")?.dataset.ctl;
    if (ctl === "leave") { if (await ask(t("pk.leaveQ", { n: v.me.chips }))) { await post({ action: "leave" }); location.hash = "#poker"; } return; }
    if (ctl === "rebuy") {
      const x = await askText(t("pk.rebuyQ", { max: v.max_buyin - v.me.chips }), String(Math.max(0, Math.min(v.min_buyin, v.max_buyin - v.me.chips))), { ok: t("pk.addChips") });
      if (x != null) post({ action: "rebuy", amount: parseInt(x) });
      return;
    }
    if (ctl) post({ action: ctl });
  });
  void countdown;
  v = await api(`/api/casino/poker?id=${id}`);
  draw(true);
  timer = setTimeout(poll, 2000);
}

/* =================================== ROULETTE =================================== */
const WHEEL = [32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const CHIPS = [1, 5, 10, 25, 50];
async function roulette(el) {
  let d = await api("/api/casino/roulette");
  let chip = 5, spinning = false, rot = 0;
  const bets = new Map(); // "kind:value" → coins
  const total = () => [...bets.values()].reduce((a, b) => a + b, 0);
  const wheelBg = `conic-gradient(${WHEEL.map((n, i) => `${RED.has(n) ? "#c0392b" : "#1d1f26"} ${(i * 10)}deg ${(i + 1) * 10}deg`).join(",")})`;
  const spot = (kind, value, label, cls = "") => {
    const k = `${kind}:${value ?? ""}`, c = bets.get(k);
    return `<button class="rl-spot ${cls}" data-k="${k}">${label}${c ? `<span class="rl-chip">${c}</span>` : ""}</button>`;
  };
  const left = () => Math.max(0, Math.min(d.max_bet, d.cap + d.today.net));

  function drawBoard() {
    const grid = [3, 2, 1].map((row) => Array.from({ length: 12 }, (_, c) => { const n = c * 3 + row; return spot("number", n, n, RED.has(n) ? "red" : "black"); }).join("") + spot("column", row === 3 ? 3 : row === 2 ? 2 : 1, "2:1", "col")).join("");
    el.querySelector("#rl-board").innerHTML = `
      <div class="rl-grid">${grid}</div>
      <div class="rl-dozens">${spot("dozen", 1, t("rl.d1"))}${spot("dozen", 2, t("rl.d2"))}${spot("dozen", 3, t("rl.d3"))}</div>
      <div class="rl-outside">${spot("low", null, "1–18")}${spot("even", null, t("rl.even"))}${spot("red", null, "◆", "red")}${spot("black", null, "◆", "black")}${spot("odd", null, t("rl.odd"))}${spot("high", null, "19–36")}</div>`;
    el.querySelector("#rl-total").textContent = total();
    el.querySelector("#rl-spin").disabled = spinning || !total() || total() > left();
  }
  function drawSide() {
    el.querySelector("#rl-today").innerHTML = `${t("rl.today")}: <b class="${d.today.net >= 0 ? "lfg-ok" : "bad"}">${d.today.net >= 0 ? "+" : ""}${d.today.net}</b> · ${t("rl.left", { n: left() })}`;
    el.querySelector("#rl-recent").innerHTML = d.recent.map((r) => `<span class="rl-num ${RED.has(r.result) ? "red" : "black"}" title="${esc(r.username)}: ${r.payout - r.bet >= 0 ? "+" : ""}${r.payout - r.bet}">${r.result}</span>`).join("");
  }
  el.innerHTML = `
    <p class="muted">${t("rl.intro", { max: d.max_bet, cap: d.cap })}</p>
    <div class="rl-layout">
      <div class="rl-wheelbox">
        <div class="rl-pointer">▼</div>
        <div class="rl-wheel" id="rl-wheel" style="background:${wheelBg}">${WHEEL.map((n, i) => `<span style="transform:rotate(${i * 10 + 5}deg)"><b>${n}</b></span>`).join("")}<div class="rl-hub" id="rl-hub">🎡</div></div>
        <div id="rl-today" class="small"></div>
        <div class="rl-recent" id="rl-recent"></div>
      </div>
      <div class="rl-tablebox">
        <div class="rl-chips">${CHIPS.map((c) => `<button class="rl-pick ${c === chip ? "on" : ""}" data-chip="${c}">${c}</button>`).join("")}
          <span class="small muted">${t("rl.chipHint")}</span></div>
        <div id="rl-board" class="rl-board"></div>
        <div class="lfg-row rl-go"><span>${t("rl.total")}: 🪙 <b id="rl-total">0</b> / ${d.max_bet}</span><span style="flex:1"></span>
          <button class="small-btn" id="rl-clear">${t("rl.clear")}</button><button class="primary" id="rl-spin">🎡 ${t("rl.spin")}</button></div>
        <div id="rl-out" class="rl-out"></div>
      </div>
    </div>`;
  drawBoard(); drawSide();
  el.querySelector(".rl-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]"); if (!b) return;
    chip = +b.dataset.chip; el.querySelectorAll("[data-chip]").forEach((x) => x.classList.toggle("on", x === b));
  });
  const board = el.querySelector("#rl-board");
  board.addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]"); if (!b || spinning) return;
    const add = Math.min(chip, d.max_bet - total());
    if (add <= 0) return toast(t("rl.maxed", { n: d.max_bet }), true);
    bets.set(b.dataset.k, (bets.get(b.dataset.k) || 0) + add); drawBoard();
  });
  board.addEventListener("contextmenu", (e) => { const b = e.target.closest("[data-k]"); if (!b) return; e.preventDefault(); bets.delete(b.dataset.k); drawBoard(); });
  el.querySelector("#rl-clear").onclick = () => { bets.clear(); drawBoard(); };
  el.querySelector("#rl-spin").onclick = async () => {
    if (spinning) return;
    spinning = true; drawBoard();
    const list = [...bets].map(([k, coins]) => { const [kind, value] = k.split(":"); return { kind, value: value ? +value : null, coins }; });
    let r;
    try { r = await api("/api/casino/roulette", { method: "POST", body: { bets: list } }); }
    catch (x) { toast(x.message, true); spinning = false; drawBoard(); return; }
    // spin so the result's slice ends under the pointer (top)
    const idx = WHEEL.indexOf(r.result);
    const target = 360 - (idx * 10 + 5);
    rot = rot - (rot % 360) + 360 * 5 + target;
    const wheel = el.querySelector("#rl-wheel");
    wheel.style.transform = `rotate(${rot}deg)`;
    await new Promise((ok) => setTimeout(ok, 4200));
    el.querySelector("#rl-hub").innerHTML = `<b class="${RED.has(r.result) ? "red" : ""}">${r.result}</b>`;
    const net = r.payout - r.bet;
    el.querySelector("#rl-out").innerHTML = `<span class="rl-num big ${RED.has(r.result) ? "red" : "black"}">${r.result}</span> ${net > 0 ? `<b class="lfg-ok">🎉 ${t("rl.won", { n: r.payout })}</b>` : `<span class="muted">${t("rl.lost", { n: r.bet })}</span>`}`;
    board.querySelectorAll("[data-k]").forEach((b) => b.classList.toggle("hit", b.dataset.k === `number:${r.result}`));
    d.today = r.today;
    d.recent = [{ result: r.result, bet: r.bet, payout: r.payout, username: user.username }, ...d.recent].slice(0, 12);
    spinning = false; drawSide(); drawBoard();
    board.querySelectorAll("[data-k]").forEach((b) => b.classList.toggle("hit", b.dataset.k === `number:${r.result}`));
  };
}

/* =================================== RAFFLES =================================== */
async function raffles(el) {
  const d = await api("/api/casino/raffles");
  const open = d.raffles.filter((r) => r.status === "open"), done = d.raffles.filter((r) => r.status !== "open");
  const card = (r) => {
    const live = r.status === "open";
    const odds = r.tickets ? Math.round((r.mine / r.tickets) * 1000) / 10 : 0;
    const canBuy = r.max_per_user - r.mine;
    return `<div class="card rf ${live ? "" : "done"}">
      ${r.image ? `<img class="rf-img" src="${esc(r.image)}" alt="" loading="lazy">` : `<div class="rf-img rf-noimg">🎁</div>`}
      <div class="rf-main">
        <div class="small muted">🎟️ ${esc(r.title)}</div>
        <h3>${esc(r.prize)}</h3>
        <div class="small">${live ? `⏳ ${t("rf.draws", { when: esc(fmt(r.draws_at)) })}` : r.status === "cancelled" ? `❌ ${t("rf.cancelled")}` : r.winner_name ? `🏆 ${t("rf.winner")}: ${av({ avatar: r.winner_avatar, name: r.winner_name })} <b>${esc(r.winner_name)}</b>${r.winner_id === d.me ? " 🎉" : ""} ${r.delivered ? `· <span class="lfg-ok">✓ ${t("rf.delivered")}</span>` : `· <span class="muted">${t("rf.pending")}</span>`}` : t("rf.noOne")}</div>
        <div class="small muted">🪙 ${r.ticket_price} ${t("rf.perTicket")} · ${t("rf.sold", { n: r.tickets, p: r.people })} · ${t("rf.max", { n: r.max_per_user })}</div>
        ${r.mine ? `<div class="small">${t("rf.youHave", { n: r.mine, odds })}</div>` : ""}
        ${live && canBuy > 0 ? `<div class="lfg-row rf-buy"><input type="number" min="1" max="${canBuy}" value="1" data-n="${r.id}"><button class="primary" data-buy="${r.id}" data-price="${r.ticket_price}">${t("rf.buy")}</button></div>` : live ? `<div class="hint">${t("rf.maxed")}</div>` : ""}
        ${d.staff ? `<div class="rf-staff small">${live ? `<button class="link" data-rf="draw" data-id="${r.id}">🎲 ${t("rf.drawNow")}</button> <button class="link" data-rf="cancel" data-id="${r.id}">❌ ${t("rf.cancel")}</button>` : r.winner_id ? `<button class="link" data-rf="delivered" data-id="${r.id}">${r.delivered ? "↩️" : "📦"} ${t(r.delivered ? "rf.undeliver" : "rf.markDelivered")}</button>` : ""}</div>` : ""}
      </div></div>`;
  };
  el.innerHTML = `
    <p class="muted">${t("rf.intro")}</p>
    ${d.staff ? `<details class="card rf-new"><summary>➕ ${t("rf.new")}</summary>
      <form class="rf-newf">
        <label>${t("rf.title")}<input name="title" maxlength="80" required placeholder="${esc(t("rf.titlePh"))}"></label>
        <label>${t("rf.prize")}<input name="prize" maxlength="200" required placeholder="${esc(t("rf.prizePh"))}"></label>
        <label>${t("rf.image")}<input name="image" maxlength="400" placeholder="https://…"></label>
        <label>${t("rf.price")}<input name="price" type="number" min="1" value="25" required></label>
        <label>${t("rf.maxPer")}<input name="max" type="number" min="1" max="100" value="5" required></label>
        <label>${t("rf.when")}<input name="when" type="datetime-local" required></label>
        <button class="primary">${t("rf.create")}</button></form>
      <p class="hint">${t("rf.staffHint")}</p></details>` : ""}
    ${open.length ? `<div class="rf-grid">${open.map(card).join("")}</div>` : `<p class="muted">${t("rf.none")}</p>`}
    ${done.length ? `<h3>${t("rf.past")}</h3><div class="rf-grid">${done.map(card).join("")}</div>` : ""}`;
  el.querySelector(".rf-newf")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("/api/casino/raffles", { method: "POST", body: { action: "create", title: f.title.value, prize: f.prize.value, image: f.image.value.trim() || null,
        ticket_price: +f.price.value, max_per_user: +f.max.value, draws_at: inputToMs(f.when.value) } });
      toast(t("rf.created")); raffles(el);
    } catch (x) { toast(x.message, true); }
  });
  el.querySelectorAll("[data-buy]").forEach((b) => (b.onclick = async () => {
    const n = parseInt(el.querySelector(`[data-n="${b.dataset.buy}"]`).value) || 1;
    if (!(await ask(t("rf.buyQ", { n, cost: n * +b.dataset.price }), { icon: "🎟️", ok: t("rf.buy") }))) return;
    try { await api("/api/casino/raffles", { method: "POST", body: { action: "buy", id: +b.dataset.buy, n } }); toast(t("rf.bought", { n })); raffles(el); }
    catch (x) { toast(x.message, true); }
  }));
  el.querySelectorAll("[data-rf]").forEach((b) => (b.onclick = async () => {
    const a = b.dataset.rf;
    if (a === "cancel" && !(await ask(t("rf.cancelQ"), { danger: true }))) return;
    if (a === "draw" && !(await ask(t("rf.drawQ"), { icon: "🎲" }))) return;
    try {
      const r = await api("/api/casino/raffles", { method: "POST", body: { action: a, id: +b.dataset.id } });
      if (a === "draw") await notice(r.winner ? t("rf.drawn", { name: r.winner }) : t("rf.noOne"), { icon: "🎉" });
      raffles(el);
    } catch (x) { toast(x.message, true); }
  }));
}
