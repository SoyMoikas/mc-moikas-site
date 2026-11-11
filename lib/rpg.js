// Async tabletop RPG ("Rol"): rules (simple + advanced), dice, characters, effects and the AI narrator.
import { notify } from "./notify.js";
import { award } from "./coins.js";

/* ---------------- rules ---------------- */

export const SIMPLE_STATS = ["fuerza", "agilidad", "mente", "carisma"];
export const ADV_STATS = ["fue", "des", "con", "int", "sab", "car"];
export const CLASSES = {
  guerrero:   { hd: 10, ac: (m) => 16,                 icon: "⚔️", items: ["Espada larga", "Escudo", "Cota de malla"] },
  picaro:     { hd: 8,  ac: (m) => 11 + m.des,          icon: "🗡️", items: ["Dos dagas", "Herramientas de ladrón", "Capa oscura"] },
  mago:       { hd: 6,  ac: (m) => 10 + m.des,          icon: "🔮", items: ["Bastón", "Libro de hechizos", "Bolsa de componentes"] },
  clerigo:    { hd: 8,  ac: (m) => 16,                 icon: "✨", items: ["Maza", "Símbolo sagrado", "Escudo"] },
  explorador: { hd: 10, ac: (m) => 13 + m.des,          icon: "🏹", items: ["Arco largo", "Espada corta", "Kit de supervivencia"] },
  bardo:      { hd: 8,  ac: (m) => 11 + m.des,          icon: "🎻", items: ["Laúd", "Estoque", "Ropa fina"] },
};
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const SIMPLE_POINTS = [2, 1, 1, 0]; // assign these to the 4 simple stats
export const modOf = (v) => Math.floor((v - 10) / 2);
export const levelFor = (xp, rules) => rules === "simple"
  ? 1 + Math.min(9, Math.floor(xp / 100))
  : 1 + [300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000].filter((n) => xp >= n).length;

// Validate a new character → row fields (stats JSON, hp, ac, items).
export function buildCharacter(rules, b) {
  const name = String(b.name || "").trim().slice(0, 40);
  if (name.length < 2) throw new Error("Give your character a name");
  const icon = String(b.icon || "🧙").slice(0, 4);
  const concept = String(b.concept || "").trim().slice(0, 300) || null;
  if (rules === "simple") {
    const vals = SIMPLE_STATS.map((k) => +b.stats?.[k]);
    if ([...vals].sort((a, z) => z - a).join() !== [...SIMPLE_POINTS].sort((a, z) => z - a).join()) throw new Error("Use +2, +1, +1 and 0 once each");
    const stats = Object.fromEntries(SIMPLE_STATS.map((k, i) => [k, vals[i]]));
    const hp = 10 + stats.fuerza * 2;
    return { name, icon, concept, class: null, stats, hp, ac: 10 + stats.agilidad, items: [] };
  }
  const cls = CLASSES[b.class];
  if (!cls) throw new Error("Pick a class");
  const vals = ADV_STATS.map((k) => +b.stats?.[k]);
  if ([...vals].sort((a, z) => z - a).join() !== STANDARD_ARRAY.join()) throw new Error("Use 15, 14, 13, 12, 10 and 8 once each");
  const stats = Object.fromEntries(ADV_STATS.map((k, i) => [k, vals[i]]));
  const m = Object.fromEntries(ADV_STATS.map((k) => [k, modOf(stats[k])]));
  return { name, icon: icon || cls.icon, concept, class: b.class, stats, hp: Math.max(1, cls.hd + m.con), ac: cls.ac(m), items: cls.items };
}

/* ---------------- dice ---------------- */

// "1d20+3", "2d6-1", "d20 ventaja" / "d20 adv", "3d8" → { expr, rolls, kept, total }
export function roll(exprIn) {
  const raw = String(exprIn || "").toLowerCase().trim().slice(0, 40);
  const adv = /\b(ventaja|adv)\b/.test(raw), dis = /\b(desventaja|dis)\b/.test(raw);
  const m = /^(\d{0,2})d(\d{1,3})\s*([+-]\s*\d{1,3})?/.exec(raw.replace(/\s+(des)?ventaja|\s+(adv|dis)/g, "").trim());
  if (!m) throw new Error(`Bad dice: ${exprIn}`);
  let n = +(m[1] || 1);
  const sides = +m[2], bonus = m[3] ? +m[3].replace(/\s/g, "") : 0;
  if (n < 1 || n > 20 || sides < 2 || sides > 100) throw new Error("1–20 dice, 2–100 sides");
  const one = () => 1 + Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * sides);
  if ((adv || dis) && n === 1 && sides === 20) {
    const a = one(), z = one(), keep = adv ? Math.max(a, z) : Math.min(a, z);
    return { expr: `1d20${bonus ? (bonus > 0 ? "+" : "") + bonus : ""} ${adv ? "ventaja" : "desventaja"}`, rolls: [a, z], kept: [keep], total: keep + bonus, nat: keep };
  }
  const rolls = Array.from({ length: n }, one);
  return { expr: `${n}d${sides}${bonus ? (bonus > 0 ? "+" : "") + bonus : ""}`, rolls, kept: rolls, total: rolls.reduce((s, x) => s + x, 0) + bonus, nat: n === 1 && sides === 20 ? rolls[0] : null };
}

// A check from the sheet: stat (+ proficiency in advanced) → dice expression
export function checkExpr(campaign, ch, stat, { prof = false, adv = null } = {}) {
  const stats = JSON.parse(ch.stats);
  let bonus;
  if (campaign.rules === "simple") { if (!SIMPLE_STATS.includes(stat)) throw new Error("Bad stat"); bonus = stats[stat]; }
  else {
    if (!ADV_STATS.includes(stat)) throw new Error("Bad stat");
    bonus = modOf(stats[stat]) + (prof ? 2 + Math.floor((levelFor(ch.xp, "advanced") - 1) / 4) : 0);
  }
  return `1d20${bonus ? (bonus > 0 ? "+" : "") + bonus : ""}${adv === "adv" ? " ventaja" : adv === "dis" ? " desventaja" : ""}`;
}

/* ---------------- effects (applied when a turn is resolved) ---------------- */

export async function applyEffects(env, campaign, effects) {
  const out = [];
  const chars = new Map((await env.DB.prepare("SELECT * FROM rpg_characters WHERE campaign_id = ?").bind(campaign.id).all()).results.map((c) => [c.id, c]));
  for (const e of (Array.isArray(effects) ? effects : []).slice(0, 12)) {
    const c = chars.get(+e.character_id);
    if (!c) continue;
    const hpCh = clamp(e.hp_change, -100, 100), xp = clamp(e.xp, 0, campaign.rules === "simple" ? 100 : 2000), gold = clamp(e.gold, -1000, 1000);
    let items = safeList(c.inventory);
    for (const it of (e.items_remove || []).slice(0, 5)) { const i = items.findIndex((x) => x.toLowerCase() === String(it).toLowerCase()); if (i >= 0) items.splice(i, 1); }
    for (const it of (e.items_add || []).slice(0, 5)) if (String(it).trim()) items.push(String(it).trim().slice(0, 60));
    items = items.slice(0, 40);
    const newXp = c.xp + xp, lvlBefore = levelFor(c.xp, campaign.rules), lvlAfter = levelFor(newXp, campaign.rules);
    let maxHp = c.max_hp;
    if (lvlAfter > lvlBefore) { // level up: average hit die (+con) per level, or +3 per level in simple
      const per = campaign.rules === "simple" ? 3 : Math.max(1, (CLASSES[c.class]?.hd || 8) / 2 + 1 + modOf(JSON.parse(c.stats).con));
      maxHp += per * (lvlAfter - lvlBefore);
    }
    const hp = Math.max(0, Math.min(maxHp, c.hp + hpCh + (maxHp - c.max_hp)));
    await env.DB.prepare("UPDATE rpg_characters SET hp = ?, max_hp = ?, xp = ?, gold = MAX(0, gold + ?), inventory = ? WHERE id = ?")
      .bind(hp, maxHp, newXp, gold, JSON.stringify(items), c.id).run();
    out.push({ character_id: c.id, name: c.name, hp_change: hpCh, xp, gold, items_add: (e.items_add || []).slice(0, 5), items_remove: (e.items_remove || []).slice(0, 5),
      level_up: lvlAfter > lvlBefore ? lvlAfter : null, down: hp === 0 && c.hp > 0, note: e.note ? String(e.note).slice(0, 120) : null });
  }
  return out;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
export const safeList = (s) => { try { const l = JSON.parse(s || "[]"); return Array.isArray(l) ? l.map(String) : []; } catch { return []; } };

/* ---------------- turns ---------------- */

export async function openScene(env, campaign, narration, author, effects = []) {
  const t = Date.now();
  const last = await env.DB.prepare("SELECT MAX(num) AS n FROM rpg_scenes WHERE campaign_id = ?").bind(campaign.id).first();
  await env.DB.prepare("UPDATE rpg_scenes SET status = 'closed' WHERE campaign_id = ? AND status = 'open'").bind(campaign.id).run();
  const r = await env.DB.prepare(`INSERT INTO rpg_scenes (campaign_id, num, narration, author, effects, status, opened_at, deadline) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`)
    .bind(campaign.id, (last?.n || 0) + 1, narration.slice(0, 8000), author, JSON.stringify(effects), t, t + campaign.turn_hours * 3600000).run();
  await env.DB.prepare("UPDATE rpg_campaigns SET status = 'active', updated_at = ? WHERE id = ?").bind(t, campaign.id).run();
  const players = (await env.DB.prepare("SELECT user_id FROM rpg_characters WHERE campaign_id = ?").bind(campaign.id).all()).results.map((x) => x.user_id);
  await notify(env, players, "game", { title: `🐉 Te toca en ${campaign.title}`, body: `Escena ${(last?.n || 0) + 1}: ¿qué hace tu personaje? Tienes hasta {t:${t + campaign.turn_hours * 3600000}}.`, url: `/rol?c=${campaign.id}` });
  return r.meta.last_row_id;
}

// Close the open scene with a narration (from the DM or the AI), apply effects, open the next one.
export async function resolveTurn(env, campaign, narration, effects, author) {
  const open = await env.DB.prepare("SELECT id FROM rpg_scenes WHERE campaign_id = ? AND status = 'open'").bind(campaign.id).first();
  const applied = await applyEffects(env, campaign, effects);
  if (open) {
    const actors = (await env.DB.prepare("SELECT c.user_id FROM rpg_actions a JOIN rpg_characters c ON c.id = a.character_id WHERE a.scene_id = ?").bind(open.id).all()).results;
    for (const a of actors) await award(env, a.user_id, "rpg", `act:${open.id}`, 5);
  }
  return { scene: await openScene(env, campaign, narration, author, applied), applied };
}

/* ---------------- AI narrator (Anthropic Messages API, forced tool call → always valid JSON) ---------------- */

export const aiAvailable = (env) => !!env.ANTHROPIC_API_KEY;
const TOOL = {
  name: "narrar_turno",
  description: "Narra lo que pasa tras las acciones de los jugadores y aplica consecuencias.",
  input_schema: {
    type: "object",
    properties: {
      narration: { type: "string", description: "La narración (120–350 palabras), en segunda/tercera persona, que resuelve las acciones usando los dados y termina con una situación abierta para el siguiente turno. Nunca decide por los jugadores qué hacen después." },
      effects: { type: "array", items: { type: "object", properties: {
        character_id: { type: "integer" }, hp_change: { type: "integer", description: "negativo = daño, positivo = curación" },
        xp: { type: "integer" }, gold: { type: "integer" }, items_add: { type: "array", items: { type: "string" } }, items_remove: { type: "array", items: { type: "string" } },
        note: { type: "string" } }, required: ["character_id"] } },
      summary: { type: "string", description: "Resumen actualizado de TODA la campaña hasta ahora (máx 150 palabras), para recordar la historia." },
    },
    required: ["narration", "effects", "summary"],
  },
};

export async function aiNarrate(env, campaign, kind = "resolve") {
  const chars = (await env.DB.prepare("SELECT c.*, u.username FROM rpg_characters c JOIN users u ON u.id = c.user_id WHERE c.campaign_id = ?").bind(campaign.id).all()).results;
  const scenes = (await env.DB.prepare("SELECT * FROM rpg_scenes WHERE campaign_id = ? ORDER BY num DESC LIMIT 3").bind(campaign.id).all()).results.reverse();
  const open = scenes.find((s) => s.status === "open");
  const actions = open ? (await env.DB.prepare("SELECT * FROM rpg_actions WHERE scene_id = ?").bind(open.id).all()).results : [];
  const sheet = (c) => {
    const st = JSON.parse(c.stats);
    const stats = campaign.rules === "simple" ? SIMPLE_STATS.map((k) => `${k} +${st[k]}`).join(", ") : ADV_STATS.map((k) => `${k} ${st[k]} (${modOf(st[k]) >= 0 ? "+" : ""}${modOf(st[k])})`).join(", ");
    return `- [id ${c.id}] ${c.name}${c.class ? ` (${c.class} nv ${levelFor(c.xp, campaign.rules)})` : ""}, jugador ${c.username}. PV ${c.hp}/${c.max_hp}, ${campaign.rules === "simple" ? "Defensa" : "CA"} ${c.ac}, oro ${c.gold}. ${stats}. Inventario: ${safeList(c.inventory).join(", ") || "nada"}.${c.concept ? ` Concepto: ${c.concept}` : ""}`;
  };
  const rulesTxt = campaign.rules === "simple"
    ? "Reglas SIMPLES: tirada = d20 + stat (0 a +2/+3). Dificultad: fácil 8, normal 12, difícil 16, heroica 20. 20 natural = éxito espectacular, 1 natural = complicación. Daño típico 1–6, enemigos fuertes hasta 10. XP: 10–30 por escena con logros (100 XP = siguiente nivel)."
    : "Reglas AVANZADAS (estilo D&D 5e): pruebas d20 + modificador (+competencia) contra CD 10/15/20; ataques contra CA; daño por arma (d6–d10 + mod). 20 natural = crítico. XP según el desafío (50–300 por escena con combate o logro importante).";
  const system = `Eres el narrador (Dungeon Master) de una campaña de rol por turnos asíncronos entre amigos, en ${campaign.lang === "en" ? "inglés" : "español (México)"}.
Ambientación: ${campaign.setting || "fantasía clásica"}.
${rulesTxt}
Respeta los resultados de los dados que tiraron los jugadores; si alguien no tiró y la acción es arriesgada, decide tú con criterio justo. Si un jugador no actuó, su personaje sigue al grupo sin hacer nada importante.
Sé vívido pero breve, con humor cuando venga al caso. Contenido apto para todos los jugadores (violencia de fantasía sí, nada sexual ni gore extremo). Usa los efectos para daño/curación/XP/oro/objetos — no los describas como números en la narración. Siempre termina dejando claro qué está pasando para que cada jugador decida su siguiente acción.`;
  const story = scenes.map((s) => `### Escena ${s.num}${s.status === "open" ? " (la actual)" : ""}\n${s.narration}`).join("\n\n");
  const acts = actions.map((a) => {
    const c = chars.find((x) => x.id === a.character_id);
    const rolls = JSON.parse(a.rolls || "[]").map((r) => `${r.label ? r.label + ": " : ""}${r.expr} → ${r.total}${r.nat === 20 ? " (¡20 natural!)" : r.nat === 1 ? " (1 natural)" : ""}`).join("; ");
    return `- ${c?.name || "?"} [id ${a.character_id}]: ${a.text}${rolls ? `  [dados: ${rolls}]` : ""}`;
  }).join("\n");
  const user = kind === "opening"
    ? `Crea la ESCENA DE APERTURA de la campaña "${campaign.title}". Presenta el lugar, el gancho de la aventura y a cada personaje brevemente. effects puede ir vacío.\n\nPersonajes:\n${chars.map(sheet).join("\n") || "(aún nadie)"}`
    : `Resumen de la campaña hasta ahora:\n${campaign.summary || "(empieza)"}\n\nÚltimas escenas:\n${story}\n\nPersonajes:\n${chars.map(sheet).join("\n")}\n\nAcciones de los jugadores en la escena actual:\n${acts || "(nadie actuó este turno)"}\n\nNarra qué pasa y abre la siguiente escena.`;
  const r = await fetch(env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 2500, system, tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const out = d.content?.find((c) => c.type === "tool_use")?.input;
  if (!out?.narration) throw new Error("AI returned no narration");
  return { narration: String(out.narration), effects: Array.isArray(out.effects) ? out.effects : [], summary: out.summary ? String(out.summary).slice(0, 2000) : null };
}

export async function aiResolve(env, campaign, kind = "resolve") {
  const t = Date.now();
  // lock: one resolution at a time per campaign (10-minute lease)
  const lock = await env.DB.prepare("UPDATE rpg_campaigns SET resolving = ? WHERE id = ? AND (resolving IS NULL OR resolving < ?)").bind(t, campaign.id, t - 600000).run();
  if (!lock.meta.changes) return null;
  try {
    const ai = await aiNarrate(env, campaign, kind);
    if (ai.summary) await env.DB.prepare("UPDATE rpg_campaigns SET summary = ? WHERE id = ?").bind(ai.summary, campaign.id).run();
    return kind === "opening" ? { scene: await openScene(env, campaign, ai.narration, "ai") } : await resolveTurn(env, campaign, ai.narration, ai.effects, "ai");
  } finally {
    await env.DB.prepare("UPDATE rpg_campaigns SET resolving = NULL WHERE id = ?").bind(campaign.id).run();
  }
}

/* ---------------- tick: reminders, deadlines, AI auto-resolve ---------------- */

export async function rpgTick(env, waitUntil) {
  const t = Date.now();
  let rows;
  try {
    rows = (await env.DB.prepare(`SELECT c.*, s.id AS scene_id, s.deadline, s.reminded, s.dm_pinged,
        (SELECT COUNT(*) FROM rpg_characters x WHERE x.campaign_id = c.id) AS players,
        (SELECT COUNT(*) FROM rpg_actions a WHERE a.scene_id = s.id) AS acted
      FROM rpg_campaigns c JOIN rpg_scenes s ON s.campaign_id = c.id AND s.status = 'open' WHERE c.status = 'active'`).all()).results;
  } catch { return "no tables"; }
  const done = [];
  for (const c of rows) {
    const allIn = c.players > 0 && c.acted >= c.players, late = t > c.deadline;
    if (!c.reminded && t > c.deadline - 3 * 3600000 && !allIn) {
      const missing = (await env.DB.prepare(`SELECT user_id FROM rpg_characters WHERE campaign_id = ? AND id NOT IN (SELECT character_id FROM rpg_actions WHERE scene_id = ?)`).bind(c.id, c.scene_id).all()).results.map((x) => x.user_id);
      await env.DB.prepare("UPDATE rpg_scenes SET reminded = 1 WHERE id = ?").bind(c.scene_id).run();
      await notify(env, missing, "game", { title: `⏳ ${c.title}: te quedan 3 horas`, body: "Escribe la acción de tu personaje antes de que se cierre el turno.", url: `/rol?c=${c.id}` });
      done.push(`remind ${c.id}`);
    }
    if (!(allIn || late)) continue;
    if (c.dm_mode === "ai" && aiAvailable(env)) {
      const job = aiResolve(env, c).catch((e) => console.error("rpg ai", c.id, e.message));
      if (waitUntil) waitUntil(job); else await job;
      done.push(`ai ${c.id}`);
      break; // one AI turn per tick
    } else if (!c.dm_pinged) {
      await env.DB.prepare("UPDATE rpg_scenes SET dm_pinged = 1 WHERE id = ?").bind(c.scene_id).run();
      await notify(env, [c.dm_id], "game", { title: `🎲 ${c.title}: ${allIn ? "todos ya actuaron" : "se acabó el tiempo del turno"}`, body: "Narra qué pasa para abrir la siguiente escena.", url: `/rol?c=${c.id}` });
      done.push(`dm ${c.id}`);
    }
  }
  return done.length ? done.join(", ") : "ok";
}
