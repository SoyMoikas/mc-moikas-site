// Map page: the live web map (BlueMap) of each server that has a map link (Admin → Servers → Map link).
// ?server=<id> opens that server's map; a tab per server when there are several.
import { esc, t, initPage, SITE } from "./common.js";

await initPage();
const main = document.getElementById("main");
document.title = `${t("nav.map")} · Moikas`;
const maps = SITE.maps || [];
let cur = maps.find((m) => m.id === new URLSearchParams(location.search).get("server")) || maps[0];

function render() {
  if (!cur) {
    main.innerHTML = `<section><div class="section-head"><h2>🗺️ ${t("nav.map")}</h2></div><p class="muted">${t("map.none")}</p></section>`;
    return;
  }
  main.innerHTML = `
    <section class="map-page">
      <div class="section-head">
        <h2>🗺️ ${t("nav.map")}</h2>
        <a class="btn" href="${esc(cur.url)}" target="_blank" rel="noopener">⛶ ${t("map.fullscreen")}</a>
      </div>
      ${maps.length > 1 ? `<div class="chips map-tabs">${maps.map((m) =>
        `<button data-map="${esc(m.id)}" class="${m.id === cur.id ? "active" : ""}">${esc(m.name)}</button>`).join("")}</div>` : ""}
      <p class="hint">${t("map.hint")}</p>
      <div class="map-frame card"><iframe src="${esc(cur.url)}" title="${esc(cur.name)}" loading="lazy" allowfullscreen referrerpolicy="no-referrer"></iframe></div>
    </section>`;
  main.querySelectorAll("[data-map]").forEach((b) => b.onclick = () => {
    cur = maps.find((m) => m.id === b.dataset.map);
    history.replaceState(null, "", `/map?server=${encodeURIComponent(cur.id)}`);
    render();
  });
}
render();
