// Player guide page: /guide?id=<server>. Markdown written in Admin → Servers → (server) → Guide.
import { api, esc, t, initPage, SITE, gameLabel, localized } from "./common.js";
import { renderMarkdown } from "./markdown.js";

await initPage();
const id = new URLSearchParams(location.search).get("id");
const main = document.getElementById("main");

async function load() {
  if (!id) { main.innerHTML = `<p style="padding:40px 0">${t("sp.noServer")} <a href="/">${t("sp.seeAll")}</a></p>`; return; }
  let g;
  try { g = await api(`/api/servers/${encodeURIComponent(id)}/guide`); }
  catch (e) { main.innerHTML = `<p style="padding:40px 0">${esc(e.message)}. <a href="/">${t("sp.seeAll")}</a></p>`; return; }
  document.title = `${t("guide.title")} · ${g.name} · Moikas`;
  const text = localized(g.guide, g.guide_es) || g.guide || g.guide_es;
  const game = SITE.games.find((x) => x.id === g.game_id);
  if (!text) {
    main.innerHTML = `<section><a class="crumb" href="/server?id=${encodeURIComponent(g.id)}">← ${esc(g.name)}</a><p class="muted" style="padding:20px 0">${t("guide.none")}</p></section>`;
    return;
  }
  const { html, toc } = renderMarkdown(text);
  main.innerHTML = `
    <section>
      <a class="crumb" href="/server?id=${encodeURIComponent(g.id)}">← ${game ? esc(game.icon || "") + " " : ""}${esc(g.name)}</a>
      <div class="guide-layout">
        ${toc.length ? `<nav class="guide-toc card"><strong>${t("guide.contents")}</strong>${toc.map((x) => `<a href="#${x.id}">${esc(x.text.replace(/\*\*/g, ""))}</a>`).join("")}</nav>` : ""}
        <article class="guide card">${html}</article>
      </div>
    </section>`;
  const jump = (hid, smooth) => {
    const el = document.getElementById(hid);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72, behavior: smooth ? "smooth" : "auto" });
  };
  main.querySelectorAll(".guide-toc a").forEach((a) => a.onclick = (ev) => {
    ev.preventDefault();
    const hid = a.getAttribute("href").slice(1);
    history.replaceState(null, "", "#" + hid);
    jump(hid, true);
  });
  if (location.hash) jump(location.hash.slice(1), false);
}

load();
