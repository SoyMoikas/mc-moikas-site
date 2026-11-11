import { getUser } from "../../lib/auth.js";
import { json, err, now } from "../../lib/util.js";
import { mergeServer, SERVER_SELECT, splitRow } from "../../lib/servers.js";

// GET /api/status → NAS services (from the bot's checks), uptime (24 h / 7 d / 30 d), game servers and the NAS load. Members only.
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return err(401, "Log in first");
  const t = now(), hour = Math.floor(t / 3600000);
  let checks = [], hours = [], host = null, bot = null;
  try {
    checks = (await env.DB.prepare("SELECT name, ok, ms, detail, checked_at, changed_at FROM status_checks ORDER BY name").all()).results;
    hours = (await env.DB.prepare("SELECT name, hour, ok, total FROM status_hours WHERE hour > ?").bind(hour - 24 * 30).all()).results;
    host = await env.DB.prepare("SELECT value, updated_at FROM kv_cache WHERE key = 'nas_host'").first();
  } catch { /* before migration 034 */ }
  try { bot = (await env.DB.prepare("SELECT MAX(updated_at) AS t FROM presence").first())?.t || null; } catch { /* */ }
  const uptime = (name, h) => {
    const rows = hours.filter((r) => r.name === name && r.hour > hour - h);
    const total = rows.reduce((s, r) => s + r.total, 0);
    return total ? Math.round((rows.reduce((s, r) => s + r.ok, 0) / total) * 1000) / 10 : null;
  };
  const bars = (name) => Array.from({ length: 48 }, (_, i) => { const r = hours.find((x) => x.name === name && x.hour === hour - 47 + i); return r ? Math.round((r.ok / r.total) * 100) : null; });
  const servers = (await env.DB.prepare(`${SERVER_SELECT} WHERE s.hidden = 0`).all()).results.map((r) => mergeServer(...splitRow(r), env))
    .map((s) => ({ id: s.id, name: s.name, game: s.game, status: s.status, players: s.players_online, max: s.players_max }));
  const hostInfo = host ? { ...JSON.parse(host.value), at: host.updated_at } : null;
  const lastReport = checks.reduce((m, c) => Math.max(m, c.checked_at), 0) || hostInfo?.at || null;
  return json({
    now: t, last_report: lastReport, bot_seen: bot, stale: !lastReport || t - lastReport > 5 * 60000,
    checks: checks.map((c) => ({ ...c, ok: !!c.ok, up24: uptime(c.name, 24), up7: uptime(c.name, 24 * 7), up30: uptime(c.name, 24 * 30), bars: bars(c.name) })),
    servers, host: hostInfo,
  });
}
