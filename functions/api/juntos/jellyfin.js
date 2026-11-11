import { need } from "../../../lib/auth.js";
import { json, body, err } from "../../../lib/util.js";

// GET → your Jellyfin user name + the server link; POST {name} → so the site knows what you're watching (and gives movie-night coins)
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const r = await env.DB.prepare("SELECT jellyfin_name FROM users WHERE id = ?").bind(me.id).first();
  return json({ name: r?.jellyfin_name || null, url: env.JELLYFIN_PUBLIC_URL || null });
}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const name = b.name ? String(b.name).trim().slice(0, 40) : null;
  if (name && !/^[\w .@-]+$/.test(name)) return err(400, "Just your Jellyfin user name");
  await env.DB.prepare("UPDATE users SET jellyfin_name = ? WHERE id = ?").bind(name, me.id).run();
  return json({ name });
}
