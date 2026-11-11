// Weekly recap ("Resumen semanal"), birthdays, and Steam sale alerts — all run from the tick.
import { now } from "./util.js";
import { award, laDay, laHour, laWeekday, laWeekStart } from "./coins.js";
import { notify, allMembers } from "./notify.js";
import { discord, site } from "./lfg.js";

const kvGet = async (env, k) => { const r = await env.DB.prepare("SELECT value FROM kv_cache WHERE key = ?").bind(k).first(); return r ? JSON.parse(r.value) : null; };
const kvSet = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO kv_cache (key, value, updated_at) VALUES (?, ?, ?)").bind(k, JSON.stringify(v), now()).run();
const post = (env, payload) => (env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL)
  ? discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, { allowed_mentions: { parse: [] }, ...payload }) : null;

/* ---------------- weekly recap ---------------- */

// Snapshot everyone's playtime at the start of each week so we can tell how much they played since.
export async function snapshotWeek(env) {
  const ws = laWeekStart();
  const done = await env.DB.prepare("SELECT 1 FROM week_baseline WHERE week_start = ? LIMIT 1").bind(ws).first();
  if (done) return false;
  await env.DB.prepare("INSERT OR IGNORE INTO week_baseline (week_start, user_id, play_minutes) SELECT ?, id, play_minutes FROM users WHERE role != 'pending'").bind(ws).run();
  return true;
}

export async function computeRecap(env, from, to) {
  const DB = env.DB;
  const one = async (sql, ...b) => (await DB.prepare(sql).bind(...b).first()) || null;
  const rows = async (sql, ...b) => (await DB.prepare(sql).bind(...b).all()).results;
  const r = { from, to, items: [] };
  const add = (icon, title, who, detail) => who && r.items.push({ icon, title, who, detail });

  const hours = await one(`SELECT u.username AS who, u.play_minutes - b.play_minutes AS m FROM week_baseline b JOIN users u ON u.id = b.user_id
                            WHERE b.week_start = ? ORDER BY m DESC LIMIT 1`, from);
  if (hours?.m > 0) add("⏱️", "Más horas jugadas (servidores)", hours.who, `${Math.round(hours.m / 6) / 10} h`);
  const apex = await one(`SELECT u.username AS who, CAST(json_extract(a.data, '$.rank.score') AS INTEGER) - a.week_score AS rp
                           FROM apex_links a JOIN users u ON u.id = a.user_id WHERE a.week_score IS NOT NULL ORDER BY rp DESC LIMIT 1`).catch(() => null);
  if (apex?.rp > 0) add("📈", "El que más subió en Apex", apex.who, `+${apex.rp} RP`);
  const deaths = await one(`SELECT name AS who, COUNT(*) AS n FROM mc_deaths WHERE created_at >= ? AND created_at < ? GROUP BY name ORDER BY n DESC LIMIT 1`, from, to);
  if (deaths?.n) add("💀", "Salón de la vergüenza (más muertes en Ocaso)", deaths.who, `${deaths.n} muertes`);
  const nights = await one(`SELECT u.username AS who, COUNT(*) AS n FROM game_night_rsvp r JOIN game_nights g ON g.id = r.night_id JOIN users u ON u.id = r.user_id
                             WHERE r.attended = 1 AND g.starts_at >= ? AND g.starts_at < ? GROUP BY r.user_id ORDER BY n DESC LIMIT 1`, from, to);
  if (nights?.n) add("🎉", "No faltó a las noches de juego", nights.who, `${nights.n} noche(s)`);
  const host = await one(`SELECT u.username AS who, COUNT(*) AS n FROM lfg_posts p JOIN users u ON u.id = p.user_id WHERE p.created_at >= ? AND p.created_at < ? GROUP BY p.user_id ORDER BY n DESC LIMIT 1`, from, to);
  if (host?.n) add("🙋", "El que más armó partidas", host.who, `${host.n} partida(s)`);
  const guesser = await one(`SELECT u.username AS who, COUNT(*) AS n FROM guess_plays g JOIN users u ON u.id = g.user_id WHERE g.solved = 1 AND g.day >= ? AND g.day < ? GROUP BY g.user_id ORDER BY n DESC LIMIT 1`, laDay(from), laDay(to));
  if (guesser?.n) add("🧩", "Mejor adivinador", guesser.who, `${guesser.n} juego(s)`);
  const bets = await one(`SELECT u.username AS who, SUM(c.coins) AS n FROM coin_awards c JOIN users u ON u.id = c.user_id WHERE c.source = 'bet_win' AND c.created_at >= ? AND c.created_at < ? GROUP BY c.user_id ORDER BY n DESC LIMIT 1`, from, to);
  if (bets?.n) add("🤑", "Rey de las apuestas", bets.who, `+🪙 ${bets.n}`);
  const quote = await one(`SELECT q.body AS detail, u.username AS who, COUNT(v.user_id) AS n FROM quotes q LEFT JOIN quote_votes v ON v.quote_id = q.id LEFT JOIN users u ON u.id = q.author_id
                            WHERE q.created_at >= ? AND q.created_at < ? GROUP BY q.id ORDER BY n DESC LIMIT 1`, from, to);
  if (quote) add("💬", "Frase de la semana", quote.who || "?", `“${quote.detail.slice(0, 120)}”`);
  const champ = await rows(`SELECT t.title, tt.name FROM tournaments t JOIN tournament_teams tt ON tt.id = t.winner_team_id WHERE t.finished_at >= ? AND t.finished_at < ?`, from, to);
  for (const c of champ) add("🏆", `Campeones de ${c.title}`, c.name, "");
  return r;
}

export async function weeklyRecap(env) {
  // 1) first tick of the week: freeze last week's numbers (before Apex/playtime counters roll over)
  const ws = laWeekStart();
  if (!(await kvGet(env, `recap:${ws}`))) {
    const recap = await computeRecap(env, laWeekStart(ws - 3 * 86400000), ws);
    await kvSet(env, `recap:${ws}`, { recap, posted: false });
  }
  // 2) post it Monday from 10 am LA
  const st = await kvGet(env, `recap:${ws}`);
  if (st.posted || laWeekday() !== 1 || laHour() < 10) return false;
  await kvSet(env, `recap:${ws}`, { ...st, posted: true });
  const recap = st.recap;
  if (!recap.items.length) return false;
  await kvSet(env, "recap_latest", recap);
  await post(env, { embeds: [{ title: "📰 Resumen de la semana", color: 0xf2b33d, url: `${site(env)}/`,
    description: recap.items.map((i) => `${i.icon} **${i.title}:** ${i.who}${i.detail ? ` — ${i.detail}` : ""}`).join("\n").slice(0, 4000) }] });
  await notify(env, await allMembers(env), "fun", { title: "📰 Ya salió el resumen de la semana", body: recap.items.slice(0, 3).map((i) => `${i.icon} ${i.who}`).join(" · "), url: "/" });
  return true;
}

export const latestRecap = (env) => kvGet(env, "recap_latest");

/* ---------------- birthdays ---------------- */

export async function birthdays(env) {
  if (laHour() < 9) return 0;
  const day = laDay(), md = day.slice(5), year = day.slice(0, 4);
  const people = (await env.DB.prepare("SELECT id, username, discord_id FROM users WHERE birthday = ? AND role != 'pending'").bind(md).all()).results;
  let n = 0;
  for (const p of people) {
    if (!(await award(env, p.id, "birthday", year, 100))) continue;
    n++;
    await notify(env, [p.id], "fun", { title: "🎂 ¡Feliz cumpleaños!", body: "Te regalamos 🪙 100. ¡Que te la pases increíble!", url: "/profile" });
    await post(env, { content: `🎂 ¡Hoy cumple años <@${p.discord_id}>! Felicítenlo 🥳 (+🪙 100 de regalo)`, allowed_mentions: { users: [p.discord_id] } });
  }
  return n;
}

/* ---------------- Steam sales ---------------- */

// Games at least 2 people own but not everyone: when one goes 50%+ off, tell the people missing it.
export async function steamSales(env) {
  const linked = (await env.DB.prepare("SELECT user_id FROM steam_links WHERE public = 1").all()).results.map((r) => r.user_id);
  if (linked.length < 3) return null;
  const cand = (await env.DB.prepare(
    `SELECT g.appid, COUNT(*) AS owners FROM steam_games g JOIN steam_apps a ON a.appid = g.appid
      WHERE g.user_id IN (${linked.map(() => "?").join(",")}) AND COALESCE(a.multiplayer, 1) = 1
      GROUP BY g.appid HAVING owners >= 2 AND owners < ? ORDER BY owners DESC LIMIT 80`).bind(...linked, linked.length).all()).results;
  if (!cand.length) return null;
  const ids = cand.map((c) => c.appid);
  const due = await env.DB.prepare(
    `SELECT c.value AS appid FROM json_each(?) c LEFT JOIN steam_prices p ON p.appid = c.value WHERE COALESCE(p.checked_at, 0) < ? ORDER BY COALESCE(p.checked_at, 0) LIMIT 1`
  ).bind(JSON.stringify(ids), now() - 12 * 3600000).first();
  if (!due) return null;
  const appid = due.appid;
  const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&filters=price_overview,basic`);
  const d = (await r.json().catch(() => null))?.[appid];
  const po = d?.data?.price_overview;
  const disc = po?.discount_percent || 0;
  const prev = await env.DB.prepare("SELECT notified_discount FROM steam_prices WHERE appid = ?").bind(appid).first();
  await env.DB.prepare(
    `INSERT INTO steam_prices (appid, discount, final_price, initial_price, checked_at, notified_discount) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(appid) DO UPDATE SET discount = excluded.discount, final_price = excluded.final_price, initial_price = excluded.initial_price,
       checked_at = excluded.checked_at, notified_discount = CASE WHEN excluded.discount = 0 THEN 0 ELSE steam_prices.notified_discount END`
  ).bind(appid, disc, po?.final_formatted || null, po?.initial_formatted || null, now(), prev?.notified_discount || 0).run();
  if (disc < 50 || disc <= (prev?.notified_discount || 0)) return appid;
  await env.DB.prepare("UPDATE steam_prices SET notified_discount = ? WHERE appid = ?").bind(disc, appid).run();
  const owners = new Set((await env.DB.prepare("SELECT user_id FROM steam_games WHERE appid = ?").bind(appid).all()).results.map((x) => x.user_id));
  const missing = linked.filter((id) => !owners.has(id));
  const name = d?.data?.name || `App ${appid}`;
  const url = `https://store.steampowered.com/app/${appid}`;
  await notify(env, missing, "fun", { title: `💸 ${name} está al -${disc}%`, body: `${owners.size} del grupo ya lo tienen · ${po.final_formatted} (antes ${po.initial_formatted})`, url });
  await post(env, { content: `💸 **${name}** está al **-${disc}%** en Steam (${po.final_formatted}). ${owners.size} del grupo ya lo tienen — ¿se animan?`,
    embeds: [{ title: name, url, image: { url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg` } }] });
  return appid;
}

/* ---------------- quote of the month ---------------- */

// On the 1st (from 10 am LA): the most-voted quote of last month wins 🪙 50 for whoever said it.
export async function quoteOfMonth(env) {
  const day = laDay();
  if (day.slice(8) !== "01" || laHour() < 10) return false;
  const month = (() => { const d = new Date(day + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  if (await kvGet(env, `quotemonth:${month}`)) return false;
  await kvSet(env, `quotemonth:${month}`, true);
  const from = Date.parse(month + "-01T08:00:00Z"), to = Date.parse(day + "T08:00:00Z");
  const q = await env.DB.prepare(
    `SELECT q.id, q.body, q.author_id, u.username, u.discord_id, COUNT(v.user_id) AS votes FROM quotes q JOIN quote_votes v ON v.quote_id = q.id
       LEFT JOIN users u ON u.id = q.author_id WHERE q.created_at >= ? AND q.created_at < ? GROUP BY q.id ORDER BY votes DESC, q.created_at LIMIT 1`).bind(from, to).first();
  if (!q) return false;
  if (q.author_id) {
    await award(env, q.author_id, "quote_month", month, 50);
    await notify(env, [q.author_id], "fun", { title: "💬 ¡Tu frase ganó la frase del mes!", body: `“${q.body.slice(0, 120)}” · +🪙 50`, url: "/play#frases" });
  }
  await post(env, { content: `💬 **Frase del mes** (${q.votes} votos) — ${q.username || "?"}:\n> ${q.body.slice(0, 300)}` });
  return true;
}
