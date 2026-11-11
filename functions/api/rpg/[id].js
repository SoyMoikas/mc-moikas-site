import { getUser, need, hasRole } from "../../../lib/auth.js";
import { json, body, str, err, now } from "../../../lib/util.js";
import { notify } from "../../../lib/notify.js";
import { award } from "../../../lib/coins.js";
import { buildCharacter, roll, checkExpr, resolveTurn, openScene, aiNarrate, aiResolve, aiAvailable, safeList, levelFor, modOf, CLASSES } from "../../../lib/rpg.js";

const load = (env, id) => env.DB.prepare("SELECT * FROM rpg_campaigns WHERE id = ?").bind(+id || 0).first();

// GET → the campaign, party, the story (scenes + everyone's actions), your character.
export async function onRequestGet({ env, request, params }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return err(401, "Log in first");
  const c = await load(env, params.id);
  if (!c) return err(404, "Campaign not found");
  const dm = await env.DB.prepare("SELECT id, username, avatar FROM users WHERE id = ?").bind(c.dm_id).first();
  const party = (await env.DB.prepare(`SELECT ch.*, u.username, u.avatar FROM rpg_characters ch JOIN users u ON u.id = ch.user_id WHERE ch.campaign_id = ? ORDER BY ch.created_at`).bind(c.id).all()).results
    .map((ch) => ({ ...ch, stats: JSON.parse(ch.stats), inventory: safeList(ch.inventory), level: levelFor(ch.xp, c.rules), mine: ch.user_id === me.id }));
  const scenes = (await env.DB.prepare("SELECT * FROM rpg_scenes WHERE campaign_id = ? ORDER BY num DESC LIMIT 40").bind(c.id).all()).results.reverse();
  const actions = scenes.length ? (await env.DB.prepare(`SELECT * FROM rpg_actions WHERE scene_id IN (${scenes.map(() => "?").join(",")})`).bind(...scenes.map((s) => s.id)).all()).results : [];
  const isDm = c.dm_id === me.id || hasRole(me, "admin");
  return json({
    campaign: { ...c, summary: isDm ? c.summary : null, resolving: !!c.resolving && Date.now() - c.resolving < 600000 }, dm, party, me: party.find((p) => p.mine) || null, is_dm: isDm, ai: aiAvailable(env),
    scenes: scenes.map((s) => ({ ...s, effects: JSON.parse(s.effects || "[]"),
      actions: actions.filter((a) => a.scene_id === s.id).map((a) => ({ ...a, rolls: JSON.parse(a.rolls || "[]") })) })),
  });
}

export async function onRequestPost({ env, request, params, waitUntil }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const c = await load(env, params.id);
  if (!c) return err(404, "Campaign not found");
  const isDm = c.dm_id === me.id || hasRole(me, "admin");
  const mine = await env.DB.prepare("SELECT * FROM rpg_characters WHERE campaign_id = ? AND user_id = ?").bind(c.id, me.id).first();
  const open = await env.DB.prepare("SELECT * FROM rpg_scenes WHERE campaign_id = ? AND status = 'open'").bind(c.id).first();
  const t = now();

  switch (b.action) {
    case "join": {
      if (c.status === "ended") return err(400, "This campaign is over");
      if (mine) return err(400, "You already have a character here");
      if (c.dm_id === me.id && c.dm_mode !== "ai") return err(400, "You're the narrator of this one");
      const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM rpg_characters WHERE campaign_id = ?").bind(c.id).first()).n;
      if (n >= c.max_players) return err(400, "The party is full");
      let ch;
      try { ch = buildCharacter(c.rules, b); } catch (e) { return err(400, e.message); }
      await env.DB.prepare(`INSERT INTO rpg_characters (campaign_id, user_id, name, icon, concept, class, stats, hp, max_hp, ac, inventory, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(c.id, me.id, ch.name, ch.icon, ch.concept, ch.class, JSON.stringify(ch.stats), ch.hp, ch.hp, ch.ac, JSON.stringify(ch.items), t).run();
      if (c.dm_id !== me.id) await notify(env, [c.dm_id], "game", { title: `🧙 ${ch.name} se unió a ${c.title}`, body: `${me.username} creó su personaje.`, url: `/rol?c=${c.id}` });
      return json({ ok: true });
    }

    case "act": { // write / update your action for the open scene; dice are rolled here and can't be re-rolled
      if (!mine) return err(403, "Join the campaign first");
      if (!open) return err(400, "There's no open turn right now");
      if (mine.hp <= 0 && !b.text?.trim()) return err(400, "Your character is down");
      const text = str(b.text, 1500, "action");
      if (!text) return err(400, "What does your character do?");
      const prev = await env.DB.prepare("SELECT * FROM rpg_actions WHERE scene_id = ? AND character_id = ?").bind(open.id, mine.id).first();
      const rolls = prev ? JSON.parse(prev.rolls) : [];
      for (const r of (Array.isArray(b.rolls) ? b.rolls : []).slice(0, 4)) {
        if (rolls.length >= 4) break;
        try {
          const expr = r.stat ? checkExpr(c, mine, r.stat, { prof: !!r.prof, adv: r.adv }) : r.expr;
          rolls.push({ label: str(r.label, 40, "label") || (r.stat ? r.stat : null), ...roll(expr), at: t });
        } catch (e) { return err(400, e.message); }
      }
      await env.DB.prepare(`INSERT INTO rpg_actions (scene_id, character_id, text, rolls, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (scene_id, character_id) DO UPDATE SET text = excluded.text, rolls = excluded.rolls, updated_at = excluded.updated_at`)
        .bind(open.id, mine.id, text, JSON.stringify(rolls), t, t).run();
      // everyone's in → AI campaigns resolve right away (in the background); human DMs get pinged by the tick
      if (c.dm_mode === "ai" && aiAvailable(env)) {
        const pc = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM rpg_characters WHERE campaign_id = ?) AS p, (SELECT COUNT(*) FROM rpg_actions WHERE scene_id = ?) AS a").bind(c.id, open.id).first();
        if (pc.a >= pc.p) waitUntil(aiResolve(env, c).catch((e) => console.error("rpg ai", e.message)));
      }
      return json({ ok: true, rolls });
    }

    case "start": case "resolve": case "draft": case "settings": case "end": case "kick": {
      if (!isDm) return err(403, "Only the narrator can do that");
      if (b.action === "draft") {
        if (!aiAvailable(env)) return err(400, "AI isn't set up (ANTHROPIC_API_KEY)");
        try { return json(await aiNarrate(env, c, open ? "resolve" : "opening")); } catch (e) { return err(502, e.message); }
      }
      if (b.action === "start" || b.action === "resolve") {
        if (b.action === "start" && open) return err(400, "Already started");
        if (b.action === "resolve" && !open) return err(400, "Nothing to resolve — start the campaign first");
        if (b.ai) {
          if (!aiAvailable(env)) return err(400, "AI isn't set up");
          waitUntil(aiResolve(env, c, b.action === "start" ? "opening" : "resolve").catch((e) => console.error("rpg ai", e.message)));
          return json({ ok: true, background: true });
        }
        const narration = str(b.narration, 8000, "narration");
        if (!narration || narration.length < 10) return err(400, "Write what happens");
        if (b.action === "start") await openScene(env, c, narration, "dm");
        else await resolveTurn(env, c, narration, b.effects, "dm");
        return json({ ok: true });
      }
      if (b.action === "settings") {
        const mode = ["human", "assist", "ai"].includes(b.dm_mode) ? b.dm_mode : c.dm_mode;
        if (mode !== "human" && !aiAvailable(env)) return err(400, "AI isn't set up (ANTHROPIC_API_KEY)");
        await env.DB.prepare("UPDATE rpg_campaigns SET dm_mode = ?, turn_hours = ?, title = ?, setting = ?, max_players = ?, updated_at = ? WHERE id = ?")
          .bind(mode, Math.max(2, Math.min(168, +b.turn_hours || c.turn_hours)), str(b.title, 80, "title") || c.title, b.setting === undefined ? c.setting : str(b.setting, 1200, "setting") || null,
            Math.max(1, Math.min(10, +b.max_players || c.max_players)), t, c.id).run();
        return json({ ok: true });
      }
      if (b.action === "kick") {
        await env.DB.prepare("DELETE FROM rpg_characters WHERE id = ? AND campaign_id = ?").bind(+b.character_id || 0, c.id).run();
        return json({ ok: true });
      }
      // end: everyone who played gets coins by how many turns they took part in
      await env.DB.prepare("UPDATE rpg_scenes SET status = 'closed' WHERE campaign_id = ?").bind(c.id).run();
      await env.DB.prepare("UPDATE rpg_campaigns SET status = 'ended', updated_at = ? WHERE id = ?").bind(t, c.id).run();
      const played = (await env.DB.prepare(`SELECT ch.user_id, COUNT(a.id) AS n FROM rpg_characters ch LEFT JOIN rpg_actions a ON a.character_id = ch.id WHERE ch.campaign_id = ? GROUP BY ch.user_id`).bind(c.id).all()).results;
      for (const p of played) if (p.n) await award(env, p.user_id, "rpg", `end:${c.id}`, Math.min(100, 10 + p.n * 5));
      if (c.dm_mode !== "ai") await award(env, c.dm_id, "rpg", `dm:${c.id}`, 50);
      await notify(env, played.map((p) => p.user_id), "game", { title: `🏁 ${c.title} terminó`, body: "¡Gracias por jugar! Te llegaron monedas por participar.", url: `/rol?c=${c.id}` });
      return json({ ok: true });
    }

    case "sheet": { // players edit their own notes; inventory/gold edits by the narrator
      const target = isDm && b.character_id ? await env.DB.prepare("SELECT * FROM rpg_characters WHERE id = ? AND campaign_id = ?").bind(+b.character_id, c.id).first() : mine;
      if (!target) return err(404, "No character");
      const notes = b.notes === undefined ? target.notes : str(b.notes, 1500, "notes");
      let inv = target.inventory, hp = target.hp, gold = target.gold;
      if (isDm) {
        if (Array.isArray(b.inventory)) inv = JSON.stringify(b.inventory.map((x) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 40));
        if (Number.isInteger(b.hp)) hp = Math.max(0, Math.min(target.max_hp, b.hp));
        if (Number.isInteger(b.gold)) gold = Math.max(0, b.gold);
      }
      await env.DB.prepare("UPDATE rpg_characters SET notes = ?, inventory = ?, hp = ?, gold = ? WHERE id = ?").bind(notes, inv, hp, gold, target.id).run();
      return json({ ok: true });
    }

    case "leave": {
      if (!mine) return err(400, "You're not in it");
      await env.DB.prepare("DELETE FROM rpg_characters WHERE id = ?").bind(mine.id).run();
      return json({ ok: true });
    }
  }
  void modOf; void CLASSES;
  return err(400, "Unknown action");
}
