import { getUser } from "../../lib/auth.js";
import { json } from "../../lib/util.js";
import { ACH } from "../../lib/achievements.js";

// GET /api/achievements?user=<id> → every achievement, unlocked or not (secret ones hidden until unlocked)
export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  const uid = parseInt(new URL(request.url).searchParams.get("user")) || me?.id || 0;
  const got = new Map((await env.DB.prepare("SELECT key, unlocked_at FROM achievements WHERE user_id = ?").bind(uid).all()).results.map((r) => [r.key, r.unlocked_at]));
  const counts = new Map((await env.DB.prepare("SELECT key, COUNT(*) AS n FROM achievements GROUP BY key").all()).results.map((r) => [r.key, r.n]));
  return json({ achievements: ACH.map((a) => {
    const at = got.get(a.key) || null;
    const hide = a.secret && !at;
    return { key: a.key, icon: hide ? "❓" : a.icon, name: hide ? "???" : a.name, desc: hide ? "Logro secreto" : a.desc, secret: !!a.secret, unlocked_at: at, holders: counts.get(a.key) || 0 };
  }) });
}
