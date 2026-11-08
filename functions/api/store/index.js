import { json, err, body, now } from "../../../../lib/util.js";
import { needPerm } from "../../../../lib/auth.js";
import { collectionFields } from "../../../../lib/catalog.js";

// Admin / sub-admin with "store": create a themed collection.
export async function onRequestPost({ request, env }) {
  const user = await needPerm(env, request, "store");
  if (user instanceof Response) return user;
  const b = await body(request);
  if (b instanceof Response) return b;
  const f = collectionFields(b, { creating: true });
  if (await env.DB.prepare("SELECT 1 FROM collections WHERE id = ?").bind(f.id).first()) return err(409, "A collection with that id already exists");
  const t = now();
  const row = { ...f, created_at: t, updated_at: t };
  const keys = Object.keys(row);
  await env.DB.prepare(`INSERT INTO collections (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).bind(...keys.map((k) => row[k])).run();
  return json({ id: f.id }, 201);
}
