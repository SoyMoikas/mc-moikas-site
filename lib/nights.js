import { notify } from "./notify.js";
// Game nights: vote on the game and the time, RSVP, reminder, coins for showing up.
import { now } from "./util.js";
import { discord, site } from "./lfg.js";

export const NIGHT_COINS = 25;       // for showing up (seen playing the game on Discord during the night)
const WINDOW_BEFORE = 15 * 60000;    // attendance counts from 15 min before…
const WINDOW_AFTER = 3 * 3600000;    // …until 3 h after the start

export async function loadNight(env, id, me) {
  const n = await env.DB.prepare(
    `SELECT n.*, u.username AS host_name FROM game_nights n JOIN users u ON u.id = n.user_id WHERE n.id = ?`).bind(id).first();
  if (!n) return null;
  const [opts, votes, rsvp] = await Promise.all([
    env.DB.prepare("SELECT * FROM game_night_options WHERE night_id = ? ORDER BY kind, COALESCE(value, 0), id").bind(id).all(),
    env.DB.prepare(`SELECT v.option_id, u.id, u.username, u.avatar FROM game_night_votes v JOIN users u ON u.id = v.user_id WHERE v.night_id = ?`).bind(id).all(),
    env.DB.prepare(`SELECT r.status, r.attended, r.coins, u.id, u.username, u.avatar, u.discord_id FROM game_night_rsvp r JOIN users u ON u.id = r.user_id WHERE r.night_id = ?`).bind(id).all(),
  ]);
  n.options = opts.results.map((o) => {
    const vs = votes.results.filter((v) => v.option_id === o.id);
    return { ...o, votes: vs.map(({ id, username, avatar }) => ({ id, username, avatar })), mine: !!me && vs.some((v) => v.id === me.id) };
  });
  n.rsvp = rsvp.results;
  return n;
}

export function publicNight(n, me) {
  const { discord_msg_id, ...rest } = n;
  return { ...rest, rsvp: n.rsvp.map(({ discord_id, ...r }) => r), my_rsvp: me ? n.rsvp.find((r) => r.id === me.id)?.status || null : null, mine: !!me && n.user_id === me.id };
}

const top = (opts, kind) => {
  const list = opts.filter((o) => o.kind === kind);
  // most votes wins; ties go to the earlier time / first-added game
  return list.sort((a, b) => b.votes.length - a.votes.length || (a.value ?? 0) - (b.value ?? 0) || a.id - b.id)[0];
};

export async function lockNight(env, n, gameId, timeId) {
  const g = n.options.find((o) => o.id === gameId) || top(n.options, "game");
  const t = n.options.find((o) => o.id === timeId) || top(n.options, "time");
  if (!g || !t) return;
  await env.DB.prepare("UPDATE game_nights SET status = 'locked', game = ?, starts_at = ? WHERE id = ?").bind(g.label, t.value, n.id).run();
  // everyone who voted for the winning time is pencilled in as "yes"
  for (const v of t.votes) {
    await env.DB.prepare("INSERT OR IGNORE INTO game_night_rsvp (night_id, user_id, status) VALUES (?, ?, 'yes')").bind(n.id, v.id).run();
  }
  const fresh = await loadNight(env, n.id);
  await postLocked(env, fresh);
  const voters = [...new Set(n.options.flatMap((o) => o.votes.map((v) => v.id)))];
  await notify(env, voters, "night", {
    title: `🎉 Ya quedó: ${g.label}`, body: `${n.title} · ${new Date(t.value).toLocaleString("es-MX", { timeZone: "America/Los_Angeles", weekday: "long", hour: "numeric", minute: "2-digit" })}. ¿Vas?`,
    url: `/play?night=${n.id}#noches` });
}

/* ---------------- Discord ---------------- */

const ch = (env) => env.DISCORD_LFG_CHANNEL;
const on = (env) => !!(env.DISCORD_BOT_TOKEN && ch(env));

export async function postVoting(env, n) {
  if (!on(env)) return;
  const games = n.options.filter((o) => o.kind === "game").map((o) => `• ${o.label}`).join("\n");
  const times = n.options.filter((o) => o.kind === "time").map((o) => `• <t:${Math.floor(o.value / 1000)}:F>`).join("\n");
  const msg = await discord(env, "POST", `/channels/${ch(env)}/messages`, {
    content: `🗳️ **${n.host_name}** armó una noche de juego: **${n.title}** — ¡voten!`,
    embeds: [{ title: `🗳️ ${n.title}`, description: [n.note, `Votación cierra <t:${Math.floor(n.vote_until / 1000)}:R>`].filter(Boolean).join("\n"),
      color: 0x8a6cff, fields: [{ name: "¿Qué jugamos?", value: games || "—", inline: true }, { name: "¿Cuándo?", value: times || "—", inline: true }] }],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: "Votar en la página", url: `${site(env)}/play?night=${n.id}` }] }],
    allowed_mentions: { parse: [] },
  });
  if (msg?.id) await env.DB.prepare("UPDATE game_nights SET discord_msg_id = ? WHERE id = ?").bind(msg.id, n.id).run();
}

export function lockedMessage(env, n) {
  const ts = Math.floor(n.starts_at / 1000);
  const yes = n.rsvp.filter((r) => r.status === "yes");
  return {
    embeds: [{
      title: `🎉 ${n.title}: ${n.game}`, color: 0x6fcf5a,
      description: `<t:${ts}:F> (<t:${ts}:R>)${n.note ? `\n${n.note}` : ""}\n\nLos que se conecten a jugar **${n.game}** se llevan 🪙 ${NIGHT_COINS}.`,
      fields: [{ name: `Van (${yes.length})`, value: yes.map((r) => `<@${r.discord_id}>`).join(" ") || "—" }],
    }],
    components: n.status === "locked" ? [{ type: 1, components: [
      { type: 2, style: 3, label: "Voy", emoji: { name: "✅" }, custom_id: `gn:yes:${n.id}` },
      { type: 2, style: 2, label: "No puedo", custom_id: `gn:no:${n.id}` },
      { type: 2, style: 5, label: "Ver en la página", url: `${site(env)}/play?night=${n.id}` },
    ] }] : [],
    allowed_mentions: { parse: [] },
  };
}

async function postLocked(env, n) {
  if (!on(env)) return;
  const msg = await discord(env, "POST", `/channels/${ch(env)}/messages`, { content: `✅ Ya quedó: **${n.game}**`, ...lockedMessage(env, n) });
  if (msg?.id) await env.DB.prepare("UPDATE game_nights SET discord_msg_id = ? WHERE id = ?").bind(msg.id, n.id).run();
}

export async function updateLockedMessage(env, n) {
  if (on(env) && n.discord_msg_id && n.status !== "voting") {
    await discord(env, "PATCH", `/channels/${ch(env)}/messages/${n.discord_msg_id}`, lockedMessage(env, n));
  }
}

/* ---------------- background work (called by the bot every ~30 s via /api/sync/tick) ---------------- */

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const sameGame = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };

export async function tickNights(env) {
  const t = now();
  // 1) voting time is over → lock in the winners
  for (const { id } of (await env.DB.prepare("SELECT id FROM game_nights WHERE status = 'voting' AND vote_until <= ?").bind(t).all()).results) {
    const n = await loadNight(env, id);
    if (n.options.some((o) => o.kind === "time" && o.value > t)) await lockNight(env, n);
    else await env.DB.prepare("UPDATE game_nights SET status = 'cancelled' WHERE id = ?").bind(id).run();
  }
  // 2) one-hour reminder
  for (const { id } of (await env.DB.prepare(
    "SELECT id FROM game_nights WHERE status = 'locked' AND reminded = 0 AND starts_at <= ? AND starts_at > ?").bind(t + 3600000, t).all()).results) {
    await env.DB.prepare("UPDATE game_nights SET reminded = 1 WHERE id = ?").bind(id).run();
    const n = await loadNight(env, id);
    const yes = n.rsvp.filter((r) => r.status === "yes" && r.discord_id);
    if (on(env) && yes.length) await discord(env, "POST", `/channels/${ch(env)}/messages`, {
      content: `⏰ **${n.game}** empieza <t:${Math.floor(n.starts_at / 1000)}:R> — ${yes.map((r) => `<@${r.discord_id}>`).join(" ")}`,
      allowed_mentions: { users: yes.map((r) => r.discord_id) },
      message_reference: n.discord_msg_id ? { message_id: n.discord_msg_id, fail_if_not_exists: false } : undefined,
    });
  }
  // 3) attendance: anyone seen playing the night's game in the window gets the coins (RSVP not required)
  const live = (await env.DB.prepare(
    "SELECT id, game, starts_at FROM game_nights WHERE status = 'locked' AND starts_at - ? <= ? AND starts_at + ? >= ?"
  ).bind(WINDOW_BEFORE, t, WINDOW_AFTER, t).all()).results;
  const paid = [];
  if (live.length) {
    const playing = (await env.DB.prepare("SELECT user_id, game FROM presence WHERE updated_at > ?").bind(t - 5 * 60000).all()).results;
    for (const n of live) {
      for (const p of playing.filter((p) => sameGame(p.game, n.game))) {
        const r = await env.DB.prepare(
          `INSERT INTO game_night_rsvp (night_id, user_id, status, attended, coins) VALUES (?, ?, 'yes', 1, ?)
           ON CONFLICT(night_id, user_id) DO UPDATE SET attended = 1, coins = excluded.coins WHERE game_night_rsvp.attended = 0`
        ).bind(n.id, p.user_id, NIGHT_COINS).run();
        if (r.meta.changes) paid.push(p.user_id);
      }
    }
  }
  // 4) finished nights
  await env.DB.prepare("UPDATE game_nights SET status = 'done' WHERE status = 'locked' AND starts_at + ? < ?").bind(WINDOW_AFTER, t).run();
  return paid;
}
