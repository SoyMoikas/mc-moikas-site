import { getUser, need, hasRole } from "../../../lib/auth.js";
import { json, body, str, int, now, err } from "../../../lib/util.js";
import { loadTournament, publicTournament, startBracket, setMatchWinner, finish, standings, announce } from "../../../lib/tournaments.js";

export async function onRequestGet({ env, request, params }) {
  const me = await getUser(env, request);
  const tr = await loadTournament(env, parseInt(params.id) || 0);
  if (!tr) return err(404, "Not found");
  return json({ tournament: publicTournament(tr, me), staff: hasRole(me, "staff") });
}

// POST /api/tournaments/:id {action, ...}
//  players: signup {team_name} · join_team {team_id} · leave
//  staff:   start · report {match_id, winner, score_a, score_b} · add_game {results: [{team_id, placement, kills}]}
//           undo_game {game_no} · finish · kick {team_id} · delete
export async function onRequestPost({ env, request, params }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const tr = await loadTournament(env, parseInt(params.id) || 0);
  if (!tr) return err(404, "Not found");
  const staff = hasRole(me, "staff");
  const myTeam = tr.teams.find((t) => t.members.some((m) => m.id === me.id));
  const DB = env.DB;
  const a = b.action;

  if (a === "signup" || a === "join_team" || a === "leave") {
    if (tr.status !== "signup") return err(409, "Sign-ups are closed");
    if (a === "leave") {
      if (!myTeam) return err(409, "You're not signed up");
      await DB.prepare("DELETE FROM tournament_members WHERE tournament_id = ? AND user_id = ?").bind(tr.id, me.id).run();
      if (myTeam.members.length <= 1) await DB.prepare("DELETE FROM tournament_teams WHERE id = ?").bind(myTeam.id).run();
      else if (myTeam.captain_id === me.id) {
        const next = myTeam.members.find((m) => m.id !== me.id);
        await DB.prepare("UPDATE tournament_teams SET captain_id = ? WHERE id = ?").bind(next.id, myTeam.id).run();
      }
    } else {
      if (myTeam) return err(409, "You're already on a team");
      if (a === "signup") {
        if (tr.teams.length >= tr.max_teams) return err(409, "The tournament is full");
        const name = tr.team_size === 1 ? me.username : str(b.team_name, 40, "team_name");
        if (!name) return err(400, "Give your team a name");
        if (tr.teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) return err(409, "That team name is taken");
        const r = await DB.prepare("INSERT INTO tournament_teams (tournament_id, name, captain_id, created_at) VALUES (?, ?, ?, ?)").bind(tr.id, name, me.id, now()).run();
        await DB.prepare("INSERT INTO tournament_members (tournament_id, team_id, user_id) VALUES (?, ?, ?)").bind(tr.id, r.meta.last_row_id, me.id).run();
      } else {
        const team = tr.teams.find((t) => t.id === b.team_id);
        if (!team) return err(404, "Team not found");
        if (team.members.length >= tr.team_size) return err(409, "That team is full");
        await DB.prepare("INSERT INTO tournament_members (tournament_id, team_id, user_id) VALUES (?, ?, ?)").bind(tr.id, team.id, me.id).run();
      }
    }
  } else {
    if (!staff) return err(403, "Staff only");
    if (a === "kick") {
      await DB.prepare("DELETE FROM tournament_teams WHERE id = ? AND tournament_id = ?").bind(int(b.team_id, "team_id"), tr.id).run();
    } else if (a === "delete") {
      await DB.prepare("DELETE FROM tournaments WHERE id = ?").bind(tr.id).run();
      return json({ deleted: true });
    } else if (a === "start") {
      if (tr.status !== "signup") return err(409, "Already started");
      if (tr.teams.length < 2) return err(409, "Needs at least 2 teams");
      await DB.prepare("UPDATE tournaments SET status = 'running' WHERE id = ?").bind(tr.id).run();
      if (tr.format === "bracket") await startBracket(env, tr);
      await announce(env, `▶️ **${tr.title}** empezó con ${tr.teams.length} ${tr.team_size === 1 ? "jugadores" : "equipos"}. ¡Suerte!`, tr.id);
    } else if (a === "report") {
      if (tr.format !== "bracket" || tr.status !== "running") return err(409, "Not a running bracket");
      const m = tr.matches.find((x) => x.id === b.match_id);
      if (!m || !m.team_a || !m.team_b) return err(409, "That match isn't ready");
      const next = tr.matches.find((x) => x.round === m.round + 1 && x.slot === Math.floor(m.slot / 2));
      if (next?.winner) return err(409, "The next match already has a result — undo that first");
      if (![m.team_a, m.team_b].includes(b.winner)) return err(400, "Pick one of the two teams");
      const sa = b.score_a === "" || b.score_a == null ? null : int(b.score_a, "score_a", { min: 0, max: 999 });
      const sb = b.score_b === "" || b.score_b == null ? null : int(b.score_b, "score_b", { min: 0, max: 999 });
      await setMatchWinner(env, tr, m, b.winner, sa, sb);
    } else if (a === "add_game" || a === "undo_game") {
      if (tr.format !== "points" || tr.status !== "running") return err(409, "Not a running points tournament");
      if (a === "undo_game") {
        await DB.prepare("DELETE FROM tournament_results WHERE tournament_id = ? AND game_no = ?").bind(tr.id, int(b.game_no, "game_no")).run();
      } else {
        const gameNo = (Math.max(0, ...tr.results.map((r) => r.game_no))) + 1;
        const rows = (Array.isArray(b.results) ? b.results : []).filter((r) => tr.teams.some((t) => t.id === r.team_id) && Number.isInteger(r.placement) && r.placement > 0);
        if (!rows.length) return err(400, "Enter at least one placement");
        await DB.batch(rows.map((r) => DB.prepare("INSERT INTO tournament_results (tournament_id, game_no, team_id, placement, kills) VALUES (?, ?, ?, ?, ?)")
          .bind(tr.id, gameNo, r.team_id, Math.min(99, r.placement), Math.max(0, Math.min(99, parseInt(r.kills) || 0)))));
      }
    } else if (a === "finish") {
      if (tr.format !== "points" || tr.status !== "running") return err(409, "Only points tournaments are finished by hand");
      const st = standings(tr);
      if (!st.length || !st[0].games) return err(409, "No games entered yet");
      await finish(env, tr, [st[0].team_id, st[1]?.team_id]);
    } else return err(400, "Bad action");
  }
  return json({ tournament: publicTournament(await loadTournament(env, tr.id), me), staff });
}
