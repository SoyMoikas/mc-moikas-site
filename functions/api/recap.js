import { getUser } from "../../lib/auth.js";
import { json } from "../../lib/util.js";
import { latestRecap } from "../../lib/recap.js";
import { dayIn, zoneOf } from "../../lib/coins.js";

// GET /api/recap → the latest weekly recap + whose birthday it is today
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ recap: null, birthdays: [] });
  const md = dayIn(zoneOf(me)).slice(5);
  const birthdays = (await env.DB.prepare("SELECT id, username, avatar FROM users WHERE birthday = ? AND role != 'pending'").bind(md).all()).results;
  return json({ recap: await latestRecap(env), birthdays });
}
