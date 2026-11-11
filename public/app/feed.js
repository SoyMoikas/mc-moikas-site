// Private "For you" feed: composer, posts, likes, replies. Approved members only.
import { uploadImage } from "./common.js";
import { api, esc, rich, can, t, ago, toast, roleLabel, loginHint, levelBadge, avatarHTML, nameHTML, SITE, gameLabel, bgStyle, bgAnimated, bgWall, textAttrs, onPulse } from "./common.js";
import { catalogItem, itemName, textFx } from "./cosmetics.js";

// Text styles + backgrounds you own, for the composer's 🎨 picker (fetched once per page).
let ownedLooks = null;
function loadLooks() {
  ownedLooks ??= api("/api/store").then(({ items, user }) => {
    const mine = new Set(user?.owned || []);
    const pick = (type) => items.filter((i) => i.type === type && mine.has(i.id)).map((i) => i.id);
    return { styles: pick("textstyle"), bgs: pick("banner") };
  }).catch(() => ({ styles: [], bgs: [] }));
  return ownedLooks;
}
const LOOK_KEY = "moikas.postLook";
const lastLook = () => { try { return JSON.parse(localStorage.getItem(LOOK_KEY) || "{}"); } catch { return {}; } };
const saveLook = (l) => { try { localStorage.setItem(LOOK_KEY, JSON.stringify(l)); } catch { /* storage off */ } };

// Classes/styles for a post's own look (style + bg saved on the post).
function lookAttrs(style, bg) {
  const a = textAttrs(null, style || null);
  return {
    art: `${bg ? "has-banner" : ""} ${bgWall(bg) ? "wall" : ""} ${bgAnimated(bg) ? "art-anim" : ""}`,
    artStyle: bg ? bgStyle(bg) : "",
    cls: a.cls, style: a.style,
  };
}

// opts: { game: id (filter + preselect), userId: profile filter, composer: bool, modes: bool }
export function mountFeed(el, user, opts = {}) {
  el.classList.add("feed");
  if (!can(user, "member")) {
    el.innerHTML = `<div class="card feed-locked"><b>🔒 ${t("feed.private")}</b><p class="hint">${user ? t("sp.pendingNotice") : loginHint(user)}</p></div>`;
    return;
  }
  let mode = opts.userId ? "recent" : "foryou";
  let posts = [], more = false, cursor = null, seen = 0;

  el.innerHTML = `
    ${opts.composer !== false ? composerHTML() : ""}
    ${opts.modes !== false && !opts.userId ? `<div class="feed-modes">
      <button data-mode="foryou" class="active">${t("feed.forYou")}</button>
      <button data-mode="recent">${t("feed.recent")}</button></div>` : ""}
    <button type="button" class="feed-new hidden"></button>
    <div class="feed-list"><p class="muted">${t("loading")}</p></div>
    <div class="feed-more"></div>`;
  const list = el.querySelector(".feed-list");
  const newBar = el.querySelector(".feed-new");

  function composerHTML(p = null) {
    return `
      <form class="card composer${p ? " editing" : ""}">
        <div class="composer-row">
          ${p ? "" : avatarHTML(user, 40)}
          <textarea name="body" maxlength="2000" rows="${p ? 3 : 2}" placeholder="${esc(t("feed.placeholder"))}">${esc(p?.body || "")}</textarea>
        </div>
        <div class="composer-look hidden"></div>
        <div class="composer-preview hidden"></div>
        <div class="composer-img ${p?.image ? "" : "hidden"}">
          <img alt="" src="${esc(p?.image || "")}"><span class="up-status small"></span>
          <button type="button" class="link small" data-img-remove>✕ ${t("feed.removeImage")}</button>
        </div>
        <div class="composer-extra hidden">
          <input name="image" placeholder="${esc(t("feed.imagePh"))}" value="${esc(p?.image || "")}">
        </div>
        <input type="file" name="imgfile" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
        <div class="actions">
          <button type="button" class="link" data-add-image title="${esc(t("feed.imageHelp"))}">🖼 ${t("feed.addImage")}</button>
          <button type="button" class="link small" data-img-link>🔗</button>
          <button type="button" class="link" data-look>🎨 ${t("feed.style")}<span class="look-dot hidden"></span></button>
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

  function wireComposer(form, onDone, postId = null, start = null) {
    // Images: pick a file, paste a screenshot, drag one in, or (🔗) paste a link.
    const imgBox = form.querySelector(".composer-img"), status = imgBox.querySelector(".up-status"), submitBtn = form.querySelector("button.primary");
    const showImg = (url) => { form.image.value = url || ""; imgBox.classList.toggle("hidden", !url); imgBox.querySelector("img").src = url || ""; };
    async function addFile(file) {
      if (!file) return;
      imgBox.classList.remove("hidden"); imgBox.querySelector("img").src = URL.createObjectURL(file);
      status.textContent = t("up.uploading"); submitBtn.disabled = true;
      try { showImg(await uploadImage(file)); status.textContent = ""; }
      catch (e) { toast(e.message, true); showImg(""); status.textContent = ""; }
      finally { submitBtn.disabled = false; }
    }
    const fileIn = form.imgfile;
    form.querySelector("[data-add-image]").onclick = () => fileIn.click();
    fileIn.onchange = () => { addFile(fileIn.files[0]); fileIn.value = ""; };
    form.querySelector("[data-img-link]").onclick = () => { form.querySelector(".composer-extra").classList.toggle("hidden"); form.image.focus(); };
    form.image.addEventListener("change", () => showImg(form.image.value.trim()));
    form.querySelector("[data-img-remove]").onclick = () => showImg("");
    form.body.addEventListener("paste", (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); addFile(f); } });
    form.addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); form.classList.add("drop"); } });
    form.addEventListener("dragleave", () => form.classList.remove("drop"));
    form.addEventListener("drop", (e) => { const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); form.classList.remove("drop"); addFile(f); } });
    // Per-post look: pick a text style and a background you own; preview updates as you type.
    const look = { style: start ? start.style : null, bg: start ? start.bg : null };
    const panel = form.querySelector(".composer-look"), preview = form.querySelector(".composer-preview");
    let looks = { styles: [], bgs: [] };
    const showPreview = () => {
      const on = !!(look.style || look.bg);
      form.querySelector(".look-dot").classList.toggle("hidden", !on);
      preview.classList.toggle("hidden", !on);
      if (!on) return;
      const a = lookAttrs(look.style, look.bg);
      preview.innerHTML = `<div class="card fpost ${a.art}" style="${a.artStyle}"><div class="fpost-body">
        <div class="body${a.cls}" style="${a.style}">${form.body.value.trim() ? rich(form.body.value) : esc(t("feed.previewEmpty"))}</div></div></div>`;
    };
    const chips = () => {
      const styleChip = (id) => { const f = textFx(id); return `<button type="button" class="look-chip ${look.style === id ? "on" : ""}" data-pick-style="${esc(id)}">
        <span class="body${f.cls}" style="${f.style}">Aa</span><span class="small">${esc(itemName(catalogItem(id)))}</span></button>`; };
      const bgChip = (id) => `<button type="button" class="look-chip ${look.bg === id ? "on" : ""}" data-pick-bg="${esc(id)}">
        <span class="look-swatch has-art ${bgAnimated(id) ? "art-anim" : ""}" style="${bgStyle(id)}"></span><span class="small">${esc(itemName(catalogItem(id)))}</span></button>`;
      panel.innerHTML = `
        <div class="look-row"><b class="small">${t("feed.textStyle")}</b>
          <button type="button" class="look-chip ${look.style ? "" : "on"}" data-pick-style=""><span>Aa</span><span class="small">${t("feed.plain")}</span></button>
          ${looks.styles.map(styleChip).join("")}</div>
        <div class="look-row"><b class="small">${t("feed.background")}</b>
          <button type="button" class="look-chip ${look.bg ? "" : "on"}" data-pick-bg=""><span class="look-swatch"></span><span class="small">${t("feed.plain")}</span></button>
          ${looks.bgs.map(bgChip).join("")}</div>
        ${!looks.styles.length && !looks.bgs.length ? `<p class="hint">${t("feed.noLooks")} <a href="/store#text-styles">${t("nav.store")}</a></p>` : ""}`;
    };
    loadLooks().then((l) => {
      looks = l;
      if (!start) { // new post: start with your last choice, if you still own it
        const last = lastLook();
        if (l.styles.includes(last.style)) look.style = last.style;
        if (l.bgs.includes(last.bg)) look.bg = last.bg;
      }
      chips(); showPreview();
    });
    form.querySelector("[data-look]").onclick = () => panel.classList.toggle("hidden");
    panel.addEventListener("click", (e) => {
      const s = e.target.closest("[data-pick-style]"), b = e.target.closest("[data-pick-bg]");
      if (s) look.style = s.dataset.pickStyle || null;
      else if (b) look.bg = b.dataset.pickBg || null;
      else return;
      if (!start) saveLook(look);
      chips(); showPreview();
    });
    form.body.addEventListener("input", showPreview);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = { body: form.body.value, image: form.image.value.trim() || null, game_id: form.game_id.value || null, style: look.style, bg: look.bg, club: opts.club || null };
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
    const look = lookAttrs(p.post_style, p.post_bg); // each post keeps the style/background it was posted with
    const tag = (p.game_id ? `<a class="feed-game" href="/game?id=${encodeURIComponent(p.game_id)}">${esc(p.game_icon || "🎮")} ${esc(lang2(p.game_name, p.game_name_es))}</a>` : "")
      + (p.club && !opts.club ? `<a class="feed-game" href="/juntos?club=${encodeURIComponent(p.club)}#clubs">${esc(p.club_icon || "✨")} ${esc(p.club_name || p.club)}</a>` : "");
    const staffBadge = p.role === "staff" || p.role === "admin" || p.role === "subadmin" ? `<span class="role ${esc(p.role)}">${esc(roleLabel(p.role))}</span>` : "";
    return `
      <article class="card fpost ${look.art}" data-id="${p.id}" style="${look.artStyle}">
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
          ${p.body ? `<div class="body${look.cls}" style="${look.style}">${rich(p.body)}</div>` : ""}
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
    if (opts.club) q.set("club", opts.club);
    if (opts.userId) q.set("user", opts.userId);
    if (!reset && cursor) q.set(mode === "recent" || opts.userId ? "before" : "offset", cursor);
    try {
      const r = await api(`/api/feed?${q}`);
      posts = reset ? r.posts : posts.concat(r.posts);
      for (const p of r.posts) seen = Math.max(seen, p.id);
      if (reset) newBar.classList.add("hidden");
      more = r.more;
      cursor = mode === "recent" || opts.userId ? posts[posts.length - 1]?.id : posts.length;
      if (reset) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", r.posts.map(postHTML).join(""));
      if (!posts.length) list.innerHTML = `<p class="muted">${opts.userId ? t("feed.noPostsUser") : t("feed.empty")}</p>`;
      el.querySelector(".feed-more").innerHTML = more ? `<button data-more>${t("feed.more")}</button>` : "";
      // opened from a notification (/#post-123): jump to that post and open its replies
      const m = /^#post-(\d+)$/.exec(location.hash);
      if (reset && m) {
        const art = list.querySelector(`.fpost[data-id="${m[1]}"]`);
        if (art) {
          art.scrollIntoView({ block: "center" }); art.classList.add("fresh");
          art.querySelector("[data-replies]")?.click();
          history.replaceState(null, "", location.pathname + location.search);
        }
      }
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
      wireComposer(form, () => { toast(t("saved")); load(true); }, id, { style: p.post_style || null, bg: p.post_bg || null });
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

  // Live updates: when the pulse says someone posted, fetch the newest posts and slide them in at the top.
  // If you've scrolled down past the top of the feed, a bar lets you jump back up to them.
  let unseen = 0, checking = false;
  async function checkNew() {
    if (checking || document.hidden || !el.isConnected || !seen) return;
    if (el.querySelector(".composer.editing")) return; // don't shuffle things while you're editing
    checking = true;
    const q = new URLSearchParams({ mode: "recent" });
    if (opts.game) q.set("game", opts.game);
    if (opts.club) q.set("club", opts.club);
    if (opts.userId) q.set("user", opts.userId);
    try {
      const r = await api(`/api/feed?${q}`);
      const fresh = r.posts.filter((p) => p.id > seen && !list.querySelector(`.fpost[data-id="${p.id}"]`));
      if (!fresh.length) return;
      for (const p of fresh) seen = Math.max(seen, p.id);
      posts = fresh.concat(posts);
      list.querySelector(":scope > p.muted")?.remove(); // "no posts yet"
      list.insertAdjacentHTML("afterbegin", fresh.map(postHTML).join(""));
      fresh.forEach((p) => list.querySelector(`.fpost[data-id="${p.id}"]`)?.classList.add("fresh"));
      if (list.getBoundingClientRect().top < 0) {
        unseen += fresh.filter((p) => !p.mine).length;
        if (unseen) {
          newBar.textContent = t(unseen === 1 ? "feed.newPost" : "feed.newPosts").replace("{n}", unseen);
          newBar.classList.remove("hidden");
        }
      }
    } catch { /* offline for a moment; the next pulse will retry */ }
    finally { checking = false; }
  }
  newBar.onclick = () => {
    newBar.classList.add("hidden"); unseen = 0;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  addEventListener("scroll", () => {
    if (unseen && list.getBoundingClientRect().top >= 0) { unseen = 0; newBar.classList.add("hidden"); }
  }, { passive: true });
  onPulse("feed", checkNew);
  setInterval(checkNew, 30_000); // fallback for pages without a chat (e.g. profiles)
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkNew(); });

  load(true);
}
