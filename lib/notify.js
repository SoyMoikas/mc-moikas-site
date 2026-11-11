// Notifications: a row per person (the bell on the site) + an optional Discord DM from the bot.
import { now } from "./util.js";
import { discord, site } from "./lfg.js";
import { sendPush } from "./push.js";

// kind → default settings. "site" = shows in the bell; "dm" = the bot DMs you on Discord.
export const KINDS = {
  reply:    { site: true, dm: true,  push: true  },  // someone commented on your post / a post you commented on
  announce: { site: true, dm: false, push: true  },  // new announcement
  game:     { site: true, dm: false, push: true  },  // "¿Quién se apunta?" post, game night vote, tournament, Jellyfin arrivals
  night:    { site: true, dm: true,  push: true  },  // a game night you voted on got decided
  free:     { site: true, dm: false, push: false },  // new free game
  quest:    { site: true, dm: true,  push: true  },  // quest completed / approved / rejected
  achieve:  { site: true, dm: false, push: false },  // you unlocked an achievement
  fun:      { site: true, dm: false, push: false },  // bets settled, bounties, birthdays, Steam sales, weekly recap
  status:   { site: true, dm: true,  push: true  },  // (staff) a NAS service went down / came back
};

export async function prefsFor(env, userIds) {
  if (!userIds.length) return new Map();
  const rows = (await env.DB.prepare(`SELECT user_id, data FROM notif_prefs WHERE user_id IN (${userIds.map(() => "?").join(",")})`)
    .bind(...userIds).all()).results;
  const m = new Map(rows.map((r) => [r.user_id, safe(r.data)]));
  return new Map(userIds.map((id) => [id, merge(m.get(id))]));
}
export const merge = (p) => Object.fromEntries(Object.entries(KINDS).map(([k, d]) => [k, { ...d, ...((p || {})[k] || {}) }]));
const safe = (s) => { try { return JSON.parse(s); } catch { return {}; } };

// Everyone approved on the site (for announcements, new games, free games).
export async function allMembers(env, exceptId = null) {
  return (await env.DB.prepare("SELECT id FROM users WHERE role != 'pending' AND id != ?").bind(exceptId ?? -1).all()).results.map((r) => r.id);
}

/** notify(env, [userIds], "reply", { title, body, url }) — never throws. */
export async function notify(env, userIds, kind, { title, body = null, url = null }) {
  try {
    const ids = [...new Set(userIds)].filter(Boolean).slice(0, 500);
    if (!ids.length) return;
    const prefs = await prefsFor(env, ids);
    const t = now();
    const siteIds = ids.filter((id) => prefs.get(id)[kind]?.site);
    for (let i = 0; i < siteIds.length; i += 90) {
      await env.DB.batch(siteIds.slice(i, i + 90).map((id) => env.DB.prepare(
        "INSERT INTO notifications (user_id, kind, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(id, kind, title.slice(0, 160), body ? String(body).slice(0, 300) : null, url, t)));
    }
    if (Math.random() < 0.05) await env.DB.prepare("DELETE FROM notifications WHERE created_at < ?").bind(t - 60 * 86400000).run();
    // phone push (only for things that are also in the bell — the phone shows the newest bell item)
    await sendPush(env, siteIds.filter((id) => prefs.get(id)[kind]?.push));

    const dmIds = ids.filter((id) => prefs.get(id)[kind]?.dm);
    if (!env.DISCORD_BOT_TOKEN || !dmIds.length) return;
    const users = (await env.DB.prepare(`SELECT id, discord_id FROM users WHERE id IN (${dmIds.map(() => "?").join(",")}) AND discord_id IS NOT NULL`)
      .bind(...dmIds).all()).results;
    const link = url ? (url.startsWith("http") ? url : site(env) + url) : site(env);
    for (const u of users.slice(0, 40)) {
      const ch = await discord(env, "POST", "/users/@me/channels", { recipient_id: u.discord_id });
      if (!ch?.id) continue; // DMs closed, or not in a server with the bot
      await discord(env, "POST", `/channels/${ch.id}/messages`, {
        embeds: [{ title: title.slice(0, 250), description: body ? dmTime(String(body)).slice(0, 500) : undefined, url: link, color: 0xf2b33d,
          footer: { text: "play.moikas.cc · cambia esto en 🔔 → Ajustes" } }],
        allowed_mentions: { parse: [] },
      });
    }
  } catch (e) { console.error("notify", kind, e.message); }
}

// "{t:1794380000000}" in a notification = a moment in time. Discord and the bell each show it in the reader's own time zone.
const dmTime = (s) => s.replace(/\{t:(\d{10,14})\}/g, (_, ms) => `<t:${Math.floor(+ms / 1000)}:F>`);
