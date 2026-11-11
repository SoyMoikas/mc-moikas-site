import { need } from "../../lib/auth.js";
import { json, body, now, err } from "../../lib/util.js";
import { items, pickNext, fmtValue, DAILY_COIN_CAP } from "../../lib/hilo.js";
import { award, dayIn, zoneOf } from "../../lib/coins.js";

const MODES = ["grupo", "steam"];

async function view(env, me, run, list) {
  const day = dayIn(zoneOf(me));
  const find = (k) => list.find((i) => i.key === k);
  const a = run ? find(run.a_key) : null, b = run ? find(run.b_key) : null;
  const earned = (await env.DB.prepare("SELECT COALESCE(SUM(coins), 0) AS n FROM hl_runs WHERE user_id = ? AND day = ?").bind(me.id, day).first()).n;
  const board = (await env.DB.prepare(
    `SELECT u.username, u.avatar, r.mode, MAX(r.streak) AS best FROM hl_runs r JOIN users u ON u.id = r.user_id
      WHERE r.created_at > ? GROUP BY r.user_id, r.mode ORDER BY best DESC LIMIT 10`).bind(now() - 7 * 86400000).all()).results;
  const mine = (await env.DB.prepare("SELECT mode, MAX(streak) AS best FROM hl_runs WHERE user_id = ? GROUP BY mode").bind(me.id).all()).results;
  return {
    run: run && a && b ? {
      id: run.id, mode: run.mode, streak: run.streak, done: !!run.done,
      a: { name: a.name, img: a.img, value: a.value, label: fmtValue(run.mode, a.value) },
      b: { name: b.name, img: b.img, ...(run.done ? { value: b.value, label: fmtValue(run.mode, b.value) } : {}) },
    } : null,
    coins_today: earned, cap: DAILY_COIN_CAP, board, best: Object.fromEntries(mine.map((m) => [m.mode, m.best])),
    group_ready: (await items(env, "grupo")).length >= 8,
  };
}

// values change (live players), so the run stores the numbers it was shown
async function withValues(env, run) {
  const vals = JSON.parse(run.seen || "[]");
  const list = await items(env, run.mode);
  return list.map((i) => { const s = vals.find((v) => v.key === i.key); return s ? { ...i, value: s.value } : i; });
}

// GET /api/hilo → your current run (or none) + leaderboard
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const run = await env.DB.prepare("SELECT * FROM hl_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1").bind(me.id).first();
  return json(await view(env, me, run, run ? await withValues(env, run) : []));
}

// POST /api/hilo {action: "start", mode} | {action: "guess", choice: "higher" | "lower"}
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now(), day = dayIn(zoneOf(me));

  if (b.action === "start") {
    const mode = MODES.includes(b.mode) ? b.mode : "steam";
    const list = await items(env, mode);
    if (list.length < 8) return err(409, mode === "grupo" ? "Not enough Steam games linked yet — try the live mode" : "No games");
    await env.DB.prepare("UPDATE hl_runs SET done = 1 WHERE user_id = ? AND done = 0").bind(me.id).run();
    const a = await pickNext(env, mode, list, [], null);
    const c = a && await pickNext(env, mode, list, [a.key], a.value);
    if (!a || !c) return err(502, "Couldn't load games, try again");
    const seen = [{ key: a.key, value: a.value }, { key: c.key, value: c.value }];
    await env.DB.prepare("INSERT INTO hl_runs (user_id, mode, a_key, b_key, seen, day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(me.id, mode, a.key, c.key, JSON.stringify(seen), day, t, t).run();
  } else if (b.action === "guess") {
    const run = await env.DB.prepare("SELECT * FROM hl_runs WHERE user_id = ? AND done = 0 ORDER BY id DESC LIMIT 1").bind(me.id).first();
    if (!run) return err(409, "Start a game first");
    const seen = JSON.parse(run.seen);
    const av = seen.find((s) => s.key === run.a_key).value, bv = seen.find((s) => s.key === run.b_key).value;
    const right = b.choice === "higher" ? bv > av : bv < av;
    if (!right) {
      await env.DB.prepare("UPDATE hl_runs SET done = 1, updated_at = ? WHERE id = ?").bind(t, run.id).run();
    } else {
      const earned = (await env.DB.prepare("SELECT COALESCE(SUM(coins), 0) AS n FROM hl_runs WHERE user_id = ? AND day = ?").bind(me.id, day).first()).n;
      const coin = earned < DAILY_COIN_CAP ? 1 : 0;
      const list = await items(env, run.mode);
      const next = await pickNext(env, run.mode, list, seen.map((s) => s.key), bv);
      if (!next) { // ran out of games: you beat the whole list
        await env.DB.prepare("UPDATE hl_runs SET streak = streak + 1, coins = coins + ?, done = 1, updated_at = ? WHERE id = ?").bind(coin, t, run.id).run();
      } else {
        seen.push({ key: next.key, value: next.value });
        await env.DB.prepare("UPDATE hl_runs SET a_key = b_key, b_key = ?, seen = ?, streak = streak + 1, coins = coins + ?, updated_at = ? WHERE id = ?")
          .bind(next.key, JSON.stringify(seen), coin, t, run.id).run();
      }
      if (coin) await award(env, me.id, "hilo", `${run.id}:${run.streak + 1}`, 1);
    }
    const fresh = await env.DB.prepare("SELECT * FROM hl_runs WHERE id = ?").bind(run.id).first();
    const v = await view(env, me, fresh, await withValues(env, fresh));
    // on a right answer, also show the value that was just revealed
    return json({ ...v, right, revealed: { value: bv, label: fmtValue(run.mode, bv) } });
  } else return err(400, "Bad action");

  const run = await env.DB.prepare("SELECT * FROM hl_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1").bind(me.id).first();
  return json(await view(env, me, run, await withValues(env, run)));
}
