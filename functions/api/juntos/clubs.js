import { getUser, need, hasRole } from "../../../lib/auth.js";
import { json, body, str, now, err } from "../../../lib/util.js";

// GET → clubs with members; POST {action: "join"|"leave", slug} | {action: "create", name, icon, description} | {action: "delete", slug} (staff)
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ clubs: [] });
  const clubs = (await env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM club_members m WHERE m.slug = c.slug) AS members,
            EXISTS (SELECT 1 FROM club_members m WHERE m.slug = c.slug AND m.user_id = ?) AS mine,
            (SELECT COUNT(*) FROM social_posts p WHERE p.club = c.slug AND p.deleted = 0 AND p.created_at > ?) AS week_posts
       FROM clubs c ORDER BY mine DESC, members DESC, c.name`).bind(me.id, now() - 7 * 86400000).all()).results;
  const people = (await env.DB.prepare(`SELECT m.slug, u.id, u.username, u.avatar FROM club_members m JOIN users u ON u.id = m.user_id`).all()).results;
  return json({ clubs: clubs.map((c) => ({ ...c, people: people.filter((p) => p.slug === c.slug).slice(0, 12) })) });
}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  if (b.action === "join") await env.DB.prepare("INSERT OR IGNORE INTO club_members (slug, user_id, joined_at) SELECT slug, ?, ? FROM clubs WHERE slug = ?").bind(me.id, now(), b.slug).run();
  else if (b.action === "leave") await env.DB.prepare("DELETE FROM club_members WHERE slug = ? AND user_id = ?").bind(b.slug, me.id).run();
  else if (b.action === "create") {
    const name = str(b.name, 40, "name");
    if (!name) return err(400, "Name the club");
    const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
    if (!slug) return err(400, "Pick another name");
    const mine = (await env.DB.prepare("SELECT COUNT(*) AS n FROM clubs WHERE created_by = ?").bind(me.id).first()).n;
    if (mine >= 3 && !hasRole(me, "staff")) return err(429, "You can create up to 3 clubs");
    const r = await env.DB.prepare("INSERT OR IGNORE INTO clubs (slug, name, icon, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(slug, name, str(b.icon, 8, "icon") || "✨", b.description ? str(b.description, 160, "description") : null, me.id, now()).run();
    if (!r.meta.changes) return err(409, "That club already exists");
    await env.DB.prepare("INSERT OR IGNORE INTO club_members (slug, user_id, joined_at) VALUES (?, ?, ?)").bind(slug, me.id, now()).run();
    return json({ slug });
  } else if (b.action === "delete") {
    const c = await env.DB.prepare("SELECT created_by FROM clubs WHERE slug = ?").bind(b.slug).first();
    if (!c) return err(404, "Not found");
    if (c.created_by !== me.id && !hasRole(me, "staff")) return err(403, "Not allowed");
    await env.DB.prepare("DELETE FROM clubs WHERE slug = ?").bind(b.slug).run();
  } else return err(400, "Bad action");
  return json({ ok: true });
}
