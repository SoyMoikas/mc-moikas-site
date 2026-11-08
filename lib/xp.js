// XP = 1 per minute played (all servers) + XP from approved quests.
// Levels/ranks are computed in the browser from XP (public/js/levels.js).
import { now } from "./util.js";

// Recompute cached xp/play_minutes. Pass a userId for one user, or nothing for everyone.
export async function recomputeXP(env, userId = null) {
  const where = userId ? "WHERE id = ?" : "";
  const stmt = env.DB.prepare(
    `UPDATE users SET
       play_minutes = COALESCE((SELECT SUM(s.play_minutes) FROM mc_stats s WHERE s.uuid = users.mc_uuid), 0),
       xp = COALESCE((SELECT SUM(s.play_minutes) FROM mc_stats s WHERE s.uuid = users.mc_uuid), 0)
          + COALESCE((SELECT SUM(q.xp) FROM quest_completions c JOIN quests q ON q.id = c.quest_id
                       WHERE c.user_id = users.id AND c.status = 'approved'), 0)
     ${where}`
  );
  await (userId ? stmt.bind(userId) : stmt).run();
}

// Value of a stat or advancement for one player, summed over servers (or one server).
export function questProgress(quest, statRows) {
  const rows = quest.ptero_uuid ? statRows.filter((r) => r.ptero_uuid === quest.ptero_uuid) : statRows;
  if (quest.criteria_type === "advancement") {
    const done = rows.some((r) => (safe(r.advancements) || []).includes(quest.criteria_key));
    return { value: done ? 1 : 0, target: 1, done };
  }
  if (quest.criteria_type === "stat") {
    const value = rows.reduce((sum, r) => sum + (Number((safe(r.stats) || {})[quest.criteria_key]) || 0), 0);
    const target = quest.criteria_target || 1;
    return { value, target, done: value >= target };
  }
  return null;
}

const AUTO_QUESTS_SQL = `
  SELECT q.*, s.ptero_uuid FROM quests q LEFT JOIN servers s ON s.id = q.server_id
   WHERE q.active = 1 AND q.kind = 'auto' AND q.criteria_type IS NOT NULL AND q.criteria_key IS NOT NULL`;

export async function loadAutoQuests(env) {
  return (await env.DB.prepare(AUTO_QUESTS_SQL).all()).results;
}

// Award every auto quest that linked players have met. Returns number of new completions.
export async function evaluateAutoQuests(env) {
  const quests = await loadAutoQuests(env);
  if (!quests.length) return 0;
  const { results: users } = await env.DB.prepare("SELECT id, mc_uuid FROM users WHERE mc_uuid IS NOT NULL").all();
  if (!users.length) return 0;
  const { results: stats } = await env.DB.prepare(
    `SELECT uuid, ptero_uuid, stats, advancements FROM mc_stats WHERE uuid IN (${users.map(() => "?").join(",")})`
  ).bind(...users.map((u) => u.mc_uuid)).all();
  const byUuid = {};
  for (const r of stats) (byUuid[r.uuid] ||= []).push(r);

  const t = now();
  const inserts = [];
  for (const u of users) {
    const rows = byUuid[u.mc_uuid] || [];
    for (const q of quests) {
      if (questProgress(q, rows)?.done) {
        inserts.push(env.DB.prepare(
          `INSERT OR IGNORE INTO quest_completions (quest_id, user_id, status, created_at, reviewed_at)
           VALUES (?, ?, 'approved', ?, ?)`
        ).bind(q.id, u.id, t, t));
      }
    }
  }
  let added = 0;
  for (let i = 0; i < inserts.length; i += 50) {
    const res = await env.DB.batch(inserts.slice(i, i + 50));
    added += res.reduce((n, r) => n + (r.meta.changes || 0), 0);
  }
  return added;
}

function safe(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
