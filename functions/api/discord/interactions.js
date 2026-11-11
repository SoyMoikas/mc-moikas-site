import { json } from "../../../lib/util.js";
import { loadPost, setMember, messageFor, pingIfFull, site as siteOf } from "../../../lib/lfg.js";

// Discord calls this when someone clicks "Me apunto" / "Ya no puedo" on a post in the channel.
// Set it as the app's "Interactions Endpoint URL": https://play.moikas.cc/api/discord/interactions

const hex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

async function verified(request, env, raw) {
  const sig = request.headers.get("x-signature-ed25519"), ts = request.headers.get("x-signature-timestamp");
  if (!sig || !ts || !env.DISCORD_PUBLIC_KEY) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hex(env.DISCORD_PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hex(sig), new TextEncoder().encode(ts + raw));
  } catch { return false; }
}

const ephemeral = (content) => json({ type: 4, data: { content, flags: 64 } });

export async function onRequestPost({ request, env, waitUntil }) {
  const raw = await request.text();
  if (!(await verified(request, env, raw))) return new Response("bad signature", { status: 401 });
  const i = JSON.parse(raw);
  if (i.type === 1) return json({ type: 1 }); // PING from Discord when you save the URL

  if (i.type === 3 && typeof i.data?.custom_id === "string" && i.data.custom_id.startsWith("lfg:")) {
    const [, action, id] = i.data.custom_id.split(":");
    const discordId = i.member?.user?.id || i.user?.id;
    const user = await env.DB.prepare("SELECT id, role FROM users WHERE discord_id = ?").bind(discordId).first();
    const site = siteOf(env);
    if (!user) return ephemeral(`Primero entra a ${site} con tu Discord (una vez) y luego ya puedes apuntarte desde aquí.`);
    if (user.role === "pending") return ephemeral("Tu cuenta todavía no está aprobada en la página. Pídele a un admin que te acepte.");
    const p = await loadPost(env, parseInt(id) || 0);
    if (!p) return ephemeral("Esa partida ya no existe.");
    const r = await setMember(env, p, user.id, action === "join");
    const msgs = { already: "Ya estás apuntado 👍", full: "Ya se llenó 😢", closed: "Esa partida ya se cerró.",
      not_member: "No estabas apuntado.", host: "Tú la armaste — ciérrala desde la página si ya no va." };
    if (msgs[r]) return ephemeral(msgs[r]);
    if (r === "left") await env.DB.prepare("UPDATE lfg_posts SET pinged = 0 WHERE id = ?").bind(p.id).run();
    const fresh = await loadPost(env, p.id);
    waitUntil(pingIfFull(env, fresh));
    return json({ type: 7, data: messageFor(env, fresh) }); // update the message in place
  }
  return ephemeral("?");
}
