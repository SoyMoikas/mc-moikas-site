import { json } from "../../lib/util.js";
import { freeGames } from "../../lib/freegames.js";

// GET /api/freegames → games free right now (and Epic's next one)
export async function onRequestGet({ env }) {
  const games = await freeGames(env).catch(() => []);
  return json({ games }, 200, { "cache-control": "public, max-age=600" });
}
