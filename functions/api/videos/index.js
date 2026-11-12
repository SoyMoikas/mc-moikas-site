import { json, err, now } from "../../../lib/util.js";
import { need, hasPerm } from "../../../lib/auth.js";

// Video uploads go to Cloudflare R2 (Pages → Settings → Bindings → R2 bucket, variable name VIDEOS).
// Without that binding only links (YouTube, Twitch, Streamable, TikTok, Instagram) work.
export const MAX_VIDEO = 95 * 1024 * 1024;  // Pages Functions accept bodies up to 100 MB
const DAILY = 5;
const TYPES = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
const capBytes = (env) => (Number(env.VIDEO_CAP_GB) || 9) * 1024 ** 3; // stay under R2's free 10 GB

// GET → can I upload? { enabled, max, used, cap }
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  if (!env.VIDEOS) return json({ enabled: false });
  const used = (await env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM videos").first()).n;
  return json({ enabled: true, max: MAX_VIDEO, used, cap: capBytes(env) });
}

// POST raw video bytes (Content-Type video/mp4|webm|quicktime) → { url: "/api/videos/<id>.<ext>" }
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  if (!env.VIDEOS) return err(501, "Video uploads aren't set up yet — paste a YouTube/Twitch/Streamable link instead");
  const type = (request.headers.get("content-type") || "").split(";")[0].trim();
  const ext = TYPES[type];
  if (!ext) return err(415, "Send an MP4, WebM or MOV video");
  const len = Number(request.headers.get("content-length") || 0);
  if (!len || len > MAX_VIDEO) return err(413, `Video is too big (max ${Math.round(MAX_VIDEO / 1048576)} MB)`);
  const t = now();
  if (!hasPerm(me, "store")) {
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM videos WHERE user_id = ? AND created_at > ?").bind(me.id, t - 86400000).first()).n;
    if (n >= DAILY) return err(429, `You've uploaded ${DAILY} videos today. Try again tomorrow.`);
  }
  const used = (await env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM videos").first()).n;
  if (used + len > capBytes(env)) return err(507, "The site's video storage is full — ask staff to clean up old clips, or paste a link instead");
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const key = `v/${id}.${ext}`;
  const obj = await env.VIDEOS.put(key, request.body, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  if (!obj || obj.size > MAX_VIDEO) { await env.VIDEOS.delete(key); return err(413, "Video is too big"); }
  await env.DB.prepare("INSERT INTO videos (id, user_id, r2_key, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, me.id, key, type, obj.size, t).run();
  return json({ url: `/api/videos/${id}.${ext}`, size: obj.size }, 201);
}
