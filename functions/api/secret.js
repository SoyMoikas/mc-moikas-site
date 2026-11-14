import { json, now } from "../../lib/util.js";
import { need } from "../../lib/auth.js";
import { notify } from "../../lib/notify.js";
import { ACH } from "../../lib/achievements.js";

// POST /api/secret → the hidden page (/umbral) calls this: records that you found it (a secret achievement)
// and returns everyone who has, in the order they arrived.
export async function onRequestPost({ request, env }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  const r = await env.DB.prepare("INSERT OR IGNORE INTO achievements (user_id, key, unlocked_at) VALUES (?, 'umbral', ?)").bind(user.id, now()).run();
  const a = ACH.find((x) => x.key === "umbral");
  if (r.meta.changes && a) {
    try { await notify(env, [user.id], "achieve", { title: `${a.icon} Logro desbloqueado: ${a.name}`, body: a.desc, url: "/profile" }); } catch { /* the page still works */ }
  }
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, a.unlocked_at FROM achievements a JOIN users u ON u.id = a.user_id
      WHERE a.key = 'umbral' ORDER BY a.unlocked_at, u.id LIMIT 200`
  ).all();
  return json({ souls: results, mine: results.findIndex((x) => x.id === user.id) + 1, first: !!r.meta.changes });
}
