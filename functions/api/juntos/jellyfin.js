import { need, hasRole } from "../../../lib/auth.js";
import { json, body, err, now } from "../../../lib/util.js";
import { notify } from "../../../lib/notify.js";
import { requestReset, decideReset, myReset, pendingApprovals } from "../../../lib/jfreset.js";

// Jellyfin on the site: your user name (so movie nights know what you're watching) + invite links.
// Staff paste Wizarr invite links; a member without an account claims one (single-use links go to one person each; "multi" links are shared).
// GET → { name, url, invite: your claimed link | null, available, staff: [...] (staff only) }
// POST {name} | {action:"claim"} | staff: {action:"add", urls, multi} {action:"delete", id}
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const r = await env.DB.prepare("SELECT jellyfin_name FROM users WHERE id = ?").bind(me.id).first();
  let invite = null, available = 0, list = null;
  try {
    invite = (await env.DB.prepare("SELECT url FROM jellyfin_invites WHERE claimed_by = ? ORDER BY claimed_at DESC LIMIT 1").bind(me.id).first())?.url || null;
    available = (await env.DB.prepare("SELECT COUNT(*) AS n FROM jellyfin_invites WHERE claimed_by IS NULL OR multi = 1").first()).n;
    if (hasRole(me, "staff")) list = (await env.DB.prepare(`SELECT i.id, i.url, i.multi, i.created_at, i.claimed_at, u.username AS claimed_name
      FROM jellyfin_invites i LEFT JOIN users u ON u.id = i.claimed_by ORDER BY (i.claimed_by IS NULL OR i.multi = 1) DESC, i.created_at DESC LIMIT 60`).all()).results;
  } catch { /* before migration 033 */ }
  let reset = null, approvals = null;
  try { reset = await myReset(env, me.id); if (hasRole(me, "staff")) approvals = await pendingApprovals(env); } catch { /* before migration 042 */ }
  return json({ name: r?.jellyfin_name || null, url: env.JELLYFIN_PUBLIC_URL || null, invite, available, staff: list, reset, approvals });
}

export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;

  if (b.action === "claim") {
    const mine = await env.DB.prepare("SELECT url FROM jellyfin_invites WHERE claimed_by = ? LIMIT 1").bind(me.id).first();
    if (mine) return json({ invite: mine.url });
    // Shared link first (doesn't use anything up), otherwise grab the oldest free single-use link.
    const multi = await env.DB.prepare("SELECT url FROM jellyfin_invites WHERE multi = 1 ORDER BY created_at DESC LIMIT 1").first();
    if (multi) return json({ invite: multi.url });
    const got = await env.DB.prepare(`UPDATE jellyfin_invites SET claimed_by = ?, claimed_at = ?
      WHERE id = (SELECT id FROM jellyfin_invites WHERE claimed_by IS NULL AND multi = 0 ORDER BY created_at LIMIT 1) RETURNING url`).bind(me.id, now()).first();
    const left = (await env.DB.prepare("SELECT COUNT(*) AS n FROM jellyfin_invites WHERE claimed_by IS NULL").first()).n;
    const staff = (await env.DB.prepare("SELECT id FROM users WHERE role IN ('staff', 'subadmin', 'admin')").all()).results.map((u) => u.id);
    if (!got) {
      await notify(env, staff, "announce", { title: `🎞️ ${me.username} quiere entrar a Jellyfin`, body: "Ya no hay invitaciones. Crea una en Wizarr y pégala en Juntos → Cine.", url: "/juntos#cine" });
      return json({ invite: null, asked: true });
    }
    if (left === 0) await notify(env, staff, "announce", { title: "🎞️ Se acabaron las invitaciones de Jellyfin", body: `${me.username} usó la última. Pega más en Juntos → Cine.`, url: "/juntos#cine" });
    return json({ invite: got.url });
  }

  if (b.action === "reset") {
    const r = await requestReset(env, me);
    return r.error ? err(409, r.error) : json(r);
  }
  if (b.action === "reset_ok" || b.action === "reset_no") {
    if (!hasRole(me, "staff")) return err(403, "Staff only");
    return (await decideReset(env, me, +b.id || 0, b.action === "reset_ok")) ? json({ ok: true }) : err(404, "Already handled");
  }

  if (b.action === "add" || b.action === "delete") {
    if (!hasRole(me, "staff")) return err(403, "Staff only");
    if (b.action === "delete") {
      await env.DB.prepare("DELETE FROM jellyfin_invites WHERE id = ?").bind(+b.id || 0).run();
      return json({ ok: true });
    }
    const urls = [...new Set(String(b.urls || "").split(/[\s,]+/).map((u) => u.trim()).filter(Boolean))].slice(0, 30);
    const bad = urls.filter((u) => { try { const x = new URL(u); return !/^https?:$/.test(x.protocol) || u.length > 300; } catch { return true; } });
    if (!urls.length) return err(400, "Paste at least one invite link");
    if (bad.length) return err(400, `Not a link: ${bad[0].slice(0, 60)}`);
    const local = urls.find((u) => /\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|localhost)/.test(u));
    if (local) return err(400, "That's a home-network address — friends can't open it. Use your public Wizarr address (https://unirse.moikas.cc/j/…).");
    const t = now();
    await env.DB.batch(urls.map((u) => env.DB.prepare("INSERT OR IGNORE INTO jellyfin_invites (url, multi, added_by, created_at) VALUES (?, ?, ?, ?)").bind(u, b.multi ? 1 : 0, me.id, t)));
    return json({ ok: true, added: urls.length });
  }

  const name = b.name ? String(b.name).trim().slice(0, 40) : null;
  if (name && !/^[\w .@-]+$/.test(name)) return err(400, "Just your Jellyfin user name");
  // a new name has to be approved again before it can be reset
  await env.DB.prepare("UPDATE users SET jellyfin_name = ?, jellyfin_verified = CASE WHEN lower(COALESCE(jellyfin_name, '')) = lower(COALESCE(?, '')) THEN jellyfin_verified ELSE 0 END WHERE id = ?").bind(name, name, me.id).run().catch(() =>
    env.DB.prepare("UPDATE users SET jellyfin_name = ? WHERE id = ?").bind(name, me.id).run());
  return json({ name });
}
