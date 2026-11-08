import { json, err } from "../../../lib/util.js";
import { need, hasRole } from "../../../lib/auth.js";

// Authors can delete their own messages; staff can delete any. Soft delete so open chats can remove it too.
export async function onRequestDelete({ request, env, params }) {
  const user = await need(env, request, "member");
  if (user instanceof Response) return user;
  const m = await env.DB.prepare("SELECT user_id FROM chat_messages WHERE id = ? AND deleted = 0").bind(params.id).first();
  if (!m) return err(404, "Message not found");
  if (m.user_id !== user.id && !hasRole(user, "staff")) return err(403, "Not allowed");
  await env.DB.prepare("UPDATE chat_messages SET deleted = 1, body = '' WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
