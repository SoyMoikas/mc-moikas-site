import { cookie, randomToken, safeNext } from "../../lib/util.js";

// Redirects to Discord's OAuth consent screen.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const state = randomToken(16);
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: "code",
    scope: "identify",
    redirect_uri: `${url.origin}/auth/callback`,
    state,
    prompt: "none",
  });
  const headers = new Headers({ location: `https://discord.com/oauth2/authorize?${params}` });
  headers.append("set-cookie", cookie("oauth_state", `${state}|${next}`, { maxAge: 600 }));
  return new Response(null, { status: 302, headers });
}
