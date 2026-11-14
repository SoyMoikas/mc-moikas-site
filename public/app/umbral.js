import { api, esc, t, initPage, fmtDate } from "./common.js";

// The hidden page. Nothing on the site links here: you get in by typing its name on any page, or with the address from a clue in-game.
const user = await initPage();
const main = document.getElementById("main");

if (!user || user.role === "pending") {
  main.innerHTML = `<section class="umbral"><p>${t("um.closed")}</p>${user ? "" : `<p><a href="/auth/login?next=/umbral">${t("auth.login")}</a></p>`}</section>`;
} else {
  try {
    const d = await api("/api/secret", { method: "POST" });
    main.innerHTML = `
      <section class="umbral">
        <h2>🚪 ${t("um.title")}</h2>
        <p>${t("um.intro")}</p>
        <ol class="umbral-souls">${d.souls.map((s) => `<li class="${s.id === user.id ? "me" : ""}"><a href="/profile?id=${s.id}">${esc(s.username)}</a> <span class="small muted">${esc(fmtDate(s.unlocked_at))}</span></li>`).join("")}</ol>
        <p><b>${t("um.you", { n: d.mine })}</b></p>
        <p class="small muted">${t("um.hush")}</p>
      </section>`;
  } catch (e) { main.innerHTML = `<section class="umbral"><p>${esc(e.message)}</p></section>`; }
}
