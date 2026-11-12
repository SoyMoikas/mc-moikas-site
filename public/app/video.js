// Videos on feed posts: links (YouTube, Twitch, Streamable, TikTok, Instagram) or uploaded clips. Keep parseVideo in sync with lib/video.js.
import { esc, t } from "./common.js";
export const UPLOAD_VIDEO = /^\/api\/videos\/([a-f0-9]{32})\.(mp4|webm|mov)$/;
export function parseVideo(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (UPLOAD_VIDEO.test(s)) return s;
  if (/^(yt|yts|twc|twv|stb|tt|ig):[\w-]{3,100}$/.test(s)) return s;
  let u; try { u = new URL(s); } catch { return null; }
  const h = u.hostname.replace(/^(www|m|music)\./, ""), p = u.pathname;
  const pick = (re) => re.exec(p)?.[1];
  if (h === "youtu.be") { const id = pick(/^\/([\w-]{11})/); return id ? `yt:${id}` : null; }
  if (h === "youtube.com" || h === "youtube-nocookie.com") {
    const sh = pick(/^\/shorts\/([\w-]{11})/); if (sh) return `yts:${sh}`;
    const id = u.searchParams.get("v") || pick(/^\/(?:embed|live)\/([\w-]{11})/);
    return id && /^[\w-]{11}$/.test(id) ? `yt:${id}` : null;
  }
  if (h === "clips.twitch.tv") { const c = pick(/^\/([\w-]{3,100})/); return c && c !== "embed" ? `twc:${c}` : null; }
  if (h === "twitch.tv") {
    const c = pick(/^\/[\w]+\/clip\/([\w-]{3,100})/); if (c) return `twc:${c}`;
    const v = pick(/^\/videos\/(\d{3,15})/); if (v) return `twv:${v}`;
    return null;
  }
  if (h === "streamable.com") { const id = pick(/^\/(?:e\/)?([a-z0-9]{3,12})$/i); return id ? `stb:${id}` : null; }
  if (h === "tiktok.com") { const id = pick(/\/video\/(\d{8,25})/); return id ? `tt:${id}` : null; }
  if (h === "instagram.com") { const id = pick(/^\/(?:reel|reels|p)\/([\w-]{5,40})/); return id ? `ig:${id}` : null; }
  return null;
}

const VERTICAL = new Set(["yts", "tt", "ig"]);
/** Player for a stored video code. YouTube loads only when tapped (thumbnail first); the rest load lazily. */
export function videoHTML(code) {
  if (!code) return "";
  const up = UPLOAD_VIDEO.exec(code);
  if (up) return `<div class="fvid up"><video src="${esc(code)}" controls preload="metadata" playsinline></video></div>`;
  const [kind, id] = code.split(":");
  const host = location.hostname;
  const src = {
    yt: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`, yts: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
    twc: `https://clips.twitch.tv/embed?clip=${encodeURIComponent(id)}&parent=${host}&autoplay=false`, twv: `https://player.twitch.tv/?video=${id}&parent=${host}&autoplay=false`,
    stb: `https://streamable.com/e/${id}`, tt: `https://www.tiktok.com/embed/v2/${id}`, ig: `https://www.instagram.com/reel/${id}/embed`,
  }[kind];
  if (!src) return "";
  const cls = `fvid ${VERTICAL.has(kind) ? "tall" : ""} ${kind === "ig" ? "ig" : ""}`;
  if (kind === "yt" || kind === "yts")
    return `<div class="${cls}"><button type="button" class="fvid-face" data-vsrc="${esc(src)}" style="background-image:url('https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg')" aria-label="${esc(t("vid.play"))}"><span>▶</span></button></div>`;
  return `<div class="${cls}"><iframe src="${esc(src)}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
}
/** Swap a YouTube thumbnail for the real player on tap (call once per page). */
export function wireVideoFaces(root = document) {
  root.addEventListener("click", (e) => {
    const f = e.target.closest("[data-vsrc]");
    if (!f) return;
    f.outerHTML = `<iframe src="${esc(f.dataset.vsrc)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  });
}
let cfg = null;
export const uploadConfig = async (api) => (cfg ||= api("/api/videos").catch(() => ({ enabled: false })));
/** Upload a clip with a progress callback → "/api/videos/<id>.<ext>". */
export function uploadVideo(file, onProgress) {
  return new Promise((ok, fail) => {
    const types = { "video/mp4": 1, "video/webm": 1, "video/quicktime": 1 };
    if (!types[file.type]) return fail(new Error(t("vid.badType")));
    const x = new XMLHttpRequest();
    x.open("POST", "/api/videos");
    x.setRequestHeader("content-type", file.type);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { /* */ } x.status < 300 ? ok(d.url) : fail(new Error(d.error || `Upload failed (${x.status})`)); };
    x.onerror = () => fail(new Error(t("vid.netErr")));
    x.send(file);
  });
}
