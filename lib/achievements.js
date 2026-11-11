// Site achievements: checked every ~10 minutes by the tick. Secret ones show as "???" until unlocked.
import { now } from "./util.js";
import { notify } from "./notify.js";

export const ACH = [
  { key: "streak7",    icon: "🔥", name: "Racha de 7 días",         desc: "Reclama tus monedas 7 días seguidos." },
  { key: "streak30",   icon: "☄️", name: "Racha de 30 días",        desc: "Reclama tus monedas 30 días seguidos." },
  { key: "night1",     icon: "🎮", name: "Primera noche de juego",  desc: "Conéctate a una noche de juego." },
  { key: "nights10",   icon: "🎉", name: "10 noches de juego",      desc: "Conéctate a 10 noches de juego." },
  { key: "champ",      icon: "🏆", name: "Campeón",                 desc: "Gana un torneo." },
  { key: "lfg10",      icon: "🙋", name: "Organizador",             desc: "Arma 10 partidas en ¿Quién se apunta?" },
  { key: "moons5",     icon: "🩸", name: "Sobreviviente",           desc: "Sobrevive 5 Lunas de Sangre en Ocaso." },
  { key: "mictlan",    icon: "💀", name: "Señor del Mictlán",       desc: "Derrota a Mictlantecuhtli." },
  { key: "diamond",    icon: "💎", name: "Diamante",                desc: "Llega a Diamante en Apex." },
  { key: "firstdiamond", icon: "👑", name: "Primero en Diamante",   desc: "El primero del grupo en llegar a Diamante.", secret: true },
  { key: "guess10",    icon: "🧩", name: "Adivinador",              desc: "Adivina 10 juegos del día." },
  { key: "guess1",     icon: "🎯", name: "A la primera",            desc: "Adivina el juego del día al primer intento.", secret: true },
  { key: "bettor",     icon: "🤑", name: "Ojo de águila",           desc: "Gana 5 apuestas." },
  { key: "hunter",     icon: "🗡️", name: "Cazarrecompensas",        desc: "Cobra una recompensa en Ocaso." },
  { key: "wanted",     icon: "📜", name: "Se busca",                desc: "Que alguien ponga precio a tu cabeza.", secret: true },
  { key: "quote",      icon: "💬", name: "Leyenda del chat",        desc: "Una frase tuya con 5 votos." },
  { key: "legendary",  icon: "🌟", name: "Suerte legendaria",       desc: "Saca algo legendario de una caja.", secret: true },
];

// One query per achievement → list of user ids that qualify.
const CHECKS = {
  streak7: "SELECT DISTINCT user_id AS id FROM daily_claims WHERE streak >= 7",
  streak30: "SELECT DISTINCT user_id AS id FROM daily_claims WHERE streak >= 30",
  night1: "SELECT DISTINCT user_id AS id FROM game_night_rsvp WHERE attended = 1",
  nights10: "SELECT user_id AS id FROM game_night_rsvp WHERE attended = 1 GROUP BY user_id HAVING COUNT(*) >= 10",
  champ: "SELECT DISTINCT user_id AS id FROM tournament_prizes WHERE place = 1",
  lfg10: "SELECT user_id AS id FROM lfg_posts GROUP BY user_id HAVING COUNT(*) >= 10",
  moons5: "SELECT u.id FROM ocaso_players o JOIN users u ON u.mc_uuid = o.mc_uuid WHERE CAST(json_extract(o.data, '$.lunas') AS INTEGER) >= 5",
  mictlan: "SELECT u.id FROM ocaso_players o JOIN users u ON u.mc_uuid = o.mc_uuid WHERE json_extract(o.data, '$.senor') = 1",
  diamond: "SELECT user_id AS id FROM apex_links WHERE json_extract(data, '$.rank.name') IN ('Diamond','Master','Apex Predator')",
  guess10: "SELECT user_id AS id FROM guess_plays WHERE solved = 1 GROUP BY user_id HAVING COUNT(*) >= 10",
  guess1: "SELECT DISTINCT user_id AS id FROM guess_plays WHERE solved = 1 AND json_array_length(guesses) = 1",
  bettor: "SELECT user_id AS id FROM coin_awards WHERE source = 'bet_win' GROUP BY user_id HAVING COUNT(*) >= 5",
  hunter: "SELECT DISTINCT claimed_by_user AS id FROM bounties WHERE status = 'claimed' AND claimed_by_user IS NOT NULL",
  wanted: "SELECT u.id FROM bounties b JOIN users u ON u.mc_uuid = b.target_uuid",
  quote: "SELECT q.author_id AS id FROM quotes q JOIN quote_votes v ON v.quote_id = q.id WHERE q.author_id IS NOT NULL GROUP BY q.id HAVING COUNT(*) >= 5",
  legendary: "SELECT DISTINCT user_id AS id FROM crate_opens WHERE rarity = 'legendary'",
};

export async function checkAchievements(env) {
  const t = now();
  const have = new Set((await env.DB.prepare("SELECT user_id, key FROM achievements").all()).results.map((r) => `${r.user_id}:${r.key}`));
  const fresh = [];
  for (const [key, sql] of Object.entries(CHECKS)) {
    let ids = [];
    try { ids = (await env.DB.prepare(sql).all()).results.map((r) => r.id).filter(Boolean); } catch { continue; }
    for (const id of ids) if (!have.has(`${id}:${key}`)) fresh.push([id, key]);
  }
  // "first to Diamond": whoever already has "diamond" earliest, only if nobody has it yet
  if (!(await env.DB.prepare("SELECT 1 FROM achievements WHERE key = 'firstdiamond'").first())) {
    const first = fresh.find(([, k]) => k === "diamond") ? fresh.find(([, k]) => k === "diamond")[0]
      : (await env.DB.prepare("SELECT user_id FROM achievements WHERE key = 'diamond' ORDER BY unlocked_at LIMIT 1").first())?.user_id;
    if (first) fresh.push([first, "firstdiamond"]);
  }
  for (const [id, key] of fresh) {
    const r = await env.DB.prepare("INSERT OR IGNORE INTO achievements (user_id, key, unlocked_at) VALUES (?, ?, ?)").bind(id, key, t).run();
    const a = ACH.find((x) => x.key === key);
    if (r.meta.changes && a) await notify(env, [id], "achieve", { title: `${a.icon} Logro desbloqueado: ${a.name}`, body: a.desc, url: "/profile" });
  }
  return fresh.length;
}
