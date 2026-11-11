import { need } from "../../../lib/auth.js";
import { json, body, now, err } from "../../../lib/util.js";
import { LEVELS, DAILY_DONE_CAP } from "../../../lib/dares.js";
import { award, dayIn, zoneOf } from "../../../lib/coins.js";
import { notify } from "../../../lib/notify.js";

// POST /api/dares/:id
//   {action: "done"}    you: "I did it" → waits for a friend to confirm
//   {action: "give_up"} you
//   {action: "confirm"} / {action: "deny"}  anyone else: did they really do it?
export async function onRequestPost({ env, request, params }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const d = await env.DB.prepare("SELECT * FROM dares WHERE id = ?").bind(params.id).first();
  if (!d) return err(404, "Not found");
  const t = now();
  const mine = d.user_id === me.id;
  if (b.action === "done" || b.action === "give_up") {
    if (!mine || d.status !== "active") return err(409, "Not your active challenge");
    await env.DB.prepare("UPDATE dares SET status = ?, updated_at = ? WHERE id = ?").bind(b.action === "done" ? "claimed" : "failed", t, d.id).run();
  } else if (b.action === "confirm" || b.action === "deny") {
    if (mine) return err(403, "A friend has to confirm it, not you 😏");
    if (d.status !== "claimed") return err(409, "Nothing to confirm");
    if (b.action === "deny") {
      await env.DB.prepare("UPDATE dares SET status = 'active', updated_at = ? WHERE id = ?").bind(t, d.id).run();
      await notify(env, [d.user_id], "fun", { title: `🤨 ${me.username} dice que no cumpliste el castigo`, body: d.text, url: "/play#ruleta" });
    } else {
      // coins only for your first few challenges each day
      const owner = await env.DB.prepare("SELECT tz FROM users WHERE id = ?").bind(d.user_id).first();
      const day = dayIn(zoneOf(owner)), dayStart = t - 86400000;
      const doneToday = (await env.DB.prepare("SELECT COUNT(*) AS n FROM dares WHERE user_id = ? AND status = 'done' AND updated_at > ?").bind(d.user_id, dayStart).first()).n;
      const coins = doneToday < DAILY_DONE_CAP ? LEVELS[d.level].coins : 0;
      await env.DB.prepare("UPDATE dares SET status = 'done', confirmed_by = ?, coins = ?, updated_at = ? WHERE id = ? AND status = 'claimed'").bind(me.id, coins, t, d.id).run();
      if (coins) await award(env, d.user_id, "dare", d.id, coins);
      await notify(env, [d.user_id], "fun", { title: `🎡 ¡Castigo cumplido!${coins ? ` +🪙 ${coins}` : ""}`, body: `${me.username} confirmó: ${d.text}`, url: "/play#ruleta" });
      void day;
    }
  } else return err(400, "Bad action");
  return json({ ok: true });
}
