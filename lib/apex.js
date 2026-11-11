// Apex Legends stats from apexlegendsapi.com (free key). Platforms: PC, PS4, X1, SWITCH.
import { now } from "./util.js";

export const PLATFORMS = ["PC", "PS4", "X1", "SWITCH"];

export async function fetchApex(env, name, platform) {
  if (!env.APEX_API_KEY) throw new Error("APEX_API_KEY is not set");
  const r = await fetch(`https://api.mozambiquehe.re/bridge?${new URLSearchParams({
    auth: env.APEX_API_KEY, player: name, platform, version: "5" })}`);
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch { throw new Error(`Apex API ${r.status}`); }
  if (d.Error || d.error) throw new Error(d.Error || d.error);
  if (!d.global) throw new Error("Player not found");
  return d;
}

// Keep just what the site shows.
export function slim(d) {
  const g = d.global || {}, rk = g.rank || {}, rt = d.realtime || {}, sel = d.legends?.selected || {};
  // total kills: the "total" block has a kills tracker when the player shows one on a banner
  const total = d.total || {};
  const kills = total.kills?.value ?? total.specialEvent_kills?.value ?? null;
  return {
    name: g.name, uid: g.uid, level: g.level, platform: g.platform,
    rank: { name: rk.rankName, div: rk.rankDiv, score: rk.rankScore, img: rk.rankImg, pred: rk.ladderPosPlatform > 0 ? rk.ladderPosPlatform : null },
    online: !!rt.isOnline, in_game: !!rt.isInGame, state: rt.currentStateAsText || null,
    legend: sel.LegendName || rt.selectedLegend || null, legend_img: sel.ImgAssets?.icon || null,
    trackers: (sel.data || []).filter((x) => x && x.name).slice(0, 3).map((x) => ({ name: x.name, value: x.value })),
    kills,
  };
}

// Week starts Monday 00:00 Los Angeles time (close enough with a fixed offset).
const weekStart = (t) => { const d = new Date(t - 8 * 3600000); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.getTime() + 8 * 3600000; };

export async function refreshApex(env, userId) {
  const l = await env.DB.prepare("SELECT * FROM apex_links WHERE user_id = ?").bind(userId).first();
  if (!l) return null;
  const t = now();
  try {
    const s = slim(await fetchApex(env, l.name, l.platform));
    const ws = weekStart(t);
    const newWeek = l.week_start !== ws;
    await env.DB.prepare(
      `UPDATE apex_links SET data = ?, error = NULL, updated_at = ?, week_start = ?,
              week_score = CASE WHEN ? THEN ? ELSE week_score END, week_kills = CASE WHEN ? THEN ? ELSE week_kills END WHERE user_id = ?`
    ).bind(JSON.stringify(s), t, ws, newWeek ? 1 : 0, s.rank.score ?? null, newWeek ? 1 : 0, s.kills ?? null, userId).run();
    return s;
  } catch (e) {
    await env.DB.prepare("UPDATE apex_links SET error = ?, updated_at = ? WHERE user_id = ?").bind(String(e.message).slice(0, 200), t, userId).run();
    throw e;
  }
}
