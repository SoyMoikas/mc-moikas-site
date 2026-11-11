import { syncAuthorized } from "../../../lib/sync-auth.js";
import { json, body, err, now } from "../../../lib/util.js";
import { notify } from "../../../lib/notify.js";

// The NAS bot reports service checks every minute: { checks: [{name, ok, ms, detail}], host: {load, cpus, mem_pct, disk_pct} }
// Two failed checks in a row → staff get a "🔴 X se cayó" notification; when it's back → "🟢 X volvió".
export async function onRequestPost({ env, request }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now(), hour = Math.floor(t / 3600000);
  const prev = new Map((await env.DB.prepare("SELECT * FROM status_checks").all()).results.map((r) => [r.name, r]));
  const checks = (Array.isArray(b.checks) ? b.checks : []).slice(0, 30).filter((c) => c && typeof c.name === "string" && c.name.trim());
  const stmts = [], down = [], up = [];
  for (const c of checks) {
    const name = c.name.trim().slice(0, 40), ok = c.ok ? 1 : 0, p = prev.get(name);
    const fails = ok ? 0 : (p?.fails || 0) + 1;
    let alerted = p?.alerted || 0;
    if (!ok && fails >= 2 && !alerted) { alerted = 1; down.push(name); }
    if (ok && alerted) { alerted = 0; up.push(name); }
    const changed = !p || p.ok !== ok ? t : p.changed_at;
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO status_checks (name, ok, ms, detail, fails, alerted, checked_at, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(name, ok, Number.isFinite(c.ms) ? Math.round(c.ms) : null, c.detail ? String(c.detail).slice(0, 160) : null, fails, alerted, t, changed));
    stmts.push(env.DB.prepare(`INSERT INTO status_hours (name, hour, ok, total) VALUES (?, ?, ?, 1)
      ON CONFLICT (name, hour) DO UPDATE SET ok = ok + excluded.ok, total = total + 1`).bind(name, hour, ok));
  }
  // services that disappeared from the bot's list
  const names = new Set(checks.map((c) => c.name.trim().slice(0, 40)));
  for (const n of prev.keys()) if (!names.has(n)) stmts.push(env.DB.prepare("DELETE FROM status_checks WHERE name = ?").bind(n));
  if (b.host && typeof b.host === "object") stmts.push(env.DB.prepare("INSERT OR REPLACE INTO kv_cache (key, value, updated_at) VALUES ('nas_host', ?, ?)").bind(JSON.stringify(b.host).slice(0, 500), t));
  if (stmts.length) await env.DB.batch(stmts);
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM status_hours WHERE hour < ?").bind(hour - 24 * 31).run();
  if (down.length || up.length) {
    const staff = (await env.DB.prepare("SELECT id FROM users WHERE role IN ('staff', 'subadmin', 'admin')").all()).results.map((u) => u.id);
    if (down.length) await notify(env, staff, "status", { title: `🔴 Se cayó: ${down.join(", ")}`, body: "El bot del NAS no lo puede alcanzar desde hace 2 minutos.", url: "/status" });
    if (up.length) await notify(env, staff, "status", { title: `🟢 Volvió: ${up.join(", ")}`, url: "/status" });
  }
  return json({ ok: true, down, up });
}
