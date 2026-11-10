import { needPerm } from "../../lib/auth.js";
import { json, now } from "../../lib/util.js";

// GET /api/activity?days=7 — admin "Activity" tab (admins, or sub-admins with the "users" permission).
export async function onRequestGet({ env, request }) {
  const me = await needPerm(env, request, "users");
  if (me instanceof Response) return me;
  const days = Math.min(120, Math.max(1, parseInt(new URL(request.url).searchParams.get("days")) || 7));
  const since = now() - days * 86400000;
  const DB = env.DB;

  const [totals, hours, pages, people, refs, recent] = await Promise.all([
    DB.prepare(`SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors,
                       COUNT(DISTINCT user_id) AS members
                  FROM page_views WHERE created_at > ?`).bind(since).first(),
    // per UTC hour; the browser turns these into local days and hours
    DB.prepare(`SELECT created_at / 3600000 AS h, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors
                  FROM page_views WHERE created_at > ? GROUP BY h ORDER BY h`).bind(since).all(),
    DB.prepare(`SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors
                  FROM page_views WHERE created_at > ? GROUP BY path ORDER BY views DESC LIMIT 15`).bind(since).all(),
    DB.prepare(`SELECT u.id, u.username, u.avatar, u.mc_name, COUNT(*) AS views, MAX(v.created_at) AS last
                  FROM page_views v JOIN users u ON u.id = v.user_id
                 WHERE v.created_at > ? GROUP BY u.id ORDER BY last DESC LIMIT 50`).bind(since).all(),
    DB.prepare(`SELECT ref, COUNT(*) AS views FROM page_views
                 WHERE created_at > ? AND ref IS NOT NULL GROUP BY ref ORDER BY views DESC LIMIT 10`).bind(since).all(),
    DB.prepare(`SELECT v.path, v.country, v.device, v.created_at, v.visitor, u.username
                  FROM page_views v LEFT JOIN users u ON u.id = v.user_id
                 WHERE v.created_at > ? ORDER BY v.created_at DESC LIMIT 80`).bind(since).all(),
  ]);

  return json({
    days, totals,
    hours: hours.results, pages: pages.results, people: people.results,
    refs: refs.results, recent: recent.results,
  });
}
