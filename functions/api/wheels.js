import { need, hasRole } from "../../lib/auth.js";
import { json, body, str, int, now, err } from "../../lib/util.js";

// Picker wheels. entries = [{ name, tag? }]. Shared wheels show up for everyone; only the owner (or staff) edits them.
const clean = (list) => (Array.isArray(list) ? list : []).map((e) => ({ name: String(e?.name ?? "").trim().slice(0, 40), tag: String(e?.tag ?? "").trim().slice(0, 20) || undefined }))
  .filter((e) => e.name).slice(0, 100);

export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const { results } = await env.DB.prepare(
    `SELECT w.*, u.username AS owner FROM wheels w JOIN users u ON u.id = w.user_id WHERE w.user_id = ? OR w.shared = 1 ORDER BY w.user_id = ? DESC, w.updated_at DESC LIMIT 100`).bind(me.id, me.id).all();
  return json({ me: me.id, staff: hasRole(me, "staff"), wheels: results.map((w) => ({ ...w, entries: JSON.parse(w.entries || "[]"), shared: !!w.shared, mine: w.user_id === me.id })) });
}

// POST {action: "save", id?, title, entries, shared} · {action: "delete", id}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now();
  const id = int(b.id, "id");
  const own = id ? await env.DB.prepare("SELECT user_id FROM wheels WHERE id = ?").bind(id).first() : null;
  if (id && !own) return err(404, "Wheel not found");
  if (own && own.user_id !== me.id && !hasRole(me, "staff")) return err(403, "Only whoever made it can change it — save a copy instead");
  if (b.action === "delete") {
    await env.DB.prepare("DELETE FROM wheels WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  const title = str(b.title, 50, "title");
  const entries = clean(b.entries);
  if (!title) return err(400, "Give the wheel a name");
  if (entries.length < 2) return err(400, "Add at least 2 options");
  if (!id) {
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM wheels WHERE user_id = ?").bind(me.id).first()).n;
    if (n >= 30) return err(429, "You have 30 wheels already — delete one first");
    const r = await env.DB.prepare("INSERT INTO wheels (user_id, title, entries, shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(me.id, title, JSON.stringify(entries), b.shared ? 1 : 0, t, t).run();
    return json({ id: r.meta.last_row_id });
  }
  await env.DB.prepare("UPDATE wheels SET title = ?, entries = ?, shared = ?, updated_at = ? WHERE id = ?").bind(title, JSON.stringify(entries), b.shared ? 1 : 0, t, id).run();
  return json({ id });
}
