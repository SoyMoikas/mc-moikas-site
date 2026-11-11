import { need } from "../../../lib/auth.js";
import { json, body, err } from "../../../lib/util.js";
import { today, isRight, MAX_GUESSES, REWARD } from "../../../lib/guess.js";
import { award, dayIn, zoneOf } from "../../../lib/coins.js";

const state = async (env, uid, g) => {
  const p = await env.DB.prepare("SELECT * FROM guess_plays WHERE day = ? AND user_id = ?").bind(g.day, uid).first();
  const guesses = p ? JSON.parse(p.guesses) : [];
  const done = !!p?.done;
  const board = (await env.DB.prepare(
    `SELECT u.username, u.avatar, g.solved, json_array_length(g.guesses) AS n FROM guess_plays g JOIN users u ON u.id = g.user_id
      WHERE g.day = ? AND g.done = 1 ORDER BY g.solved DESC, n ASC`).bind(g.day).all()).results;
  return { day: g.day, max: MAX_GUESSES, rewards: REWARD, guesses, solved: !!p?.solved, done, coins: p?.coins || 0,
    answer: done ? { name: g.name, appid: g.appid } : null, names: g.names, board };
};

// GET /api/guess → today's puzzle state for you (the answer only once you're done)
export async function onRequestGet({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  return json(await state(env, me.id, await today(env, dayIn(zoneOf(me)))));
}

// POST /api/guess {guess} (or {skip: true} to use a guess and see more of the picture)
export async function onRequestPost({ env, request }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const g = await today(env, dayIn(zoneOf(me)));
  const p = await env.DB.prepare("SELECT * FROM guess_plays WHERE day = ? AND user_id = ?").bind(g.day, me.id).first();
  if (p?.done) return err(409, "You already played today");
  const guesses = p ? JSON.parse(p.guesses) : [];
  const text = b.skip ? "—" : String(b.guess || "").trim().slice(0, 80);
  if (!text) return err(400, "Type a game");
  guesses.push(text);
  const solved = !b.skip && isRight(text, g);
  const done = solved || guesses.length >= MAX_GUESSES;
  const coins = solved ? REWARD[guesses.length - 1] : 0;
  await env.DB.prepare(
    `INSERT INTO guess_plays (day, user_id, guesses, solved, done, coins) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, user_id) DO UPDATE SET guesses = excluded.guesses, solved = excluded.solved, done = excluded.done, coins = excluded.coins`
  ).bind(g.day, me.id, JSON.stringify(guesses), solved ? 1 : 0, done ? 1 : 0, coins).run();
  if (coins) await award(env, me.id, "guess", g.day, coins);
  return json({ ...(await state(env, me.id, g)), right: solved });
}
