// Auto-translation of what people write (chat, posts, answers, comments) between Spanish and English.
// Uses Cloudflare Workers AI (binding "AI", model m2m100) and caches every result in D1, so each
// text is translated once and then served free to everyone.

const MODEL = "@cf/meta/m2m100-1.2b";
const NAMES = { es: "spanish", en: "english" };
// how many new (not cached) translations the whole site may make per day — m2m100 is cheap and the free
// Workers AI allowance covers far more than this, but it keeps a spam wave from running up a bill.
export const DAILY_CAP = 3000;

// Common words that only show up in one of the two languages. Mexican slang counts as Spanish.
const ES = new Set(("que de el la los las y en es por para con una un uno no se lo le les como mas más pero ya muy bien " +
  "aca acá aqui aquí alla allá cuando donde dónde quien quién porque porqué hay estoy esta está estan están estamos soy eres somos " +
  "tengo tienes tiene tenemos quiero quieres vamos voy vas va hacemos hago hace hacer jugar juego jugamos ahorita ahora hoy mañana " +
  "ayer noche dia día gracias hola adios adiós si sí tambien también nada todo todos algo alguien nadie mucho poco mi mis tu tus su sus " +
  "nuestro yo ella ellos nosotros ustedes usted del al este esta ese esa eso esto otra otro qué cómo cuál pues entonces neta wey we güey " +
  "guey chido chida padre mano carnal bro alv xd jaja jajaja jsjs perro perrón perron chamba morro morra órale orale ándale andale " +
  "sale simón simon nel pinche bueno buena buenas buenos ok oye mira ver luego despues después antes siempre nunca puedo puedes " +
  "puede necesito sabes sé creo verdad animo ánimo ganas casa amigo amigos").split(/\s+/));
const EN = new Set(("the and is are was were be been you your yours to of it its in that this these those what why how who where when " +
  "for with have has had not can can't cant do does did don't dont doesn't my me we us our they them their he she his her i i'm im " +
  "so just like get got going go gonna wanna play playing game games anyone someone everyone tonight today tomorrow yesterday thanks " +
  "thank hello hi hey yes yeah yep nope no lol lmao omg would could should will won't wont about from there here then than out up " +
  "down all some any more much very really good great nice bad sorry please let's lets let know think want need see come back time " +
  "night day friend friends home ok okay").split(/\s+/));

// "es", "en" or null (can't tell: names, emoji, links, one-word replies that exist in both languages…)
export function detectLang(text) {
  const clean = String(text || "").toLowerCase()
    .replace(/https?:\/\/\S+/g, " ").replace(/@\S+/g, " ").replace(/:[a-z0-9_]+:/g, " ");
  const words = clean.match(/[a-záéíóúüñ']+/g) || [];
  if (!words.length) return null;
  let es = /[ñ¿¡]/.test(clean) ? 2 : 0, en = 0;
  if (/[áéíóú]/.test(clean)) es += 1;
  for (const w of words) {
    if (ES.has(w)) es++;
    if (EN.has(w)) en++;
  }
  if (es === en) return null;
  // need a clear winner: one word on its own side, or twice as many signals as the other side
  if (es > en && es >= 1 && es >= en * 2) return "es";
  if (en > es && en >= 1 && en >= es * 2) return "en";
  return null;
}

async function key(to, text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${to}|${text}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// texts: array of strings → array of translated strings (null = leave as is, undefined = try again later)
export async function translateMany(env, texts, to, { maxNew = 15 } = {}) {
  const out = new Array(texts.length).fill(null);
  const jobs = [];
  for (let i = 0; i < texts.length; i++) {
    const s = String(texts[i] || "").trim();
    if (s.length < 2 || s.length > 1000) continue;
    const from = detectLang(s);
    if (!from || from === to) continue;
    jobs.push({ i, s, from, k: await key(to, s) });
  }
  if (!jobs.length) return { out, ai: !!env.AI };

  // cache first
  const ks = [...new Set(jobs.map((j) => j.k))];
  const hit = new Map();
  for (let a = 0; a < ks.length; a += 50) {
    const part = ks.slice(a, a + 50);
    const r = await env.DB.prepare(`SELECT k, out FROM translations WHERE k IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    for (const row of r.results || []) hit.set(row.k, row.out);
  }
  const miss = [];
  for (const j of jobs) {
    if (hit.has(j.k)) out[j.i] = hit.get(j.k) || null;
    else miss.push(j);
  }
  if (!miss.length || !env.AI) {
    for (const j of miss) out[j.i] = undefined;
    return { out, ai: !!env.AI };
  }

  // daily cap for the whole site
  const day = new Date().toISOString().slice(0, 10);
  const used = (await env.DB.prepare("SELECT n FROM translate_usage WHERE day = ?").bind(day).first())?.n || 0;
  const room = Math.max(0, Math.min(maxNew, DAILY_CAP - used));
  const uniq = [];
  const seen = new Set();
  for (const j of miss) if (!seen.has(j.k)) { seen.add(j.k); uniq.push(j); }
  const todo = uniq.slice(0, room);
  const done = new Map();
  // a few at a time
  for (let a = 0; a < todo.length; a += 5) {
    await Promise.all(todo.slice(a, a + 5).map(async (j) => {
      try {
        const r = await env.AI.run(MODEL, { text: j.s, source_lang: NAMES[j.from], target_lang: NAMES[to] });
        let t = String(r?.translated_text || "").trim();
        // same as the original (names, slang it doesn't know) → store "" so we never ask again
        if (!t || t.toLowerCase() === j.s.toLowerCase()) t = "";
        done.set(j.k, t);
      } catch { /* leave for later */ }
    }));
  }
  if (done.size) {
    const now = Date.now();
    const stmts = [...done].map(([k, t]) => env.DB.prepare("INSERT OR REPLACE INTO translations (k, out, created_at) VALUES (?, ?, ?)").bind(k, t, now));
    stmts.push(env.DB.prepare("INSERT INTO translate_usage (day, n) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET n = n + excluded.n").bind(day, done.size));
    await env.DB.batch(stmts);
  }
  for (const j of miss) out[j.i] = done.has(j.k) ? (done.get(j.k) || null) : undefined;
  return { out, ai: true };
}
