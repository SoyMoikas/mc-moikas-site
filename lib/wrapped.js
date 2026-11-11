// Moikas Wrapped: a year in review for each person + the whole group. Opens Dec 1 (LA time); past years stay open.
import { laDay } from "./coins.js";
import { notify, allMembers } from "./notify.js";
import { discord, site } from "./lfg.js";

const HOUR = 3600;
export const bounds = (Y) => ({ from: Date.UTC(Y, 0, 1, 8), to: Date.UTC(Y + 1, 0, 1, 8) });
export const opensAt = (Y) => Date.UTC(Y, 11, 1, 8); // Dec 1, midnight LA
export const currentYear = () => +laDay().slice(0, 4);
export const isOpen = (Y, t = Date.now()) => t >= opensAt(Y);

const all = async (env, sql, ...b) => { try { return (await env.DB.prepare(sql).bind(...b).all()).results; } catch (e) { console.error("wrapped", e.message, sql.slice(0, 80)); return []; } };
const one = async (env, sql, ...b) => (await all(env, sql, ...b))[0] || null;
const num = async (env, sql, ...b) => (await one(env, sql, ...b))?.n || 0;
const byUser = (rows, key = "n") => new Map(rows.map((r) => [r.user_id, r[key] || 0]));

// Per-person totals for everyone (used for ranks, the MVP and each person's "type").
async function everyone(env, Y) {
  const { from, to } = bounds(Y), y = String(Y), ym = `${y}-%`;
  const [users, play, posts, comments, chat, likes, nightsGo, nightsHost, lfgMade, lfgJoined, events, music, ratings, watchN, tourn, wins, daily, goals, qotd, guess] = await Promise.all([
    all(env, "SELECT id, username, avatar FROM users WHERE role != 'pending'"),
    all(env, "SELECT user_id, SUM(seconds) AS n FROM play_log WHERE month LIKE ? GROUP BY user_id", ym),
    all(env, "SELECT user_id, COUNT(*) AS n FROM social_posts WHERE deleted = 0 AND created_at BETWEEN ? AND ? GROUP BY user_id", from, to),
    all(env, "SELECT user_id, COUNT(*) AS n FROM social_comments WHERE created_at BETWEEN ? AND ? GROUP BY user_id", from, to),
    all(env, "SELECT user_id, COUNT(*) AS n FROM chat_messages WHERE deleted = 0 AND created_at BETWEEN ? AND ? GROUP BY user_id", from, to),
    all(env, "SELECT p.user_id, COUNT(*) AS n FROM social_likes l JOIN social_posts p ON p.id = l.post_id WHERE l.created_at BETWEEN ? AND ? GROUP BY p.user_id", from, to),
    all(env, "SELECT r.user_id, SUM(n.kind = 'watch') AS w, SUM(n.kind != 'watch') AS n FROM game_night_rsvp r JOIN game_nights n ON n.id = r.night_id WHERE r.attended = 1 AND n.starts_at BETWEEN ? AND ? GROUP BY r.user_id", from, to),
    all(env, "SELECT user_id, COUNT(*) AS n FROM game_nights WHERE created_at BETWEEN ? AND ? GROUP BY user_id", from, to),
    all(env, "SELECT user_id, COUNT(*) AS n FROM lfg_posts WHERE created_at BETWEEN ? AND ? GROUP BY user_id", from, to),
    all(env, "SELECT m.user_id, COUNT(*) AS n FROM lfg_members m JOIN lfg_posts p ON p.id = m.post_id WHERE m.user_id != p.user_id AND m.joined_at BETWEEN ? AND ? GROUP BY m.user_id", from, to),
    all(env, "SELECT created_by AS user_id, COUNT(*) AS n FROM events WHERE created_at BETWEEN ? AND ? GROUP BY created_by", from, to),
    all(env, "SELECT user_id, COUNT(*) AS n FROM listen_log WHERE kind = 'music' AND created_at BETWEEN ? AND ? GROUP BY user_id", from, to),
    all(env, "SELECT user_id, COUNT(*) AS n FROM watch_ratings WHERE created_at BETWEEN ? AND ? GROUP BY user_id", from, to),
    all(env, "SELECT user_id, COUNT(*) AS n FROM listen_log WHERE kind = 'watch' AND created_at BETWEEN ? AND ? GROUP BY user_id", from, to),
    all(env, "SELECT m.user_id, COUNT(DISTINCT m.tournament_id) AS n FROM tournament_members m JOIN tournaments t ON t.id = m.tournament_id WHERE t.starts_at BETWEEN ? AND ? GROUP BY m.user_id", from, to),
    all(env, "SELECT p.user_id, COUNT(*) AS n FROM tournament_prizes p JOIN tournaments t ON t.id = p.tournament_id WHERE p.place = 1 AND t.starts_at BETWEEN ? AND ? GROUP BY p.user_id", from, to),
    all(env, "SELECT user_id, COUNT(*) AS n, MAX(streak) AS best FROM daily_claims WHERE day LIKE ? GROUP BY user_id", ym),
    all(env, "SELECT g.user_id, COUNT(*) AS n FROM goal_checks c JOIN goals g ON g.id = c.goal_id WHERE c.day LIKE ? GROUP BY g.user_id", ym),
    all(env, "SELECT user_id, COUNT(*) AS n FROM qotd_answers WHERE day LIKE ? GROUP BY user_id", ym),
    all(env, "SELECT user_id, SUM(solved) AS n FROM guess_plays WHERE day LIKE ? GROUP BY user_id", ym),
  ]);
  const m = (rows) => byUser(rows);
  const P = m(play), Po = m(posts), C = m(comments), Ch = m(chat), L = m(likes), NH = m(nightsHost), LM = m(lfgMade), LJ = m(lfgJoined), E = m(events),
    Mu = m(music), R = m(ratings), W = m(watchN), T = m(tourn), Wi = m(wins), D = m(daily), G = m(goals), Q = m(qotd), Gu = m(guess);
  const NG = byUser(nightsGo, "n"), NW = byUser(nightsGo, "w");
  const people = users.map((u) => {
    const g = (M) => M.get(u.id) || 0;
    const s = {
      gamer: g(P) / HOUR,
      social: g(Po) * 3 + g(C) + g(Ch) * 0.2 + g(L) * 0.5,
      organizer: g(LM) * 3 + g(NH) * 5 + g(E) * 4,
      music: g(Mu) / 10,
      cine: g(R) * 3 + g(NW) * 5 + g(W),
      comp: g(T) * 5 + g(Wi) * 10,
      steady: g(D) + g(G) * 2 + g(Q) * 2 + g(Gu),
      squad: g(NG) * 5 + g(LJ) * 3,
    };
    const activity = s.gamer * 0.5 + s.social + s.organizer + s.cine + s.comp + s.steady * 0.5 + s.squad;
    return { ...u, play: g(P), scores: s, activity: Math.round(activity) };
  }).filter((p) => p.activity > 0 || p.play > 0);
  return people;
}

// The whole group's year (cached for 2 hours; a finished year is cached for good).
export async function groupYear(env, Y) {
  const key = `wrapped:${Y}:group`;
  const c = await one(env, "SELECT value, updated_at FROM kv_cache WHERE key = ?", key);
  if (c && (Y < currentYear() || Date.now() - c.updated_at < 2 * 3600000)) return JSON.parse(c.value);
  const { from, to } = bounds(Y), ym = `${Y}-%`;
  const people = await everyone(env, Y);
  const max = {};
  for (const p of people) for (const [k, v] of Object.entries(p.scores)) max[k] = Math.max(max[k] || 0, v);
  const [games, artists, nights, movies, quote, deaths, posts, chat] = await Promise.all([
    all(env, "SELECT game, SUM(seconds) AS s, COUNT(DISTINCT user_id) AS people FROM play_log WHERE month LIKE ? GROUP BY game ORDER BY s DESC LIMIT 5", ym),
    all(env, "SELECT artist, COUNT(*) AS plays, COUNT(DISTINCT user_id) AS people FROM listen_log WHERE kind = 'music' AND artist IS NOT NULL AND created_at BETWEEN ? AND ? GROUP BY artist ORDER BY plays DESC LIMIT 5", from, to),
    one(env, "SELECT SUM(kind != 'watch') AS games, SUM(kind = 'watch') AS movies FROM game_nights WHERE status = 'done' AND starts_at BETWEEN ? AND ?", from, to),
    num(env, "SELECT COUNT(*) AS n FROM watch_items WHERE watched_at BETWEEN ? AND ?", from, to),
    one(env, `SELECT q.body, u.username, COUNT(v.user_id) AS votes FROM quotes q LEFT JOIN users u ON u.id = q.author_id LEFT JOIN quote_votes v ON v.quote_id = q.id
               WHERE q.said_at BETWEEN ? AND ? GROUP BY q.id ORDER BY votes DESC, q.said_at DESC LIMIT 1`, from, to),
    all(env, "SELECT name, COUNT(*) AS n FROM mc_deaths WHERE created_at BETWEEN ? AND ? GROUP BY name ORDER BY n DESC LIMIT 3", from, to),
    num(env, "SELECT COUNT(*) AS n FROM social_posts WHERE deleted = 0 AND created_at BETWEEN ? AND ?", from, to),
    num(env, "SELECT COUNT(*) AS n FROM chat_messages WHERE deleted = 0 AND created_at BETWEEN ? AND ?", from, to),
  ]);
  const ranked = [...people].sort((a, b) => b.activity - a.activity);
  const g = {
    year: Y, members: people.length,
    hours: Math.round(people.reduce((s, p) => s + p.play, 0) / HOUR),
    games: games.map((x) => ({ game: x.game, hours: Math.round(x.s / HOUR), people: x.people })),
    artists, nights: nights?.games || 0, movieNights: nights?.movies || 0, movies, posts, chat, quote, deaths,
    mvp: ranked.slice(0, 3).map((p) => ({ id: p.id, username: p.username, avatar: p.avatar })),
    max, ranked: ranked.map((p) => ({ id: p.id, activity: p.activity, play: p.play, scores: p.scores })),
  };
  await env.DB.prepare("INSERT OR REPLACE INTO kv_cache (key, value, updated_at) VALUES (?, ?, ?)").bind(key, JSON.stringify(g), Date.now()).run();
  return g;
}

// Who you did the most with: same LFG, same night, same team, same plan, and comments on each other's posts.
async function compaOf(env, uid, from, to) {
  const parts = await Promise.all([
    `SELECT m2.user_id AS o, COUNT(*) AS n FROM lfg_members m1 JOIN lfg_members m2 ON m2.post_id = m1.post_id AND m2.user_id != m1.user_id WHERE m1.user_id = ?1 AND m1.joined_at BETWEEN ?2 AND ?3 GROUP BY o`,
    `SELECT r2.user_id AS o, COUNT(*) AS n FROM game_night_rsvp r1 JOIN game_night_rsvp r2 ON r2.night_id = r1.night_id AND r2.user_id != r1.user_id JOIN game_nights n ON n.id = r1.night_id
       WHERE r1.user_id = ?1 AND r1.status = 'yes' AND r2.status = 'yes' AND n.starts_at BETWEEN ?2 AND ?3 GROUP BY o`,
    `SELECT m2.user_id AS o, COUNT(*) AS n FROM tournament_members m1 JOIN tournament_members m2 ON m2.team_id = m1.team_id AND m2.user_id != m1.user_id JOIN tournaments t ON t.id = m1.tournament_id
       WHERE m1.user_id = ?1 AND t.starts_at BETWEEN ?2 AND ?3 GROUP BY o`,
    `SELECT r2.user_id AS o, COUNT(*) AS n FROM event_rsvp r1 JOIN event_rsvp r2 ON r2.event_id = r1.event_id AND r2.user_id != r1.user_id JOIN events e ON e.id = r1.event_id
       WHERE r1.user_id = ?1 AND r1.status = 'yes' AND r2.status = 'yes' AND e.starts_at BETWEEN ?2 AND ?3 GROUP BY o`,
    `SELECT c.user_id AS o, COUNT(*) AS n FROM social_comments c JOIN social_posts p ON p.id = c.post_id WHERE p.user_id = ?1 AND c.user_id != ?1 AND c.created_at BETWEEN ?2 AND ?3 GROUP BY o`,
    `SELECT p.user_id AS o, COUNT(*) AS n FROM social_comments c JOIN social_posts p ON p.id = c.post_id WHERE c.user_id = ?1 AND p.user_id != ?1 AND c.created_at BETWEEN ?2 AND ?3 GROUP BY o`,
  ].map((sql) => all(env, sql, uid, from, to)));
  const tally = new Map();
  for (const rows of parts) for (const r of rows) if (r.o) tally.set(r.o, (tally.get(r.o) || 0) + r.n);
  const best = [...tally].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const u = await one(env, "SELECT id, username, avatar FROM users WHERE id = ?", best[0]);
  return u ? { ...u, n: best[1] } : null;
}

const PERSONAS = ["gamer", "social", "organizer", "music", "cine", "comp", "steady", "squad"];

// One person's year.
export async function personYear(env, uid, Y) {
  const { from, to } = bounds(Y), y = String(Y), ym = `${y}-%`;
  const u = await one(env, "SELECT id, username, avatar, mc_uuid, created_at FROM users WHERE id = ?", uid);
  if (!u) return null;
  const group = await groupYear(env, Y);
  const [days, games, hours, duo, deaths, mcMin, nights, hosted, lfg, joined, tourn, wins, compa, music, topSong, artistsN, ratings, best, jelly,
    posts, comments, likes, chat, quoted, quote, daily, guess, qotd, goals, ach, dares] = await Promise.all([
    num(env, "SELECT COUNT(DISTINCT (created_at - 28800000) / 86400000) AS n FROM page_views WHERE user_id = ? AND created_at BETWEEN ? AND ?", uid, from, to),
    all(env, "SELECT game, SUM(seconds) AS s FROM play_log WHERE user_id = ? AND month LIKE ? GROUP BY game ORDER BY s DESC LIMIT 5", uid, ym),
    all(env, "SELECT hour, seconds FROM play_hours WHERE user_id = ? AND year = ?", uid, y),
    one(env, `SELECT u.id, u.username, u.avatar, p.seconds FROM play_pairs p JOIN users u ON u.id = CASE WHEN p.a = ? THEN p.b ELSE p.a END
               WHERE p.year = ? AND (p.a = ? OR p.b = ?) ORDER BY p.seconds DESC LIMIT 1`, uid, y, uid, uid),
    u.mc_uuid ? num(env, "SELECT COUNT(*) AS n FROM mc_deaths WHERE mc_uuid = ? AND created_at BETWEEN ? AND ?", u.mc_uuid, from, to) : 0,
    u.mc_uuid ? num(env, "SELECT SUM(play_minutes) AS n FROM mc_stats WHERE uuid = ?", u.mc_uuid) : 0,
    one(env, "SELECT SUM(n.kind != 'watch') AS games, SUM(n.kind = 'watch') AS movies FROM game_night_rsvp r JOIN game_nights n ON n.id = r.night_id WHERE r.user_id = ? AND r.attended = 1 AND n.starts_at BETWEEN ? AND ?", uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM game_nights WHERE user_id = ? AND created_at BETWEEN ? AND ?", uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM lfg_posts WHERE user_id = ? AND created_at BETWEEN ? AND ?", uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM lfg_members m JOIN lfg_posts p ON p.id = m.post_id WHERE m.user_id = ? AND p.user_id != ? AND m.joined_at BETWEEN ? AND ?", uid, uid, from, to),
    num(env, "SELECT COUNT(DISTINCT m.tournament_id) AS n FROM tournament_members m JOIN tournaments t ON t.id = m.tournament_id WHERE m.user_id = ? AND t.starts_at BETWEEN ? AND ?", uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM tournament_prizes p JOIN tournaments t ON t.id = p.tournament_id WHERE p.user_id = ? AND p.place = 1 AND t.starts_at BETWEEN ? AND ?", uid, from, to),
    compaOf(env, uid, from, to),
    all(env, "SELECT artist, COUNT(*) AS n FROM listen_log WHERE user_id = ? AND kind = 'music' AND artist IS NOT NULL AND created_at BETWEEN ? AND ? GROUP BY artist ORDER BY n DESC LIMIT 5", uid, from, to),
    one(env, "SELECT title, artist, COUNT(*) AS n FROM listen_log WHERE user_id = ? AND kind = 'music' AND created_at BETWEEN ? AND ? GROUP BY title, artist ORDER BY n DESC LIMIT 1", uid, from, to),
    num(env, "SELECT COUNT(DISTINCT artist) AS n FROM listen_log WHERE user_id = ? AND kind = 'music' AND created_at BETWEEN ? AND ?", uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM watch_ratings WHERE user_id = ? AND created_at BETWEEN ? AND ?", uid, from, to),
    one(env, "SELECT w.title, w.poster, r.stars FROM watch_ratings r JOIN watch_items w ON w.id = r.item_id WHERE r.user_id = ? AND r.created_at BETWEEN ? AND ? ORDER BY r.stars DESC, r.created_at DESC LIMIT 1", uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM listen_log WHERE user_id = ? AND kind = 'watch' AND created_at BETWEEN ? AND ?", uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM social_posts WHERE user_id = ? AND deleted = 0 AND created_at BETWEEN ? AND ?", uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM social_comments WHERE user_id = ? AND created_at BETWEEN ? AND ?", uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM social_likes l JOIN social_posts p ON p.id = l.post_id WHERE p.user_id = ? AND l.user_id != ? AND l.created_at BETWEEN ? AND ?", uid, uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND deleted = 0 AND created_at BETWEEN ? AND ?", uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM quotes WHERE author_id = ? AND said_at BETWEEN ? AND ?", uid, from, to),
    one(env, `SELECT q.body, COUNT(v.user_id) AS votes FROM quotes q LEFT JOIN quote_votes v ON v.quote_id = q.id WHERE q.author_id = ? AND q.said_at BETWEEN ? AND ?
               GROUP BY q.id ORDER BY votes DESC, q.said_at DESC LIMIT 1`, uid, from, to),
    one(env, "SELECT COUNT(*) AS n, MAX(streak) AS best FROM daily_claims WHERE user_id = ? AND day LIKE ?", uid, ym),
    num(env, "SELECT SUM(solved) AS n FROM guess_plays WHERE user_id = ? AND day LIKE ?", uid, ym),
    num(env, "SELECT COUNT(*) AS n FROM qotd_answers WHERE user_id = ? AND day LIKE ?", uid, ym),
    num(env, "SELECT COUNT(*) AS n FROM goal_checks c JOIN goals g ON g.id = c.goal_id WHERE g.user_id = ? AND c.day LIKE ?", uid, ym),
    num(env, "SELECT COUNT(*) AS n FROM achievements WHERE user_id = ? AND unlocked_at BETWEEN ? AND ?", uid, from, to),
    num(env, "SELECT COUNT(*) AS n FROM dares WHERE user_id = ? AND status = 'done' AND created_at BETWEEN ? AND ?", uid, from, to),
  ]);
  const playSec = games.reduce((s, g) => s + g.s, 0);
  const hourArr = Array(24).fill(0);
  for (const h of hours) hourArr[h.hour] = Math.round(h.seconds / 60);
  const favHour = hourArr.some(Boolean) ? hourArr.indexOf(Math.max(...hourArr)) : null;
  const me = group.ranked.find((p) => p.id === uid);
  // Your "type": the category where you stand out most compared with the group's best.
  let persona = "rookie";
  if (me) {
    const rel = PERSONAS.map((k) => [k, group.max[k] ? me.scores[k] / group.max[k] : 0]).sort((a, b) => b[1] - a[1]);
    if (rel[0][1] > 0.15) persona = rel[0][0];
  }
  const rankBy = (k) => { const l = [...group.ranked].sort((a, b) => b[k] - a[k]); const i = l.findIndex((p) => p.id === uid); return i < 0 ? null : { pos: i + 1, of: l.length }; };
  const topArtist = music[0] || null;
  const sameArtist = topArtist ? await num(env, "SELECT COUNT(DISTINCT user_id) AS n FROM listen_log WHERE kind = 'music' AND artist = ? AND user_id != ? AND created_at BETWEEN ? AND ?", topArtist.artist, uid, from, to) : 0;
  return {
    year: Y, user: { id: u.id, username: u.username, avatar: u.avatar }, days,
    play: { hours: Math.round(playSec / HOUR), games: games.map((g) => ({ game: g.game, hours: Math.round((g.s / HOUR) * 10) / 10 })), byHour: hourArr, favHour, rank: playSec ? rankBy("play") : null,
      duo: duo && duo.seconds >= 1800 ? { id: duo.id, username: duo.username, avatar: duo.avatar, hours: Math.round((duo.seconds / HOUR) * 10) / 10 } : null },
    ocaso: { deaths, mcHours: Math.round((mcMin || 0) / 60) },
    squad: { nights: nights?.games || 0, hosted, lfg, joined, tourn, wins, compa: compa && compa.n >= 2 ? compa : null },
    music: { plays: music.reduce((s, a) => s + a.n, 0), artists: music, artistsN, topSong, sameArtist },
    movies: { nights: nights?.movies || 0, ratings, best, jelly },
    social: { posts, comments, likes, chat, quoted, quote: quote?.body ? quote : null },
    habits: { daily: daily?.n || 0, streak: daily?.best || 0, guess, qotd, goals, ach, dares },
    persona, activityRank: rankBy("activity"),
  };
}

// Tick: on Dec 1 tell everyone their Wrapped is ready (once per year).
export async function announceWrapped(env) {
  const Y = currentYear();
  if (!isOpen(Y)) return "not yet";
  const key = `wrapped:${Y}:announced`;
  const r = await env.DB.prepare("INSERT OR IGNORE INTO kv_cache (key, value, updated_at) VALUES (?, '1', ?)").bind(key, Date.now()).run();
  if (!r.meta.changes) return "done";
  await notify(env, await allMembers(env), "announce", { title: `🎁 Tu Moikas Wrapped ${Y} ya está aquí`, body: "Tus juegos, tu música, tu dúo del año y más.", url: "/wrapped" });
  if (env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL)
    await discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, { allowed_mentions: { parse: [] },
      content: `🎁 **Moikas Wrapped ${Y}** ya salió: horas jugadas, tu dúo del año, tu artista más escuchado y quién fue el MVP del grupo. ${site(env)}/wrapped` });
  return "sent";
}
