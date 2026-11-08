import { json, err, body } from "../../lib/util.js";
import { need } from "../../lib/auth.js";
import { PART_SLOTS, ownedSet, owns } from "../../lib/catalog.js";

const HEX = /^#[0-9a-f]{6}$/i;

// Save your built avatar: { use: bool, body: "#hex", bg: "#hex", parts: { shape: id, eyes: id, … }, adjust: { eyes: { x, y, s } } }.
// Every part must be an "Avatar part" for that slot that you own. use=false goes back to your Discord picture
// but keeps the build for later.
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "pending");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const parts = {};
  const ids = Object.entries(b.parts || {}).filter(([slot, id]) => PART_SLOTS.includes(slot) && id);
  if (ids.length) {
    const bought = await ownedSet(env, user.id);
    for (const [slot, id] of ids) {
      const r = await env.DB.prepare("SELECT id, type, visual, reward_level FROM store_items WHERE id = ?").bind(String(id).slice(0, 40)).first();
      let v = {}; try { v = JSON.parse(r?.visual || "{}"); } catch { /* bad json */ }
      if (!r || r.type !== "part" || v.slot !== slot) return err(400, `That isn't a ${slot} part`);
      if (!owns({ ...r, reward_level: r.reward_level ?? null }, bought, user.xp)) return err(403, "You don't own that part");
      parts[slot] = r.id;
    }
  }
  const use = !!b.use;
  if (use && !parts.shape) return err(400, "Pick a shape first");
  // per-part position/size nudges: { eyes: { x, y, s } } with x/y −30…30 and s (size %) 50…150
  const adjust = {};
  for (const slot of Object.keys(parts)) {
    const a = b.adjust?.[slot];
    if (!a) continue;
    const n = (v, lo, hi, d) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
    const x = n(a.x, -30, 30, 0), y = n(a.y, -30, 30, 0), s = n(a.s, 50, 150, 100);
    if (x || y || s !== 100) adjust[slot] = { x, y, s };
  }
  const build = { use, body: HEX.test(b.body || "") ? b.body : "#f2c14e", bg: HEX.test(b.bg || "") ? b.bg : "#2a3350", parts, adjust };
  const s = JSON.stringify(build);
  await env.DB.prepare("UPDATE users SET avatar_build = ? WHERE id = ?").bind(s, user.id).run();
  return json({ avatar_build: s });
}
