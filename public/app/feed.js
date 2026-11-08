// Private "For you" feed: composer, posts, likes, replies. Approved members only.
import { api, esc, rich, can, t, ago, toast, roleLabel, loginHint, levelBadge, avatarHTML, nameHTML, SITE, gameLabel, bgStyle, bgAnimated } from "./common.js";

// opts: { game: id (filter + preselect), userId: profile filter, composer: bool, modes: bool }
export function mountFeed(el, user, opts = {}) {
  el.classList.add("feed");
  if (!can(user, "member")) {
    el.innerHTML = `<div class="card feed-locked"><b>🔒 ${t("feed.private")}</b><p class="hint">${user ? t("sp.pendingNotice") : loginHint(user)}</p></div>`;
    return;
  }
  let mode = opts.userId ? "recent" : "foryou";
  let posts = [], more = false, cursor = null;

  el.innerHTML = `
    ${opts.composer !== false ? composerHTML() : ""}
    ${opts.modes !== false && !opts.userId ? `<div class="feed-modes">
      <button data-mode="foryou" class="active">${t("feed.forYou")}</button>
      <button data-mode="recent">${t("feed.recent")}</button></div>` : ""}
    <div class="feed-list"><p class="muted">${t("loading")}</p></div>
    <div class="feed-more"></div>`;
  const list = el.querySelector(".feed-list");

  function composerHTML(p = null) {
    return `
      <form class="card composer${p ? " editing" : ""}">
        <div class="composer-row">
          ${p ? "" : avatarHTML(user, 40)}
          <textarea name="body" maxlength="2000" rows="${p ? 3 : 2}" placeholder="${esc(t("feed.placeholder"))}">${esc(p?.body || "")}</textarea>
        </div>
        <div class="composer-extra ${p?.image ? "" : "hidden"}">
          <input name="image" placeholder="${esc(t("feed.imagePh"))}" value="${esc(p?.image || "")}">
        </div>
        <div class="actions">
          <button type="button" class="link" data-add-image>🖼 ${t("feed.addImage")}</button>
          <select name="game_id" style="width:auto">
            <option value="">${t("feed.noGame")}</option>
            ${SITE.games.map((g) => `<option value="${esc(g.id)}" ${(p ? p.game_id : opts.game) === g.id ? "selected" : ""}>${esc(g.icon || "🎮")} ${esc(gameLabel(g))}</option>`).join("")}
          </select>
          <span style="flex:1"></span>
          ${p ? `<button type="button" data-cancel>${t("cancel")}</button>` : ""}
          <button class="primary">${p ? t("save") : t("feed.post")}</button>
        </div>
      </form>`;
  }

  function wireComposer(form, onDone, postId = null) {
    form.querySelector("[data-add-image]").onclick = () => {
      form.querySelector(".composer-extra").classList.toggle("hidden");
      form.image.focus();
    };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = { body: form.body.value, image: form.image.value.trim() || null, game_id: form.game_id.value || null };
      const btn = form.querySelector("button.primary"); btn.disabled = true;
      try {
        if (postId) await api(`/api/feed/${postId}`, { method: "PATCH", body: d });
        else await api("/api/feed", { method: "POST", body: d });
        onDone();
      } catch (err) { toast(err.message, true); }
      finally { btn.disabled = false; }
    });
  }

  function postHTML(p) {
    const tag = p.game_id ? `<a class="feed-game" href="/game?id=${encodeURIComponent(p.game_id)}">${esc(p.game_icon || "🎮")} ${esc(lang2(p.game_name, p.game_name_es))}</a>` : "";
    const staffBadge = p.role === "staff" || p.role === "admin" || p.role === "subadmin" ? `<span class="role ${esc(p.role)}">${esc(roleLabel(p.role))}</span>` : "";
    return `
      <article class="card fpost ${p.eq_banner ? "has-banner" : ""} ${bgAnimated(p.eq_banner) ? "art-anim" : ""}" data-id="${p.id}" style="${bgStyle(p.eq_banner)}">
        <div class="fpost-head">
          <a href="/profile?id=${p.author_id}">${avatarHTML(p, 40)}</a>
          <div class="fpost-who">
            <div><a class="plain" href="/profile?id=${p.author_id}">${nameHTML(p, t("deletedUser"))}</a> ${p.username ? levelBadge(p.xp) : ""} ${staffBadge}</div>
            <div class="small muted">${esc(ago(p.created_at))}${p.edited_at ? ` · ${t("feed.edited")}` : ""} ${tag}</div>
          </div>
          ${p.mine || p.can_delete ? `<details class="fpost-menu"><summary>⋯</summary><div>
            ${p.mine ? `<button class="link" data-edit>${t("edit")}</button>` : ""}
            ${p.can_delete ? `<button class="link" data-del>${t("delete")}</button>` : ""}
          </div></details>` : ""}
        </div>
        <div class="fpost-body">
          ${p.body ? `<div class="body">${rich(p.body)}</div>` : ""}
          ${p.image ? `<a href="${esc(p.image)}" target="_blank" rel="noopener"><img class="fpost-img" src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>` : ""}
        </div>
        <div class="fpost-actions">
          <button class="like ${p.liked ? "on" : ""}" data-like><span class="emo">${esc(SITE.like_emoji)}</span> <span class="n">${p.likes || ""}</span></button>
          <button class="reply" data-replies>💬 <span class="n">${p.comments || ""}</span></button>
        </div>
        <div class="fpost-replies hidden"></div>
      </article>`;
  }
  const lang2 = (en, es) => (document.documentElement.lang === "es" && es ? es : en);

  async function load(reset = true) {
    const q = new URLSearchParams({ mode });
    if (opts.game) q.set("game", opts.game);
    if (opts.userId) q.set("user", opts.userId);
    if (!reset && cursor) q.set(mode === "recent" || opts.userId ? "before" : "offset", cursor);
    try {
      const r = await api(`/api/feed?${q}`);
      posts = reset ? r.posts : posts.concat(r.posts);
      more = r.more;
      cursor = mode === "recent" || opts.userId ? posts[posts.length - 1]?.id : posts.length;
      if (reset) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", r.posts.map(postHTML).join(""));
      if (!posts.length) list.innerHTML = `<p class="muted">${opts.userId ? t("feed.noPostsUser") : t("feed.empty")}</p>`;
      el.querySelector(".feed-more").innerHTML = more ? `<button data-more>${t("feed.more")}</button>` : "";
    } catch (e) { list.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  async function loadReplies(art) {
    const box = art.querySelector(".fpost-replies");
    const id = art.dataset.id;
    try {
      const { comments } = await api(`/api/feed/${id}/comments`);
      box.innerHTML = `
        ${comments.map((c) => `
          <div class="comment">
            ${avatarHTML(c, 28)}
            <div class="main">
              <div class="who">${nameHTML(c, t("deletedUser"))}${c.username ? levelBadge(c.xp) : ""}<span class="when">${esc(ago(c.created_at))}</span>
                ${c.can_delete ? `<button class="link" data-del-reply="${c.id}">${t("deleteLower")}</button>` : ""}</div>
              <div class="body">${rich(c.body)}</div>
            </div>
          </div>`).join("")}
        <form class="reply-form">
          <input name="body" maxlength="1000" placeholder="${esc(t("feed.replyPh"))}" required autocomplete="off">
          <button class="primary">${t("feed.reply")}</button>
        </form>`;
      const n = art.querySelector("[data-replies] .n"); n.textContent = comments.length || "";
      box.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = e.target.body;
        try { await api(`/api/feed/${id}/comments`, { method: "POST", body: { body: input.value } }); await loadReplies(art); art.querySelector(".reply-form input")?.focus(); }
        catch (err) { toast(err.message, true); }
      });
    } catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
  }

  el.addEventListener("click", async (e) => {
    const art = e.target.closest(".fpost");
    const id = art?.dataset.id;
    if (e.target.closest("[data-mode]")) {
      const b = e.target.closest("[data-mode]");
      mode = b.dataset.mode;
      el.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("active", x === b));
      list.innerHTML = `<p class="muted">${t("loading")}</p>`;
      return load(true);
    }
    if (e.target.closest("[data-more]")) return load(false);
    if (!art) return;
    if (e.target.closest("[data-like]")) {
      const b = e.target.closest("[data-like]");
      try {
        const r = await api(`/api/feed/${id}/like`, { method: "POST" });
        b.classList.toggle("on", r.liked); b.querySelector(".n").textContent = r.likes || "";
        if (r.liked) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
      } catch (err) { toast(err.message, true); }
    } else if (e.target.closest("[data-replies]")) {
      const box = art.querySelector(".fpost-replies");
      box.classList.toggle("hidden");
      if (!box.classList.contains("hidden")) { box.innerHTML = `<p class="muted small">${t("loading")}</p>`; loadReplies(art); }
    } else if (e.target.closest("[data-del-reply]")) {
      if (!confirm(t("sp.confirmDeleteComment"))) return;
      try { await api(`/api/feed-comments/${e.target.closest("[data-del-reply]").dataset.delReply}`, { method: "DELETE" }); loadReplies(art); }
      catch (err) { toast(err.message, true); }
    } else if (e.target.closest("[data-del]")) {
      if (!confirm(t("feed.confirmDelete"))) return;
      try { await api(`/api/feed/${id}`, { method: "DELETE" }); art.remove(); }
      catch (err) { toast(err.message, true); }
    } else if (e.target.closest("[data-edit]")) {
      const p = posts.find((x) => String(x.id) === id);
      const holder = document.createElement("div");
      holder.innerHTML = composerHTML(p);
      art.replaceWith(holder);
      const form = holder.querySelector("form");
      form.querySelector("[data-cancel]").onclick = () => load(true);
      wireComposer(form, () => { toast(t("saved")); load(true); }, id);
    }
  });

  const composer = el.querySelector("form.composer");
  if (composer) wireComposer(composer, () => {
    composer.reset();
    composer.querySelector(".composer-extra").classList.add("hidden");
    if (opts.game) composer.game_id.value = opts.game;
    if (mode !== "recent" && !opts.userId) {
      mode = "recent";
      el.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("active", x.dataset.mode === "recent"));
    }
    toast(t("feed.posted")); load(true);
  });

  load(true);
}
