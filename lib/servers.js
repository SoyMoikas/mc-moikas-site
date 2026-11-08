// Merges a `servers` row (manual fields) with synced Pterodactyl data.
// Manual fields always win; blank ones fall back to what Pterodactyl reports.

export const STALE_MS = 10 * 60 * 1000; // no sync for 10 min → status unknown

const MC_VERSION_KEYS = ["MINECRAFT_VERSION", "MC_VERSION", "VANILLA_VERSION", "VERSION"];
const LOADER_KEYS = [
  ["NEOFORGE_VERSION", "NeoForge"],
  ["FORGE_VERSION", "Forge"],
  ["FABRIC_LOADER_VERSION", "Fabric"],
  ["FABRIC_VERSION", "Fabric"],
  ["QUILT_VERSION", "Quilt"],
  ["LOADER_VERSION", null],
  ["BUILD_NUMBER", null],
];

function loaderFromEgg(egg) {
  const e = String(egg || "").toLowerCase();
  for (const [needle, name] of [["neoforge", "NeoForge"], ["forge", "Forge"], ["fabric", "Fabric"],
    ["quilt", "Quilt"], ["paper", "Paper"], ["purpur", "Purpur"], ["spigot", "Spigot"],
    ["bungee", "BungeeCord"], ["velocity", "Velocity"], ["vanilla", "Vanilla"]]) {
    if (e.includes(needle)) return name;
  }
  return null;
}

function gameFromEgg(egg) {
  const e = String(egg || "").toLowerCase();
  if (!e) return null;
  if (/minecraft|forge|fabric|paper|spigot|purpur|vanilla|bungee|velocity|curse|modpack|quilt/.test(e)) return "Minecraft";
  return null;
}

export function pteroInfo(p) {
  if (!p) return {};
  const v = p.variables || {};
  let mc = null;
  for (const k of MC_VERSION_KEYS) if (v[k]) { mc = v[k]; break; }
  let loader = loaderFromEgg(p.egg), loaderVersion = null;
  for (const [k, name] of LOADER_KEYS) {
    if (v[k]) { loaderVersion = v[k]; loader = name || loader; break; }
  }
  return {
    name: p.name || null,
    description: p.description || null,
    game: gameFromEgg(p.egg),
    port: Number.isInteger(p.port) ? p.port : null,
    mc_version: mc,
    loader,
    loader_version: loaderVersion,
  };
}

export function mergeServer(row, pteroRow, env, { admin = false } = {}) {
  const p = pteroRow ? safeParse(pteroRow.data) : null;
  const syncedAt = pteroRow ? pteroRow.synced_at : null;
  const fresh = syncedAt && Date.now() - syncedAt < STALE_MS;
  const auto = pteroInfo(p);
  const pick = (k) => (row[k] !== null && row[k] !== undefined && row[k] !== "" ? row[k] : auto[k] ?? null);

  const port = pick("port");
  const address = row.address || env.PUBLIC_HOST || "";
  const connect = row.connect_override || (port && port !== 25565 ? `${address}:${port}` : address);

  let status = null, playersOnline = null, playersMax = null;
  if (p) {
    status = fresh ? p.state || "unknown" : "unknown";
    if (fresh && status === "running") {
      playersOnline = Number.isInteger(p.players_online) ? p.players_online : null;
      playersMax = Number.isInteger(p.players_max) ? p.players_max : null;
    }
  }

  const out = {
    id: row.id,
    game_id: row.game_id || null,
    name: pick("name") || row.id,
    game: pick("game") || "Minecraft",
    description: pick("description"),
    description_es: row.description_es || null,
    connect,
    address,
    port,
    mc_version: pick("mc_version"),
    loader: pick("loader"),
    loader_version: pick("loader_version"),
    modpack: row.modpack,
    modpack_version: row.modpack_version,
    modpack_url: row.modpack_url,
    ram: row.ram,
    join_steps: safeParse(row.join_steps) || [],
    join_steps_es: safeParse(row.join_steps_es) || [],
    status,                 // running | offline | starting | stopping | unknown | null (not linked)
    players_online: playersOnline,
    players_max: playersMax,
    synced_at: syncedAt,
    linked: !!row.ptero_uuid,
    hidden: !!row.hidden,
    sort_order: row.sort_order,
    updated_at: row.updated_at,
  };

  if (admin) {
    out.raw = { ...row, join_steps: safeParse(row.join_steps) || [], join_steps_es: safeParse(row.join_steps_es) || [] };
    out.ptero = p ? { ...p, synced_at: syncedAt } : null;
    out.auto = auto;
  }
  return out;
}

export const SERVER_SELECT = `
  SELECT s.*, p.data AS p_data, p.synced_at AS p_synced_at
    FROM servers s LEFT JOIN ptero_servers p ON p.uuid = s.ptero_uuid`;

export function splitRow(r) {
  const { p_data, p_synced_at, ...row } = r;
  return [row, p_data ? { data: p_data, synced_at: p_synced_at } : null];
}

function safeParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
