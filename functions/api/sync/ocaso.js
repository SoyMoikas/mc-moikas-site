import { json, err, now } from "../../../lib/util.js";
import { syncAuthorized } from "../../../lib/sync-auth.js";
import { checkBountyDeath } from "../../../lib/bounties.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[.\w]{1,20}$/;
const DIOSES = ["tonatiuh", "tlaloc", "quetzalcoatl", "mictlan", "tezcatlipoca"];
const WORDS = /^[a-z_]{1,20}$/;
const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 10) / 10)) : null);

// Ocaso data from the NAS script (Skript variables + deaths in the log).
// Body: { servers: [{ ptero_uuid, world: {...}, players: {mc_uuid: {...}}, deaths: [{name, uuid, message, at}] }] }
export async function onRequestPost({ request, env }) {
  if (!syncAuthorized(request, env)) return err(401, "Bad sync token");
  const text = await request.text();
  if (text.length > 1024 * 1024) return err(413, "Payload too large");
  let p;
  try { p = JSON.parse(text); } catch { return err(400, "Invalid JSON"); }

  const t = now();
  const stmts = [];
  const deathStmts = new Map(); // statement → {death, ptero, world} so new deaths can settle bounties
  let players = 0;
  for (const s of (p.servers || []).slice(0, 10)) {
    if (typeof s?.ptero_uuid !== "string" || s.ptero_uuid.length > 64) continue;
    const w = s.world || {};
    stmts.push(env.DB.prepare(
      `INSERT INTO ocaso_world (ptero_uuid, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(ptero_uuid) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    ).bind(s.ptero_uuid, JSON.stringify({
      noches: num(w.noches, 0, 1e7) ?? 0, lunasangre: !!w.lunasangre,
      xolotl_vivo: !!w.xolotl_vivo, mictlantecuhtli_vivo: !!w.mictlantecuhtli_vivo, llorona_viva: !!w.llorona_viva,
    }), t));

    for (const [uuid, d] of Object.entries(s.players || {}).slice(0, 2000)) {
      if (!UUID.test(uuid) || !d || typeof d !== "object") continue;
      const fe = {};
      for (const g of DIOSES) { const v = num(d.fe?.[g], -100, 100); if (v !== null) fe[g] = v; }
      const data = {
        sanity: num(d.sanity, 0, 100), fe,
        orden: WORDS.test(d.orden || "") ? d.orden : null,
        clase: WORDS.test(d.clase || "") ? d.clase : null,
        bautizado: !!d.bautizado, llave: !!d.llave, senor: !!d.senor,
        mictlan: num(d.mictlan, 0, 9) ?? 0, lunas: num(d.lunas, 0, 1e6) ?? 0,
      };
      stmts.push(env.DB.prepare(
        `INSERT INTO ocaso_players (ptero_uuid, mc_uuid, name, data, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ptero_uuid, mc_uuid) DO UPDATE SET name = COALESCE(excluded.name, ocaso_players.name), data = excluded.data, updated_at = excluded.updated_at`
      ).bind(s.ptero_uuid, uuid.toLowerCase(), NAME.test(d.name || "") ? d.name : null, JSON.stringify(data), t));
      players++;
    }

    for (const d of (s.deaths || []).slice(-100)) {
      if (!NAME.test(d?.name || "") || typeof d.message !== "string" || !Number.isInteger(d.at)) continue;
      if (d.at > t + 5 * 60000 || d.at < t - 3 * 86400000) continue;
      const st = env.DB.prepare(
        "INSERT OR IGNORE INTO mc_deaths (ptero_uuid, mc_uuid, name, message, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(s.ptero_uuid, UUID.test(d.uuid || "") ? d.uuid.toLowerCase() : null, d.name, d.message.slice(0, 200), d.at);
      stmts.push(st);
      deathStmts.set(st, { death: { mc_uuid: UUID.test(d.uuid || "") ? d.uuid.toLowerCase() : null, name: d.name, message: d.message }, ptero: s.ptero_uuid, world: w });
    }
  }
  let newDeaths = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const chunk = stmts.slice(i, i + 50);
    const res = await env.DB.batch(chunk);
    for (const [j, r] of res.entries()) {
      const info = deathStmts.get(chunk[j]);
      if (!info || !r.meta?.changes) continue;
      newDeaths++;
      try { await checkBountyDeath(env, info.ptero, info.death, info.world); } catch (e) { console.error("bounty", e.message); }
    }
  }
  // keep the death feed small
  if (Math.random() < 0.05) await env.DB.prepare("DELETE FROM mc_deaths WHERE created_at < ?").bind(t - 60 * 86400000).run();
  return json({ ok: true, players, new_deaths: newDeaths });
}
