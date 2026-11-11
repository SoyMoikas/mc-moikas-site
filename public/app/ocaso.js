// Daily bonus card + Ocaso panel (Blood Moon, player cards, death feed).
import { api, esc, t, lang, ago, toast } from "./common.js";

/* ---------------- Daily login bonus ---------------- */

export async function mountDaily(el, user) {
  if (!user || user.role === "pending") { el.remove(); return; }
  let st;
  try { st = await api("/api/daily"); } catch { el.remove(); return; }
  const render = (fresh = false) => {
    if (st.claimed && !fresh) {
      el.innerHTML = `<div class="soc-bar daily-mini"><span>🔥 <b>${t("daily.streak", { n: st.streak })}</b></span>
        <span class="daily-ok">✓ ${t("daily.claimed")}</span><span class="muted">· ${t("daily.comeBack", { n: st.reward })}</span></div>`;
      return;
    }
    const pos = st.claimed ? ((st.streak - 1) % 7) : (st.streak % 7); // today's slot in the 7-day row
    el.innerHTML = `
      <div class="card daily ${st.claimed ? "done" : ""}">
        <div class="daily-head">
          <div><b>🔥 ${t("daily.streak", { n: st.streak })}</b>
            <div class="small muted">${st.claimed ? t("daily.comeBack", { n: st.reward }) : t("daily.ready")}</div></div>
          ${st.claimed ? `<span class="daily-ok">✓ ${t("daily.claimed")}</span>`
                       : `<button class="primary" id="daily-claim">${t("daily.claim", { n: st.reward })}</button>`}
        </div>
        <div class="daily-week">${st.week.map((c, i) => `
          <div class="dw ${i < pos || (st.claimed && i === pos) ? "got" : ""} ${!st.claimed && i === pos ? "next" : ""} ${i === 6 ? "big" : ""}">
            <span>${t("daily.day", { n: i + 1 })}</span><b>🪙 ${c}</b></div>`).join("")}</div>
      </div>`;
    const b = el.querySelector("#daily-claim");
    if (b) b.onclick = async () => {
      b.disabled = true;
      try { st = await api("/api/daily", { method: "POST" }); toast(t("daily.got", { n: st.gained })); render(true); setTimeout(() => render(), 2500); }
      catch (e) { toast(e.message, true); b.disabled = false; }
    };
  };
  render();
}

/* ---------------- Ocaso ---------------- */

const GODS = [
  ["tonatiuh", "☀", "Tonatiuh", "#f2b33d"], ["tlaloc", "🌧", "Tláloc", "#4fb3e8"], ["quetzalcoatl", "🪶", "Quetzalcóatl", "#4fd18b"],
  ["mictlan", "💀", "Mictlantecuhtli", "#b48cff"], ["tezcatlipoca", "🪞", "Tezcatlipoca", "#8a93a8"],
];
const ORDERS = { jaguar: "🐆 Guerrero Jaguar", aguila: "🦅 Guerrero Águila", tlamatini: "📜 Tlamatini", granicero: "⛈ Granicero", devoto: "✝ Devoto" };
const CURSES = { vampiro: "🦇 Vampiro", licantropo: "🐺 Licántropo", nahual: "🐾 Nahual", canibal: "🩸 Caníbal" };

function sanityLabel(s) {
  if (s >= 70) return t("oc.s1");
  if (s >= 40) return t("oc.s2");
  if (s >= 15) return t("oc.s3");
  return t("oc.s4");
}
const sanityColor = (s) => (s >= 70 ? "#cfd3dc" : s >= 40 ? "#f2c94c" : s >= 15 ? "#e5534b" : "#a46bff");

// Death messages come from the server log in English; translate the common ones.
const DEATHS = [
  [/^was slain by (.+)$/, "fue asesinado por $1"], [/^was shot by (.+)$/, "fue flechado por $1"],
  [/^was killed by (.+)$/, "fue matado por $1"], [/^was blown up by (.+)$/, "voló en pedazos por $1"],
  [/^was fireballed by (.+)$/, "recibió una bola de fuego de $1"], [/^was struck by lightning.*$/, "le cayó un rayo"],
  [/^fell from a high place.*$/, "se cayó de muy alto"], [/^hit the ground too hard.*$/, "pegó contra el suelo"],
  [/^fell out of the world.*$/, "cayó al vacío"], [/^drowned.*$/, "se ahogó"], [/^burned to death.*$/, "murió quemado"],
  [/^went up in flames.*$/, "ardió en llamas"], [/^walked into fire.*$/, "se metió al fuego"],
  [/^tried to swim in lava.*$/, "intentó nadar en lava"], [/^suffocated in a wall.*$/, "se asfixió en una pared"],
  [/^starved to death.*$/, "murió de hambre"], [/^froze to death.*$/, "murió congelado"], [/^withered away.*$/, "se marchitó"],
  [/^blew up$/, "explotó"], [/^experienced kinetic energy.*$/, "se estrelló a toda velocidad"], [/^died$/, "murió"],
  [/^was squashed by (.+)$/, "fue aplastado por $1"], [/^was pricked to death$/, "murió picado por un cactus"],
];
function deathText(msg) {
  if (lang !== "es") return msg;
  for (const [re, es] of DEATHS) if (re.test(msg)) return msg.replace(re, es);
  return msg;
}

function moonBanner(w) {
  if (w.lunasangre) return `<div class="oc-moon red">🩸 <b>${t("oc.moonNow")}</b><span>${t("oc.moonNowSub")}</span></div>`;
  return `<div class="oc-moon ${w.faltan === 1 ? "soon" : ""}">🌕 <b>${w.faltan === 1 ? t("oc.moonTomorrow") : t("oc.moonIn", { n: w.faltan })}</b>
    <span>${t("oc.night", { n: w.noches })}${w.mictlantecuhtli_vivo ? ` · 💀 ${t("oc.lordAwake")}` : ""}${w.xolotl_vivo ? ` · 🐕 ${t("oc.xolotlAwake")}` : ""}${w.llorona_viva ? ` · 😢 ${t("oc.lloronaOut")}` : ""}</span></div>`;
}

function playerCard(p) {
  const s = p.sanity ?? 100;
  const top = GODS.map(([id]) => [id, p.fe?.[id] ?? 0]).sort((a, b) => b[1] - a[1])[0];
  return `
    <div class="card oc-player ${p.mine ? "mine" : ""}">
      <div class="oc-p-head">
        <img class="oc-face" src="https://mc-heads.net/avatar/${encodeURIComponent(p.mc_uuid)}/40" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div><b>${p.user ? `<a href="/profile?id=${p.user.id}">${esc(p.name)}</a>` : esc(p.name)}</b>
          <div class="small muted">${[p.orden ? ORDERS[p.orden] || esc(p.orden) : t("oc.noOrder"), p.bautizado && p.orden !== "devoto" ? "✝ " + t("oc.baptized") : ""].filter(Boolean).join(" · ")}</div></div>
      </div>
      <div class="oc-sanity" title="${esc(t("oc.sanity"))}: ${Math.round(s)}/100">
        <div class="oc-s-bar"><div style="width:${s}%;background:${sanityColor(s)}"></div></div>
        <span style="color:${sanityColor(s)}">${esc(sanityLabel(s))}</span>
      </div>
      <div class="oc-gods">${GODS.map(([id, ico, name, col]) => {
        const v = p.fe?.[id] ?? 0;
        return `<div class="oc-god" title="${esc(name)}: ${v > 0 ? "+" : ""}${Math.round(v)}">
          <span>${ico}</span><div class="oc-g-bar"><div style="${v >= 0 ? `left:50%;width:${v / 2}%` : `right:50%;width:${-v / 2}%`};background:${v >= 0 ? col : "#e5534b"}"></div></div></div>`;
      }).join("")}</div>
      <div class="oc-tags small">
        ${top && top[1] >= 20 ? `<span>${GODS.find((g) => g[0] === top[0])[1]} ${t("oc.favorite", { god: GODS.find((g) => g[0] === top[0])[2] })}</span>` : ""}
        ${p.mictlan ? `<span>💀 ${p.senor ? t("oc.lordMictlan") : t("oc.mictlanLvl", { n: p.mictlan })}</span>` : ""}
        ${p.lunas ? `<span>🩸 ${t("oc.moons", { n: p.lunas })}</span>` : ""}
        ${p.llave ? `<span>🗝 ${t("oc.key")}</span>` : ""}
        ${p.clase ? `<span class="oc-secret" title="${esc(t("oc.secretHint"))}">${CURSES[p.clase] || esc(p.clase)} 🔒</span>` : ""}
      </div>
    </div>`;
}

export function deathsHTML(deaths, { names = true } = {}) {
  if (!deaths.length) return `<p class="muted small">${t("oc.noDeaths")}</p>`;
  return `<ul class="oc-deaths">${deaths.map((d) => `
    <li><span class="small muted" title="${esc(new Date(d.created_at).toLocaleString())}">${ago(d.created_at)}</span>
      ☠ ${names ? `<b>${d.user_id ? `<a href="/profile?id=${d.user_id}">${esc(d.name)}</a>` : esc(d.name)}</b> ` : ""}${esc(deathText(d.message))}</li>`).join("")}</ul>`;
}

// Full panel for a server page (or every Ocaso server when no id).
export async function mountOcaso(el, serverId) {
  let d;
  try { d = await api(`/api/ocaso${serverId ? `?server=${encodeURIComponent(serverId)}` : ""}`); } catch { el.remove(); return false; }
  if (!d.servers.length) { el.remove(); return false; }
  const w = d.servers[0];
  const players = [...d.players].sort((a, b) => (b.mine - a.mine) || ((b.updated_at || 0) - (a.updated_at || 0)));
  el.innerHTML = `
    <div class="section-head"><h2>🌅 ${t("oc.title")}</h2><span class="hint">${t("oc.updated", { ago: ago(w.updated_at) })}</span></div>
    ${moonBanner(w)}
    <div class="oc-grid">${players.map(playerCard).join("") || `<p class="muted">${t("oc.noPlayers")}</p>`}</div>
    <h3 style="margin-top:18px">☠ ${t("oc.deaths")}</h3>
    <div class="card">${deathsHTML(d.deaths)}</div>`;
  return true;
}

// Small home-page card: Blood Moon + latest deaths.
export async function mountOcasoHome(el) {
  let d;
  try { d = await api("/api/ocaso"); } catch { el.remove(); return; }
  if (!d.servers.length) { el.remove(); return; }
  const w = d.servers[0];
  el.innerHTML = `
    <div class="section-head"><h2>🌅 Ocaso</h2>${w.server_id ? `<a class="small" href="/server?id=${encodeURIComponent(w.server_id)}#ocaso">${t("oc.seeAll")}</a>` : ""}</div>
    ${moonBanner(w)}
    <div class="card">${deathsHTML(d.deaths.slice(0, 8))}</div>`;
  return d;
}

// Profile: that person's Ocaso card(s) and deaths.
export async function mountOcasoProfile(el, userId) {
  let d;
  try { d = await api(`/api/ocaso?user=${encodeURIComponent(userId)}`); } catch { el.remove(); return; }
  if (!d.players.length) { el.remove(); return; }
  el.innerHTML = `
    <div class="section-head"><h2>🌅 Ocaso</h2></div>
    <div class="oc-grid">${d.players.map(playerCard).join("")}</div>
    ${d.deaths.length ? `<h3 style="margin-top:14px">☠ ${t("oc.lastDeaths")}</h3><div class="card">${deathsHTML(d.deaths, { names: false })}</div>` : ""}`;
}
