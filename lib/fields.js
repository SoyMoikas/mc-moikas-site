import { str, int, HttpError } from "./util.js";

export const TASK_STATUSES = ["open", "in_progress", "done"];
export const POST_TAGS = ["Announcement", "Event", "Update", "Maintenance", "Goal"];

// Validates editable server fields. Only keys present in `b` are returned (for PATCH).
export function serverFields(b) {
  const out = {};
  const S = (k, max) => { if (k in b) out[k] = str(b[k], max, k); };
  S("name", 60); S("game", 40); S("address", 120); S("connect_override", 140);
  S("description", 2000); S("description_es", 2000); S("mc_version", 40); S("loader", 40); S("loader_version", 60);
  S("modpack", 80); S("modpack_version", 60); S("ram", 40); S("ptero_uuid", 64); S("game_id", 30);
  if ("modpack_url" in b) {
    const u = str(b.modpack_url, 300, "modpack_url");
    if (u && !/^https?:\/\//i.test(u)) throw new HttpError(400, "Modpack link must start with http(s)://");
    out.modpack_url = u;
  }
  if ("map_url" in b) {
    // live web map (e.g. BlueMap at https://map.moikas.cc). https only, so it can be shown inside the site.
    const u = str(b.map_url, 300, "map_url");
    if (u && !/^https:\/\/[^\s"'<>]+$/i.test(u)) throw new HttpError(400, "Map link must start with https://");
    out.map_url = u;
  }
  if ("port" in b) out.port = int(b.port, "port", { min: 1, max: 65535 });
  if ("sort_order" in b) out.sort_order = int(b.sort_order, "sort_order") ?? 0;
  if ("hidden" in b) out.hidden = b.hidden ? 1 : 0;
  for (const key of ["join_steps", "join_steps_es"]) {
    if (!(key in b)) continue;
    let steps = b[key];
    if (typeof steps === "string") steps = steps.split("\n");
    if (!Array.isArray(steps)) throw new HttpError(400, `${key} must be a list`);
    steps = steps.map((s) => String(s).trim()).filter(Boolean).slice(0, 20).map((s) => s.slice(0, 300));
    out[key] = JSON.stringify(steps);
  }
  return out;
}

export function postFields(b, { partial = false } = {}) {
  const out = {};
  if (!partial || "title" in b) {
    out.title = str(b.title, 140, "title");
    if (!out.title) throw new HttpError(400, "Title is required");
  }
  if (!partial || "body" in b) {
    out.body = str(b.body, 8000, "body");
    if (!out.body) throw new HttpError(400, "Body is required");
  }
  if (!partial || "tag" in b) {
    const t = str(b.tag, 30, "tag");
    out.tag = t && POST_TAGS.includes(t) ? t : "Announcement";
  }
  if (!partial || "event_at" in b) {
    const e = str(b.event_at, 30, "event_at");
    if (e && isNaN(Date.parse(e))) throw new HttpError(400, "Event date is invalid");
    out.event_at = e;
  }
  if (!partial || "pinned" in b) out.pinned = b.pinned ? 1 : 0;
  return out;
}

export function taskFields(b, { partial = false } = {}) {
  const out = {};
  if (!partial || "title" in b) {
    out.title = str(b.title, 140, "title");
    if (!out.title) throw new HttpError(400, "Title is required");
  }
  if (!partial || "body" in b) out.body = str(b.body, 4000, "body");
  if (!partial || "status" in b) {
    const s = b.status ?? "open";
    if (!TASK_STATUSES.includes(s)) throw new HttpError(400, "Invalid status");
    out.status = s;
  }
  return out;
}

// Builds "a = ?, b = ?" plus values for an UPDATE.
export function setClause(fields) {
  const keys = Object.keys(fields);
  return { sql: keys.map((k) => `${k} = ?`).join(", "), values: keys.map((k) => fields[k]) };
}
