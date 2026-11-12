// Videos on posts. Stored as a short code: an embed ("yt:ID", "yts:ID" Shorts, "twc:SLUG" Twitch clip, "twv:ID" Twitch VOD,
// "stb:ID" Streamable, "tt:ID" TikTok, "ig:ID" Instagram reel) or an upload ("/api/videos/<id>.<ext>", file in R2).
// Keep parseVideo in sync with public/app/video.js.
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

/** Delete an uploaded clip (when its post is deleted or the video is replaced). */
export async function dropVideo(env, url, userId) {
  const m = UPLOAD_VIDEO.exec(url || "");
  if (!m) return;
  const row = await env.DB.prepare("SELECT r2_key FROM videos WHERE id = ? AND user_id = ?").bind(m[1], userId).first();
  if (!row) return;
  if (env.VIDEOS) await env.VIDEOS.delete(row.r2_key).catch(() => {});
  await env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(m[1]).run();
}
