import { err, HttpError } from "../../lib/util.js";

// Runs before every /api/* handler.
export async function onRequest({ request, next }) {
  const url = new URL(request.url);

  // CSRF guard: browser writes must come from this site. /api/sync uses a bearer secret instead.
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && url.pathname !== "/api/sync") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== url.origin) return err(403, "Bad origin");
  }

  try {
    return await next();
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    console.error(e);
    return err(500, "Server error");
  }
}
