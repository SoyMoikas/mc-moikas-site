import { cookie, parseCookies, randomToken, sha256, now, timingSafeEqual, safeNext } from "../../lib/util.js";
import { SESSION_COOKIE, SESSION_DAYS } from "../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const [savedState, savedNext] = (parseCookies(request).oauth_state || "").split("|");

  if (url.searchParams.get("error")) return page("Login was cancelled.");
  if (!code || !state || !savedState || !timingSafeEqual(state, savedState)) {
    return page("Login expired or was tampered with. Please try again.");
  }

  // Exchange the code for an access token.
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}/auth/callback`,
    }),
  });
  if (!tokenRes.ok) return page("Discord rejected the login. Check the app's client secret and redirect URL.");
  const { access_token } = await tokenRes.json();

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) return page("Couldn't read your Discord profile.");
  const me = await meRes.json();

  const username = (me.global_name || me.username || "player").slice(0, 64);
  const avatar = me.avatar
    ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(me.id) >> 22n) % 6n)}.png`;
  const isOwner = env.ADMIN_DISCORD_ID && String(env.ADMIN_DISCORD_ID).trim() === me.id;
  const t = now();

  await env.DB.prepare(
    `INSERT INTO users (discord_id, username, avatar, role, created_at, last_login)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(discord_id) DO UPDATE SET username = ?2, avatar = ?3, last_login = ?5,
       role = CASE WHEN ?6 THEN 'admin' ELSE role END`
  ).bind(me.id, username, avatar, isOwner ? "admin" : "pending", t, isOwner ? 1 : 0).run();

  const user = await env.DB.prepare("SELECT id FROM users WHERE discord_id = ?").bind(me.id).first();

  const token = randomToken(32);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256(token), user.id, t + SESSION_DAYS * 86400_000),
  ]);

  const headers = new Headers({ location: safeNext(savedNext) });
  headers.append("set-cookie", cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400 }));
  headers.append("set-cookie", cookie("oauth_state", "", { maxAge: 0 }));
  return new Response(null, { status: 302, headers });
}

function page(msg) {
  const safe = msg.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return new Response(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>Login</title>
     <body style="font-family:system-ui;background:#14161a;color:#e8e6e1;padding:40px">
     <p>${safe}</p><p><a style="color:#6fcf5a" href="/">Back to the site</a></p></body>`,
    { status: 400, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
