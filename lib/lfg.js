// "¿Quién se apunta?" — looking-for-group posts, mirrored to a Discord channel with join/leave buttons.
import { now } from "./util.js";

export const OPEN_HOURS = 3; // a post stays open until 3 h after its start time

export async function loadPost(env, id) {
  const p = await env.DB.prepare(
    `SELECT p.*, u.username AS host_name, u.avatar AS host_avatar, u.discord_id AS host_discord
       FROM lfg_posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`).bind(id).first();
  if (!p) return null;
  p.members = (await env.DB.prepare(
    `SELECT u.id, u.username, u.avatar, u.discord_id FROM lfg_members m JOIN users u ON u.id = m.user_id
      WHERE m.post_id = ? ORDER BY m.joined_at`).bind(id).all()).results;
  p.open = !p.closed_at && p.starts_at > now() - OPEN_HOURS * 3600000;
  p.full = p.members.length >= p.slots;
  return p;
}

export function publicPost(p, me) {
  return {
    id: p.id, game: p.game, note: p.note, starts_at: p.starts_at, slots: p.slots, created_at: p.created_at,
    open: p.open, full: p.full, host: { id: p.user_id, username: p.host_name, avatar: p.host_avatar },
    members: p.members.map((m) => ({ id: m.id, username: m.username, avatar: m.avatar })),
    joined: !!me && p.members.some((m) => m.id === me.id), mine: !!me && p.user_id === me.id,
  };
}

// Returns "joined" | "left" | "already" | "full" | "closed" | "not_member"
export async function setMember(env, p, userId, join) {
  if (!p.open) return "closed";
  const inIt = p.members.some((m) => m.id === userId);
  if (join) {
    if (inIt) return "already";
    if (p.full) return "full";
    await env.DB.prepare("INSERT OR IGNORE INTO lfg_members (post_id, user_id, joined_at) VALUES (?, ?, ?)").bind(p.id, userId, now()).run();
    return "joined";
  }
  if (!inIt) return "not_member";
  if (userId === p.user_id) return "host"; // the host closes the post instead of leaving
  await env.DB.prepare("DELETE FROM lfg_members WHERE post_id = ? AND user_id = ?").bind(p.id, userId).run();
  return "left";
}

/* ---------------- Discord ---------------- */

const discordOn = (env) => !!(env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL);

export async function discord(env, method, path, payload) {
  const r = await fetch(`https://discord.com/api/v10${path}`, {
    method, headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!r.ok) { console.error("discord", method, path, r.status, await r.text()); return null; }
  return r.status === 204 ? {} : r.json();
}

const site = (env) => `https://${env.PUBLIC_HOST || "play.moikas.cc"}`;

// The Discord message for a post: embed + buttons.
export function messageFor(env, p) {
  const ts = Math.floor(p.starts_at / 1000);
  const soon = p.starts_at <= p.created_at + 5 * 60000;
  const left = p.slots - p.members.length;
  const status = !p.open ? "🔒 Cerrada" : p.full ? "✅ ¡Completos! A jugar" : `Faltan **${left}**`;
  return {
    embeds: [{
      title: `🎮 ${p.game}`,
      description: [p.note ? p.note : null, soon ? "**¡Ahorita!**" : `<t:${ts}:F> (<t:${ts}:R>)`].filter(Boolean).join("\n"),
      color: !p.open ? 0x555555 : p.full ? 0x6fcf5a : 0xf2b33d,
      fields: [
        { name: `Se apuntaron (${p.members.length}/${p.slots})`, value: p.members.map((m) => `<@${m.discord_id}>`).join(" ") || "—" },
        { name: "Estado", value: status, inline: true },
      ],
      footer: { text: `Armada por ${p.host_name} · play.moikas.cc` },
    }],
    components: p.open ? [{
      type: 1, components: [
        { type: 2, style: 3, label: "Me apunto", emoji: { name: "🙋" }, custom_id: `lfg:join:${p.id}`, disabled: p.full },
        { type: 2, style: 2, label: "Ya no puedo", custom_id: `lfg:leave:${p.id}` },
        { type: 2, style: 5, label: "Ver en la página", url: `${site(env)}/#lfg` },
      ],
    }] : [],
    allowed_mentions: { parse: [] }, // the list of names never pings; only the "full" message does
  };
}

// Create or update the post's Discord message; ping everyone once when it fills up.
export async function syncDiscord(env, p, { created = false } = {}) {
  if (!discordOn(env)) return;
  const ch = env.DISCORD_LFG_CHANNEL;
  if (created || !p.discord_msg_id) {
    const msg = await discord(env, "POST", `/channels/${ch}/messages`, {
      ...messageFor(env, p),
      content: `**${p.host_name}** busca gente para **${p.game}** 🎮`,
    });
    if (msg?.id) {
      p.discord_msg_id = msg.id;
      await env.DB.prepare("UPDATE lfg_posts SET discord_msg_id = ? WHERE id = ?").bind(msg.id, p.id).run();
    }
  } else {
    await discord(env, "PATCH", `/channels/${ch}/messages/${p.discord_msg_id}`, messageFor(env, p));
  }
  await pingIfFull(env, p);
}

export async function pingIfFull(env, p) {
  if (!discordOn(env) || !p.full || p.pinged || !p.open) return;
  await env.DB.prepare("UPDATE lfg_posts SET pinged = 1 WHERE id = ?").bind(p.id).run();
  p.pinged = 1;
  await discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, {
    content: `✅ ¡Ya están completos para **${p.game}**! ${p.members.map((m) => `<@${m.discord_id}>`).join(" ")} — a jugar 🎮`,
    allowed_mentions: { users: p.members.map((m) => m.discord_id) },
    message_reference: p.discord_msg_id ? { message_id: p.discord_msg_id, fail_if_not_exists: false } : undefined,
  });
}
