import { getUser } from "../../lib/auth.js";
import { json, err } from "../../lib/util.js";
import { laWeekStart } from "../../lib/coins.js";

// GET /api/rivals?a=<user id>&b=<user id> → head-to-head numbers for two people
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return err(401, "Log in first");
  const q = new URL(request.url).searchParams;
  const ids = [parseInt(q.get("a")) || me.id, parseInt(q.get("b")) || 0];
  if (!ids[1] || ids[0] === ids[1]) return err(400, "Pick someone to compare with");
  const DB = env.DB, ws = laWeekStart();
  const one = async (sql, ...b) => { try { return (await DB.prepare(sql).bind(...b).first()) || {}; } catch { return {}; } };
  const side = async (id) => {
    const u = await one("SELECT id, username, avatar, xp, play_minutes, mc_uuid FROM users WHERE id = ?", id);
    if (!u.id) return null;
    const ap = await one("SELECT data, week_score FROM apex_links WHERE user_id = ?", id);
    const apex = ap.data ? JSON.parse(ap.data) : null;
    return {
      id: u.id, username: u.username, avatar: u.avatar,
      stats: {
        xp: u.xp || 0,
        hours: Math.round((u.play_minutes || 0) / 6) / 10,
        hours_week: Math.round(((u.play_minutes || 0) - ((await one("SELECT play_minutes FROM week_baseline WHERE week_start = ? AND user_id = ?", ws, id)).play_minutes ?? u.play_minutes)) / 6) / 10,
        apex_rp: apex?.rank?.score ?? null, apex_rank: apex?.rank?.name ? `${apex.rank.name} ${apex.rank.div || ""}`.trim() : null,
        apex_week: apex?.rank?.score != null && ap.week_score != null ? apex.rank.score - ap.week_score : null,
        deaths: u.mc_uuid ? (await one("SELECT COUNT(*) AS n FROM mc_deaths WHERE mc_uuid = ?", u.mc_uuid)).n || 0 : null,
        trophies: (await one("SELECT COUNT(*) AS n FROM tournament_prizes WHERE user_id = ? AND place = 1", id)).n || 0,
        nights: (await one("SELECT COUNT(*) AS n FROM game_night_rsvp WHERE user_id = ? AND attended = 1", id)).n || 0,
        quests: (await one("SELECT COUNT(*) AS n FROM quest_completions WHERE user_id = ? AND status = 'approved'", id)).n || 0,
        streak: (await one("SELECT MAX(streak) AS n FROM daily_claims WHERE user_id = ?", id)).n || 0,
        guesses: (await one("SELECT COUNT(*) AS n FROM guess_plays WHERE user_id = ? AND solved = 1", id)).n || 0,
        bets_won: (await one("SELECT COUNT(*) AS n FROM coin_awards WHERE user_id = ? AND source = 'bet_win'", id)).n || 0,
        achievements: (await one("SELECT COUNT(*) AS n FROM achievements WHERE user_id = ?", id)).n || 0,
      },
    };
  };
  const [a, b] = await Promise.all(ids.map(side));
  if (!a || !b) return err(404, "User not found");
  return json({ a, b });
}
