// "Apuestas": coin predictions (parimutuel pools) — now a tab of the Casino.
import { ask, askText, api, esc, t, toast } from "./common.js";
const fmt = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const av = (u) => `<img class="soc-av" src="${esc(u.avatar || "")}" alt="" title="${esc(u.username)}" loading="lazy" onerror="this.style.visibility='hidden'">`;

export async function mountBets(el, user) {
  const { markets } = await api("/api/markets");
  const staff = ["staff", "subadmin", "admin"].includes(user.role);
  const card = (m) => {
    const win = m.options.find((o) => o.id === m.winner_option);
    return `
    <div class="card mk ${m.open ? "" : "closed"}">
      <div class="mk-head"><b>${esc(m.title)}</b><span class="small muted">🪙 ${m.pot} ${t("mk.pot")} · ${m.status === "settled" ? `🏁 ${t("mk.won")}: ${esc(win?.label || "?")}` : m.status === "void" ? t("mk.void") : m.open ? (m.closes_at ? t("mk.closes", { when: fmt(m.closes_at) }) : t("mk.open")) : t("mk.closed")}</span></div>
      <div class="mk-opts">${m.options.map((o) => `
        <div class="mk-opt ${m.my_bet?.option_id === o.id ? "mine" : ""} ${win?.id === o.id ? "win" : ""}">
          <span class="mk-lbl">${esc(o.label)}</span>
          <span class="small muted">🪙 ${o.stake}${o.payout ? ` · x${o.payout}` : ""}</span>
          <span class="gn-avs">${o.bettors.slice(0, 5).map(av).join("")}</span>
          ${m.open && !m.my_bet ? `<button class="small-btn" data-bet="${m.id}" data-opt="${o.id}">${t("mk.bet")}</button>` : ""}
          ${staff && m.kind === "custom" && ["open", "closed"].includes(m.status) ? `<button class="small-btn" data-settle="${m.id}" data-opt="${o.id}">🏁</button>` : ""}
        </div>`).join("")}</div>
      ${m.my_bet ? `<div class="hint">${t("mk.yourBet", { coins: m.my_bet.coins, opt: esc(m.options.find((o) => o.id === m.my_bet.option_id)?.label || "") })}</div>` : ""}
    </div>`;
  };
  el.innerHTML = `
    <div class="section-head"><p class="muted" style="margin:0">${t("mk.intro")}</p>${staff ? `<button class="small-btn" id="mk-new">+ ${t("mk.new")}</button>` : ""}</div>
    <div id="mk-form"></div>
    <div class="mk-list">${markets.map(card).join("") || `<p class="muted">${t("mk.none")}</p>`}</div>`;
  el.querySelectorAll("[data-bet]").forEach((b) => (b.onclick = async () => {
    const coins = parseInt(await askText(t("mk.howMuch"), "20"));
    if (!coins) return;
    try { await api(`/api/markets/${b.dataset.bet}`, { method: "POST", body: { action: "bet", option_id: +b.dataset.opt, coins } }); toast(t("mk.placed")); mountBets(el, user); }
    catch (x) { toast(x.message, true); }
  }));
  el.querySelectorAll("[data-settle]").forEach((b) => (b.onclick = async () => {
    if (!await ask(t("mk.settleQ"))) return;
    try { await api(`/api/markets/${b.dataset.settle}`, { method: "POST", body: { action: "settle", option_id: +b.dataset.opt } }); mountBets(el, user); } catch (x) { toast(x.message, true); }
  }));
  el.querySelector("#mk-new")?.addEventListener("click", () => {
    const box = el.querySelector("#mk-form");
    box.innerHTML = `<form class="card lfg-form"><label>${t("mk.question")}<input name="title" maxlength="120" required placeholder="${esc(t("mk.questionPh"))}"></label>
      <label>${t("mk.options")}<input name="opts" required placeholder="Moikas, Jhex, Doggo"></label><button class="primary">${t("mk.create")}</button></form>`;
    box.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      try { await api("/api/markets", { method: "POST", body: { title: e.target.title.value, options: e.target.opts.value.split(",") } }); mountBets(el, user); } catch (x) { toast(x.message, true); }
    };
  });
}
