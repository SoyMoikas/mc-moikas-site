import { json } from "../../lib/util.js";
import { getUser, publicUser } from "../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  return json({ user: publicUser(await getUser(env, request)) });
}
