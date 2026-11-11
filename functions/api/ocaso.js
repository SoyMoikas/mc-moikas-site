import { getUser, hasRole } from "../../lib/auth.js";
import { json } from "../../lib/util.js";

// GET /api/ocaso                 → every Ocaso server: Blood Moon, player cards, latest deaths
//     /api/ocaso?server=<id>     → only that site server
//     /api/ocaso?user=<user id>  → only that person's cards (profile page)
// A player's curse (vampiro, licántropo…) is a secret: only they and staff see it.
export async function onRequestGet({ env, request }) {
  const q = new URL(request.url).searchParams;
  const viewer = await getUser(env, request);
  const staff = hasRole(viewer, "staff");
  const myUuid = viewer ? (await env.DB.prepare("SELECT mc_uuid FROM users WHERE id = ?").bind(viewer.id).first())?.mc_uuid : null;

  let worlds = (await env.DB.prepare(
    `SELECT w.ptero_uuid, w.data, w.updated_at, s.id AS server_id, s.name AS server_name, s.hidden
       FROM ocaso_world w LEFT JOIN servers s ON s.ptero_uuid = w.ptero_uuid`
  ).all()).results.filter((w) => !w.hidden || staff);
  if (q.get("server")) worlds = worlds.filter((w) => w.server_id === q.get("server"));
  if (!worlds.length) return json({ servers: [], players: [], deaths: [] });
  const ids = worlds.map((w) => w.ptero_uuid);
  const inList = ids.map(() => "?").join(",");

  let userFilter = "", userBind = [];
  if (q.get("user")) {
    const u = await env.DB.prepare("SELECT mc_uuid FROM users WHERE id = ?").bind(parseInt(q.get("user")) || 0).first();
    if (!u?.mc_uuid) return json({ servers: worlds.map(pubWorld), players: [], deaths: [] });
    userFilter = " AND o.mc_uuid = ?"; userBind = [u.mc_uuid];
  }

  const [pl, deaths] = await Promise.all([
    env.DB.prepare(
      `SELECT o.ptero_uuid, o.mc_uuid, COALESCE(o.name, m.name) AS name, o.data, o.updated_at,
              u.id AS user_id, u.username, u.avatar
         FROM ocaso_players o
         LEFT JOIN mc_players m ON m.uuid = o.mc_uuid
         LEFT JOIN users u ON u.mc_uuid = o.mc_uuid
        WHERE o.ptero_uuid IN (${inList})${userFilter}
        ORDER BY o.updated_at DESC LIMIT 300`
    ).bind(...ids, ...userBind).all(),
    env.DB.prepare(
      `SELECT d.ptero_uuid, d.name, d.message, d.created_at, u.id AS user_id, u.username
         FROM mc_deaths d LEFT JOIN users u ON u.mc_uuid = d.mc_uuid
        WHERE d.ptero_uuid IN (${inList})${userFilter.replace("o.", "d.")}
        ORDER BY d.created_at DESC LIMIT ${q.get("user") ? 10 : 30}`
    ).bind(...ids, ...userBind).all(),
  ]);

  const players = pl.results.map((r) => {
    const d = JSON.parse(r.data);
    const mine = !!myUuid && myUuid === r.mc_uuid;
    if (!(mine || staff)) delete d.clase;
    return { ...d, ptero_uuid: r.ptero_uuid, mc_uuid: r.mc_uuid, name: r.name, mine,
      user: r.user_id ? { id: r.user_id, username: r.username, avatar: r.avatar } : null, updated_at: r.updated_at };
  }).filter((p) => p.name);

  return json({ servers: worlds.map(pubWorld), players, deaths: deaths.results });
}

function pubWorld(w) {
  const d = JSON.parse(w.data);
  const cada = 8;
  const n = d.noches || 0;
  return { ptero_uuid: w.ptero_uuid, server_id: w.server_id, server_name: w.server_name, updated_at: w.updated_at,
    noches: n, lunasangre: d.lunasangre, faltan: d.lunasangre ? 0 : cada - (n % cada) || cada,
    xolotl_vivo: d.xolotl_vivo, mictlantecuhtli_vivo: d.mictlantecuhtli_vivo, llorona_viva: d.llorona_viva };
}
