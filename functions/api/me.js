import { json } from "../../lib/util.js";
import { getUser, publicUser } from "../../lib/auth.js";
import { awardActivity } from "../../lib/activity.js";

// Every page asks for /api/me, so this is where the daily-visit XP is given (in the background).
export async function onRequestGet({ request, env, waitUntil }) {
  const user = await getUser(env, request);
  if (user) waitUntil(awardActivity(env, user, "visit"));
  return json({ user: publicUser(user) });
}
