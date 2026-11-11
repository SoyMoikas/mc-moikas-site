import { getUser } from "../../../lib/auth.js";
import { json } from "../../../lib/util.js";

// GET → "un día como hoy": things that happened on this date in past years, plus one week / one month ago.
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ groups: [] });
  const DAY = 86400000, t = Date.now();
  const windows = [];
  for (let y = 1; y <= 5; y++) { const d = new Date(t); d.setFullYear(d.getFullYear() - y); windows.push({ key: `y${y}`, n: y, from: d.getTime() - DAY / 2, to: d.getTime() + DAY / 2 }); }
  windows.push({ key: "m1", from: t - 30 * DAY - DAY / 2, to: t - 30 * DAY + DAY / 2 });
  windows.push({ key: "w1", from: t - 7 * DAY - DAY / 2, to: t - 7 * DAY + DAY / 2 });
  const DB = env.DB, groups = [];
  for (const w of windows) {
    const items = [];
    const q = async (sql) => { try { return (await DB.prepare(sql).bind(w.from, w.to).all()).results; } catch { return []; } };
    for (const p of await q(`SELECT p.id, p.body, p.image, u.username, p.created_at FROM social_posts p JOIN users u ON u.id = p.user_id
                              WHERE p.deleted = 0 AND p.created_at BETWEEN ? AND ? ORDER BY (p.image IS NOT NULL) DESC LIMIT 3`))
      items.push({ icon: "📝", text: `${p.username}: ${String(p.body || "").slice(0, 120) || "📷"}`, image: p.image, url: `/#post-${p.id}` });
    for (const x of await q(`SELECT t.id, t.title, tt.name FROM tournaments t LEFT JOIN tournament_teams tt ON tt.id = t.winner_team_id WHERE t.finished_at BETWEEN ? AND ?`))
      items.push({ icon: "🏆", text: `${x.name || "?"} ganó ${x.title}`, url: `/tournaments?id=${x.id}` });
    for (const x of await q(`SELECT id, title, game, kind FROM game_nights WHERE status = 'done' AND starts_at BETWEEN ? AND ?`))
      items.push({ icon: x.kind === "watch" ? "🎬" : "🎮", text: `${x.title}: ${x.game}` });
    for (const x of await q(`SELECT q.body, u.username FROM quotes q LEFT JOIN users u ON u.id = q.author_id WHERE q.said_at BETWEEN ? AND ? LIMIT 2`))
      items.push({ icon: "💬", text: `“${x.body.slice(0, 120)}” — ${x.username || "?"}` });
    const deaths = await q(`SELECT name, COUNT(*) AS n FROM mc_deaths WHERE created_at BETWEEN ? AND ? GROUP BY name ORDER BY n DESC LIMIT 1`);
    if (deaths[0]) items.push({ icon: "💀", text: `${deaths[0].name} murió ${deaths[0].n} ${deaths[0].n === 1 ? "vez" : "veces"} en Ocaso` });
    if (items.length) groups.push({ key: w.key, n: w.n || null, items: items.slice(0, 6) });
  }
  return json({ groups });
}
