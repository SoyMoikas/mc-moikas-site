import { str, int, HttpError } from "./util.js";

const ID = /^[a-z0-9_.\-]+:[a-z0-9_.\-/]+$/i;               // minecraft:story/mine_diamond
const STAT = /^[a-z0-9_.\-]+:[a-z0-9_.\-]+\/[a-z0-9_.\-]+:[a-z0-9_.\-/]+$/i; // minecraft:mined/minecraft:stone

// Validates a quest. The edit form always sends every field; the only partial update is {active} / {sort_order}.
export function questFields(b, { partial = false } = {}) {
  const keys = Object.keys(b);
  if (partial && keys.length && keys.every((k) => k === "active" || k === "sort_order")) {
    const out = {};
    if ("active" in b) out.active = b.active ? 1 : 0;
    if ("sort_order" in b) out.sort_order = int(b.sort_order, "sort_order") ?? 0;
    return out;
  }

  const out = {
    title: str(b.title, 120, "title"),
    title_es: str(b.title_es, 120, "title_es"),
    description: str(b.description, 1000, "description"),
    description_es: str(b.description_es, 1000, "description_es"),
    xp: int(b.xp, "xp", { min: 1, max: 100000 }),
    coins: int(b.coins, "coins", { min: 0, max: 100000 }) ?? 0,
    kind: b.kind === "auto" ? "auto" : "manual",
    server_id: str(b.server_id, 40, "server_id"),
    game_id: str(b.game_id, 30, "game_id"), // which game's section it shows under (a server quest uses its server's game)
    criteria_type: null, criteria_key: null, criteria_target: null,
  };
  if (!out.title) throw new HttpError(400, "Title is required");
  if (!out.xp) throw new HttpError(400, "XP is required");

  if (out.kind === "auto") {
    if (!["stat", "advancement"].includes(b.criteria_type)) throw new HttpError(400, "Pick stat or advancement");
    out.criteria_type = b.criteria_type;
    out.criteria_key = str(b.criteria_key, 200, "criteria_key");
    const re = out.criteria_type === "stat" ? STAT : ID;
    if (!out.criteria_key || !re.test(out.criteria_key)) throw new HttpError(400, "Invalid stat/advancement id");
    out.criteria_target = out.criteria_type === "stat" ? (int(b.criteria_target, "criteria_target", { min: 1, max: 1e9 }) || 1) : null;
  }
  if ("active" in b) out.active = b.active ? 1 : 0;
  if ("sort_order" in b) out.sort_order = int(b.sort_order, "sort_order") ?? 0;
  return out;
}
