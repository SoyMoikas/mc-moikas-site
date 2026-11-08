import { json, err, body } from "../../lib/util.js";
import { need } from "../../lib/auth.js";
import { MAX_ACCESSORIES, ownedSet, owns } from "../../lib/catalog.js";

// Extra accessories on top of your equipped one: { extras: [{ id, size, x, y, rotate }, …] }
// At most MAX_ACCESSORIES − 1, each an accessory (hat) you own, no repeats, not the one already equipped.
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "pending");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const list = Array.isArray(b.extras) ? b.extras : [];
  if (list.length > MAX_ACCESSORIES - 1) return err(400, `You can wear up to ${MAX_ACCESSORIES} accessories`);
  const bought = await ownedSet(env, user.id);
  const seen = new Set([user.eq_hat].filter(Boolean)), out = [];
  const n = (v, lo, hi, d) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  for (const a of list) {
    const id = String(a?.id || "").slice(0, 40);
    if (!id || seen.has(id)) continue;
    const r = await env.DB.prepare("SELECT id, type, reward_level FROM store_items WHERE id = ?").bind(id).first();
    if (!r || r.type !== "hat") return err(400, "That isn't an accessory");
    if (!owns({ ...r, reward_level: r.reward_level ?? null }, bought, user.xp)) return err(403, "You don't own that accessory");
    seen.add(id);
    const e = { id };
    if (a.x !== undefined && a.y !== undefined) Object.assign(e, { size: n(a.size, 30, 200, 62), x: n(a.x, -150, 150, 0), y: n(a.y, -150, 150, 0), rotate: n(a.rotate, -180, 180, 0) });
    out.push(e);
  }
  const s = out.length ? JSON.stringify(out) : null;
  await env.DB.prepare("UPDATE users SET acc_extra = ? WHERE id = ?").bind(s, user.id).run();
  return json({ acc_extra: s });
}
