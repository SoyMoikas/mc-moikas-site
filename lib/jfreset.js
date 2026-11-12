// "Olvidé mi contraseña de Jellyfin": you ask on the site (you're already logged in with Discord), the NAS bot sets a
// temporary password on your Jellyfin account and the site DMs it to you. The first time a Jellyfin name is linked to
// a site account, staff approve it (anyone can type any name, so this stops people grabbing someone else's account).
// Jellyfin administrators are never reset this way (the bot refuses).
import { now } from "./util.js";
import { notify } from "./notify.js";
import { discord, site } from "./lfg.js";

const WORDS = ["taco", "luna", "nopal", "cohete", "pixel", "mango", "dragon", "tormenta", "volcan", "jaguar", "cometa", "salsa", "neon", "zorro", "faro", "trueno"];
export function tempPassword() {
  const a = new Uint32Array(3); crypto.getRandomValues(a);
  return `${WORDS[a[0] % WORDS.length]}-${WORDS[a[1] % WORDS.length]}-${1000 + (a[2] % 9000)}`;
}
const staffIds = async (env) => (await env.DB.prepare("SELECT id FROM users WHERE role IN ('staff','subadmin','admin')").all()).results.map((u) => u.id);

/** A member asks for a reset. → { status: "queued" | "approval" } or { error } */
export async function requestReset(env, me) {
  const u = await env.DB.prepare("SELECT jellyfin_name, jellyfin_verified FROM users WHERE id = ?").bind(me.id).first();
  if (!u?.jellyfin_name) return { error: "Primero escribe tu usuario de Jellyfin" };
  const t = now();
  const open = await env.DB.prepare("SELECT status FROM jf_resets WHERE user_id = ? AND status IN ('approval','queued','sent','ready') LIMIT 1").bind(me.id).first();
  if (open) return { status: open.status };
  const recent = await env.DB.prepare("SELECT 1 FROM jf_resets WHERE user_id = ? AND status = 'done' AND updated_at > ?").bind(me.id, t - 15 * 60000).first();
  if (recent) return { error: "Acabamos de mandarte una — revisa tus DMs (o espera 15 min)" };
  const taken = await env.DB.prepare("SELECT 1 FROM users WHERE id != ? AND jellyfin_verified = 1 AND lower(jellyfin_name) = lower(?)").bind(me.id, u.jellyfin_name).first();
  if (taken) return { error: "Ese usuario de Jellyfin ya es de otra persona — pídele ayuda al staff" };
  const status = u.jellyfin_verified ? "queued" : "approval";
  await env.DB.prepare("INSERT INTO jf_resets (user_id, jf_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(me.id, u.jellyfin_name, status, t, t).run();
  if (status === "approval") await notify(env, await staffIds(env), "status", { title: `🔑 ${me.username} olvidó su contraseña de Jellyfin`,
    body: `Dice que su usuario es "${u.jellyfin_name}". Apruébalo en Juntos → Cine (solo la primera vez).`, url: "/juntos#cine" });
  return { status };
}

/** Staff approve (also marks the name as verified) or reject. */
export async function decideReset(env, staff, id, approve) {
  const r = await env.DB.prepare("SELECT * FROM jf_resets WHERE id = ? AND status = 'approval'").bind(id).first();
  if (!r) return false;
  const t = now();
  await env.DB.prepare("UPDATE jf_resets SET status = ?, decided_by = ?, updated_at = ? WHERE id = ?").bind(approve ? "queued" : "rejected", staff.id, t, id).run();
  if (approve) await env.DB.prepare("UPDATE users SET jellyfin_verified = 1 WHERE id = ? AND lower(jellyfin_name) = lower(?)").bind(r.user_id, r.jf_name).run();
  else await notify(env, [r.user_id], "status", { title: "🔑 No pudimos restablecer tu contraseña de Jellyfin", body: "El staff no lo aprobó — escríbeles para revisarlo.", url: "/juntos#cine" });
  return true;
}

/** For the bot: resets to do now (re-sent if the bot never answered within 10 min). */
export async function resetQueue(env) {
  const t = now();
  const { results } = await env.DB.prepare("SELECT id, jf_name, temp FROM jf_resets WHERE status = 'queued' OR (status = 'sent' AND updated_at < ?) ORDER BY id LIMIT 5").bind(t - 10 * 60000).all();
  const out = [];
  for (const r of results) {
    const temp = r.temp || tempPassword();
    await env.DB.prepare("UPDATE jf_resets SET status = 'sent', temp = ?, updated_at = ? WHERE id = ?").bind(temp, t, r.id).run();
    out.push({ id: r.id, name: r.jf_name, temp });
  }
  return out;
}

/** The bot's answers: DM the temporary password (or keep it for a one-time view on the site if DMs are closed). */
export async function resetResults(env, list) {
  const t = now();
  for (const x of (Array.isArray(list) ? list : []).slice(0, 10)) {
    const r = await env.DB.prepare("SELECT r.*, u.discord_id FROM jf_resets r JOIN users u ON u.id = r.user_id WHERE r.id = ? AND r.status = 'sent'").bind(+x.id || 0).first();
    if (!r) continue;
    if (!x.ok) {
      await env.DB.prepare("UPDATE jf_resets SET status = 'failed', temp = NULL, detail = ?, updated_at = ? WHERE id = ?").bind(String(x.detail || "error").slice(0, 200), t, r.id).run();
      await notify(env, [r.user_id], "status", { title: "🔑 No se pudo restablecer tu contraseña de Jellyfin", body: String(x.detail || "Pídele ayuda al staff.").slice(0, 200), url: "/juntos#cine" });
      continue;
    }
    let sent = false;
    if (env.DISCORD_BOT_TOKEN && r.discord_id) {
      const ch = await discord(env, "POST", "/users/@me/channels", { recipient_id: r.discord_id }).catch(() => null);
      if (ch?.id) {
        const msg = await discord(env, "POST", `/channels/${ch.id}/messages`, { embeds: [{ title: "🔑 Tu contraseña temporal de Jellyfin", color: 0xf2b33d,
          description: `**Usuario:** ${r.jf_name}\n**Contraseña:** \`${r.temp}\`\n\nEntra a ${env.JELLYFIN_PUBLIC_URL || "Jellyfin"} y cámbiala en ⚙️ Ajustes → Perfil → Contraseña.\nSi tú no la pediste, avísale al staff.`,
          footer: { text: "play.moikas.cc" } }], allowed_mentions: { parse: [] } }).catch(() => null);
        sent = !!msg?.id;
      }
    }
    await env.DB.prepare("UPDATE jf_resets SET status = ?, temp = ?, updated_at = ? WHERE id = ?").bind(sent ? "done" : "ready", sent ? null : r.temp, t, r.id).run();
    await notify(env, [r.user_id], "status", { title: "🔑 Contraseña de Jellyfin restablecida", body: sent ? "Te la mandamos por DM en Discord." : "Tus DMs están cerrados — mírala una sola vez en Juntos → Cine.", url: sent ? null : "/juntos#cine" });
  }
}

/** Your reset status for the Cine panel; a "ready" password (DMs closed) is shown once and then erased. */
export async function myReset(env, uid) {
  const r = await env.DB.prepare("SELECT id, status, temp, detail, updated_at FROM jf_resets WHERE user_id = ? ORDER BY id DESC LIMIT 1").bind(uid).first();
  if (!r) return null;
  if (r.status === "ready") { await env.DB.prepare("UPDATE jf_resets SET status = 'done', temp = NULL WHERE id = ?").bind(r.id).run(); return { status: "ready", temp: r.temp }; }
  if (["done", "failed", "rejected"].includes(r.status) && now() - r.updated_at > 3 * 86400000) return null;
  return { status: r.status, detail: r.detail || null };
}
export const pendingApprovals = async (env) => (await env.DB.prepare(
  "SELECT r.id, r.jf_name, r.created_at, u.username FROM jf_resets r JOIN users u ON u.id = r.user_id WHERE r.status = 'approval' ORDER BY r.id").all()).results;
void site;
