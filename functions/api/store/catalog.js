import { json } from "../../../lib/util.js";

// Public, cacheable list of how every item looks (so avatars render everywhere). Includes inactive items.
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare("SELECT id, type, name, name_es, visual FROM store_items").all();
  const items = {};
  for (const r of results) {
    let visual = {};
    try { visual = JSON.parse(r.visual); } catch { /* ignore */ }
    items[r.id] = { type: r.type, name: r.name, name_es: r.name_es, visual };
  }
  // uploaded fonts (Admin → Store → item editor → ⬆ Upload font)
  const fonts = (await env.DB.prepare("SELECT id, name, format FROM fonts").all().catch(() => ({ results: [] }))).results;
  return json({ items, fonts }, 200, { "cache-control": "public, max-age=60" });
}
