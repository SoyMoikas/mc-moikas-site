import { getUser, need } from "../../../lib/auth.js";
import { json, body, str, err, now } from "../../../lib/util.js";
import { aiAvailable } from "../../../lib/rpg.js";

// GET /api/rpg → campaigns (yours first). POST {action:"create", title, setting, rules, dm_mode, turn_hours, max_players, lang}
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return err(401, "Log in first");
  const rows = (await env.DB.prepare(`SELECT c.id, c.title, c.setting, c.rules, c.dm_mode, c.status, c.turn_hours, c.max_players, c.dm_id, c.updated_at,
      u.username AS dm_name, u.avatar AS dm_avatar,
      (SELECT COUNT(*) FROM rpg_characters x WHERE x.campaign_id = c.id) AS players,
      (SELECT MAX(num) FROM rpg_scenes s WHERE s.campaign_id = c.id) AS scenes,
      (SELECT s.deadline FROM rpg_scenes s WHERE s.campaign_id = c.id AND s.status = 'open') AS deadline,
      EXISTS (SELECT 1 FROM rpg_characters x WHERE x.campaign_id = c.id AND x.user_id = ?1) AS joined,
      EXISTS (SELECT 1 FROM rpg_actions a JOIN rpg_scenes s ON s.id = a.scene_id AND s.status = 'open' JOIN rpg_characters x ON x.id = a.character_id
              WHERE s.campaign_id = c.id AND x.user_id = ?1) AS acted
    FROM rpg_campaigns c JOIN users u ON u.id = c.dm_id
    ORDER BY c.status = 'ended', (c.dm_id = ?1 OR EXISTS (SELECT 1 FROM rpg_characters x WHERE x.campaign_id = c.id AND x.user_id = ?1)) DESC, c.updated_at DESC LIMIT 60`).bind(me.id).all()).results;
  return json({ campaigns: rows, ai: aiAvailable(env) });
}

export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  if (b.action !== "create") return err(400, "Unknown action");
  const title = str(b.title, 80, "title");
  if (!title) return err(400, "Give the campaign a name");
  const rules = b.rules === "advanced" ? "advanced" : "simple";
  const dmMode = ["human", "assist", "ai"].includes(b.dm_mode) ? b.dm_mode : "human";
  if (dmMode !== "human" && !aiAvailable(env)) return err(400, "The AI narrator isn't set up on the site (ANTHROPIC_API_KEY)");
  const open = (await env.DB.prepare("SELECT COUNT(*) AS n FROM rpg_campaigns WHERE dm_id = ? AND status != 'ended'").bind(me.id).first()).n;
  if (open >= 3) return err(400, "You already run 3 campaigns — end one first");
  const t = now();
  const r = await env.DB.prepare(`INSERT INTO rpg_campaigns (title, setting, rules, dm_id, dm_mode, status, turn_hours, max_players, lang, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'recruiting', ?, ?, ?, ?, ?)`).bind(title, str(b.setting, 1200, "setting") || null, rules, me.id, dmMode,
    Math.max(2, Math.min(168, +b.turn_hours || 24)), Math.max(1, Math.min(10, +b.max_players || 6)), b.lang === "en" ? "en" : "es", t, t).run();
  return json({ id: r.meta.last_row_id });
}
