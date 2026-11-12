// GET /api/videos/<id>.<ext> — streams an uploaded clip from R2, with Range support so players can seek.
export async function onRequestGet({ env, params, request }) {
  const m = /^([a-f0-9]{32})\.(mp4|webm|mov)$/.exec(params.file || "");
  if (!m || !env.VIDEOS) return new Response("Not found", { status: 404 });
  const key = `v/${m[1]}.${m[2]}`;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
  let obj;
  if (range) {
    const head = await env.VIDEOS.head(key);
    if (!head) return new Response("Not found", { status: 404 });
    const size = head.size;
    let start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
    let end = range[1] !== "" && range[2] !== "" ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    obj = await env.VIDEOS.get(key, { range: { offset: start, length: end - start + 1 } });
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { status: 206, headers: { "content-type": head.httpMetadata?.contentType || "video/mp4", "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "cache-control": "public, max-age=31536000, immutable" } });
  }
  obj = await env.VIDEOS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType || "video/mp4", "content-length": String(obj.size),
    "accept-ranges": "bytes", "cache-control": "public, max-age=31536000, immutable" } });
}
export const onRequestHead = async (ctx) => { const r = await onRequestGet(ctx); return new Response(null, { status: r.status, headers: r.headers }); };
