// "Adivina el juego": one game a day for everyone. The cover starts blurry and zoomed and clears with each wrong guess.
import { laDay } from "./coins.js";

export const MAX_GUESSES = 6;
export const REWARD = [40, 30, 22, 15, 10, 6]; // coins for solving on guess 1..6

// Well-known games (Steam app id, name, other spellings people type). Games the group owns on Steam are added too.
export const POOL = [
  [1172470, "Apex Legends", ["apex"]], [1966720, "Sons of the Forest", ["sons of the forest", "sotf"]], [242760, "The Forest", []],
  [892970, "Valheim", []], [730, "Counter-Strike 2", ["cs2", "csgo", "counter strike"]], [570, "Dota 2", ["dota"]],
  [1086940, "Baldur's Gate 3", ["bg3", "baldurs gate 3"]], [1245620, "Elden Ring", []], [413150, "Stardew Valley", ["stardew"]],
  [105600, "Terraria", []], [271590, "Grand Theft Auto V", ["gta v", "gta 5", "gta"]], [1174180, "Red Dead Redemption 2", ["rdr2", "red dead 2"]],
  [945360, "Among Us", []], [252490, "Rust", []], [1091500, "Cyberpunk 2077", ["cyberpunk"]], [292030, "The Witcher 3: Wild Hunt", ["witcher 3", "the witcher 3"]],
  [578080, "PUBG: BATTLEGROUNDS", ["pubg"]], [359550, "Tom Clancy's Rainbow Six Siege", ["rainbow six", "r6", "siege"]],
  [252950, "Rocket League", []], [1938090, "Call of Duty", ["cod", "warzone", "call of duty"]], [2357570, "Overwatch 2", ["overwatch"]],
  [553850, "HELLDIVERS 2", ["helldivers"]], [1623730, "Palworld", []], [2050650, "Resident Evil 4", ["re4", "resident evil 4"]],
  [814380, "Sekiro: Shadows Die Twice", ["sekiro"]], [374320, "DARK SOULS III", ["dark souls 3", "ds3"]], [367520, "Hollow Knight", []],
  [1145360, "Hades", []], [620, "Portal 2", []], [550, "Left 4 Dead 2", ["l4d2"]], [381210, "Dead by Daylight", ["dbd"]],
  [739630, "Phasmophobia", ["phasmo"]], [1097150, "Fall Guys", []], [2379780, "Balatro", []], [646570, "Slay the Spire", []],
  [489830, "The Elder Scrolls V: Skyrim Special Edition", ["skyrim"]], [377160, "Fallout 4", []], [1817070, "Marvel's Spider-Man Remastered", ["spider-man", "spiderman"]],
  [2767030, "Marvel Rivals", []], [1203220, "NARAKA: BLADEPOINT", ["naraka"]], [230410, "Warframe", []], [440, "Team Fortress 2", ["tf2"]],
  [4000, "Garry's Mod", ["gmod", "garrys mod"]], [227300, "Euro Truck Simulator 2", ["ets2", "euro truck"]], [1063730, "New World", []],
  [990080, "Hogwarts Legacy", []], [1716740, "Starfield", []], [2195250, "EA SPORTS FC 24", ["fc 24", "fifa"]], [1449850, "Yu-Gi-Oh! Master Duel", ["master duel"]],
  [1222670, "The Sims 4", ["sims 4", "sims"]], [289070, "Sid Meier's Civilization VI", ["civ 6", "civilization 6", "civ"]], [294100, "RimWorld", []],
  [281990, "Stellaris", []], [526870, "Satisfactory", []], [427520, "Factorio", []], [1203620, "Enshrouded", []], [1551360, "Forza Horizon 5", ["forza", "fh5"]],
  [1599340, "Lost Ark", []], [1888930, "The Last of Us Part I", ["last of us", "tlou"]], [2420110, "Horizon Forbidden West", ["horizon"]],
];

export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// Today's game: from the fixed pool + games someone in the group has played 2+ hours. Same for everyone.
export async function today(env, day = laDay()) {
  let extra = [];
  try {
    extra = (await env.DB.prepare(
      `SELECT a.appid, a.name FROM steam_apps a WHERE a.name IS NOT NULL AND a.name != '' AND a.appid IN
         (SELECT appid FROM steam_games WHERE playtime >= 120) ORDER BY a.appid`).all()).results.map((r) => [r.appid, r.name, []]);
  } catch {}
  const seen = new Set(POOL.map((p) => p[0]));
  const pool = [...POOL, ...extra.filter((e) => !seen.has(e[0]) && !/soundtrack|dedicated server|sdk|test|demo|playtest|benchmark/i.test(e[1]))];
  const [appid, name, aliases] = pool[hash("guess:" + day) % pool.length];
  return { day, appid, name, aliases, names: pool.map((p) => p[1]).sort((a, b) => a.localeCompare(b)) };
}

export function isRight(guess, g) {
  const x = norm(guess);
  if (!x) return false;
  return [g.name, ...g.aliases].some((n) => norm(n) === x) || (x.length >= 5 && norm(g.name).startsWith(x) && norm(g.name).split(" ")[0] === x.split(" ")[0] && x.length >= norm(g.name).length * 0.6);
}
