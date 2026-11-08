import { json, err, body, now } from "../../../lib/util.js";
import { need } from "../../../lib/auth.js";
import { questFields } from "../../../lib/quests.js";
import { setClause } from "../../../lib/fields.js";
import { evaluateAutoQuests, recomputeXP } from "../../../lib/xp.js";

export async function onRequestPatch({ request, env, params }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = questFields(b, { partial: true });
  if (!Object.keys(f).length) return err(400, "Nothing to update");
  f.updated_at = now();
  const { sql, values } = setClause(f);
  const res = await env.DB.prepare(`UPDATE quests SET ${sql} WHERE id = ?`).bind(...values, params.id).run();
  if (!res.meta.changes) return err(404, "Quest not found");
  await evaluateAutoQuests(env);
  await recomputeXP(env); // XP value may have changed
  return json({ ok: true });
}

// Deleting removes the XP everyone got from it. Deactivate instead to keep it.
export async function onRequestDelete({ request, env, params }) {
  const user = await need(env, request, "staff");
  if (user instanceof Response) return user;
  const res = await env.DB.prepare("DELETE FROM quests WHERE id = ?").bind(params.id).run();
  if (!res.meta.changes) return err(404, "Quest not found");
  await recomputeXP(env);
  return json({ ok: true });
}
