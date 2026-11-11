import { getUser, need, hasRole } from "../../../lib/auth.js";
import { json, body, str, int, now, err } from "../../../lib/util.js";
import { notify, allMembers } from "../../../lib/notify.js";
import { discord, site } from "../../../lib/lfg.js";

// Secret Santa ("Intercambio"). Wishlists are public; who-gives-to-whom is secret until the reveal date.
// Each person sees only their own giftee (and that person's private notes, e.g. sizes or where to send it).
async function current(env) {
  const ex = await env.DB.prepare("SELECT * FROM exchanges WHERE status != 'cancelled' ORDER BY id DESC LIMIT 1").first();
  if (ex && ex.status === "drawn" && ex.reveal_at <= now()) {
    await env.DB.prepare("UPDATE exchanges SET status = 'revealed' WHERE id = ?").bind(ex.id).run();
    ex.status = "revealed";
  }
  return ex;
}

export async function onRequestGet({ env, request }) {
  const me = await getUser(env, request);
  if (!me || me.role === "pending") return json({ exchange: null });
  const ex = await current(env);
  if (!ex) return json({ exchange: null, staff: hasRole(me, "staff") });
  const members = (await env.DB.prepare(
    `SELECT m.user_id, m.wishlist, m.notes, m.giftee_id, m.sent, m.received, u.username, u.avatar FROM exchange_members m JOIN users u ON u.id = m.user_id WHERE m.exchange_id = ?`
  ).bind(ex.id).all()).results;
  const mine = members.find((m) => m.user_id === me.id) || null;
  const giftee = mine?.giftee_id ? members.find((m) => m.user_id === mine.giftee_id) : null;
  const revealed = ex.status === "revealed";
  return json({
    staff: hasRole(me, "staff"),
    exchange: { ...ex, count: members.length },
    members: members.map((m) => ({ id: m.user_id, username: m.username, avatar: m.avatar, wishlist: m.wishlist, sent: !!m.sent, received: !!m.received,
      santa: revealed ? members.find((x) => x.giftee_id === m.user_id)?.username || null : undefined })),
    me: mine ? { wishlist: mine.wishlist, notes: mine.notes, sent: !!mine.sent, received: !!mine.received } : null,
    giftee: giftee ? { id: giftee.user_id, username: giftee.username, avatar: giftee.avatar, wishlist: giftee.wishlist, notes: giftee.notes, received: !!giftee.received } : null,
  });
}

// POST {action: "create", title, budget, signup_until, reveal_at} (staff)
//      {action: "join"|"update", wishlist, notes} · {action: "leave"} · {action: "draw"} (staff) · {action: "sent"|"received"} · {action: "cancel"} (staff)
export async function onRequestPost({ env, request, waitUntil }) {
  const me = await need(env, request, "member");
  if (me instanceof Response) return me;
  const b = await body(request);
  if (b instanceof Response) return b;
  const t = now(), staff = hasRole(me, "staff");
  const post = (content) => env.DISCORD_BOT_TOKEN && env.DISCORD_LFG_CHANNEL
    ? discord(env, "POST", `/channels/${env.DISCORD_LFG_CHANNEL}/messages`, { content, allowed_mentions: { parse: [] } }) : null;
  if (b.action === "create") {
    if (!staff) return err(403, "Staff only");
    const ex0 = await current(env);
    if (ex0 && ex0.status !== "revealed") return err(409, "There's already an exchange going");
    const title = str(b.title, 80, "title") || "Intercambio navideño";
    const su = int(b.signup_until, "signup_until", { min: t, max: t + 120 * 86400000 }), ra = int(b.reveal_at, "reveal_at", { min: su, max: t + 200 * 86400000 });
    await env.DB.prepare("INSERT INTO exchanges (title, budget, signup_until, reveal_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(title, b.budget ? str(b.budget, 60, "budget") : null, su, ra, me.id, t).run();
    waitUntil((async () => {
      await notify(env, await allMembers(env), "announce", { title: `🎁 ${title}: ¡inscríbete!`, body: `${b.budget ? `Presupuesto: ${b.budget} · ` : ""}inscripciones hasta {t:${su}}`, url: "/juntos#intercambio" });
      await post(`🎁 **${title}** — ¡ya pueden inscribirse! ${b.budget ? `Presupuesto: ${b.budget}. ` : ""}Inscripciones hasta <t:${Math.floor(su / 1000)}:F>. ${site(env)}/juntos#intercambio`);
    })());
    return json({ ok: true });
  }
  const ex = await current(env);
  if (!ex) return err(404, "No exchange");
  if (b.action === "join" || b.action === "update") {
    if (ex.status !== "signup" && b.action === "join") return err(409, "Sign-ups are closed");
    const wl = b.wishlist ? str(b.wishlist, 600, "wishlist") : null, notes = b.notes ? str(b.notes, 300, "notes") : null;
    if (b.action === "join") await env.DB.prepare("INSERT OR IGNORE INTO exchange_members (exchange_id, user_id, wishlist, notes) VALUES (?, ?, ?, ?)").bind(ex.id, me.id, wl, notes).run();
    else await env.DB.prepare("UPDATE exchange_members SET wishlist = ?, notes = ? WHERE exchange_id = ? AND user_id = ?").bind(wl, notes, ex.id, me.id).run();
  } else if (b.action === "leave") {
    if (ex.status !== "signup") return err(409, "Names were already drawn — ask staff");
    await env.DB.prepare("DELETE FROM exchange_members WHERE exchange_id = ? AND user_id = ?").bind(ex.id, me.id).run();
  } else if (b.action === "draw") {
    if (!staff) return err(403, "Staff only");
    if (ex.status !== "signup") return err(409, "Already drawn");
    const ids = (await env.DB.prepare("SELECT user_id FROM exchange_members WHERE exchange_id = ?").bind(ex.id).all()).results.map((r) => r.user_id);
    if (ids.length < 3) return err(409, "Needs at least 3 people");
    // shuffle, then everyone gives to the next person in the circle → nobody gets themselves
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    await env.DB.batch(ids.map((id, i) => env.DB.prepare("UPDATE exchange_members SET giftee_id = ? WHERE exchange_id = ? AND user_id = ?").bind(ids[(i + 1) % ids.length], ex.id, id)));
    await env.DB.prepare("UPDATE exchanges SET status = 'drawn' WHERE id = ?").bind(ex.id).run();
    const names = new Map((await env.DB.prepare(`SELECT id, username FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results.map((u) => [u.id, u.username]));
    waitUntil((async () => {
      for (const [i, id] of ids.entries()) // each person gets a private message (DM if they allow it) with their match
        await notify(env, [id], "announce", { title: `🎁 ¡Te tocó ${names.get(ids[(i + 1) % ids.length])}!`, body: "Es secreto 🤫 — mira su lista de deseos en la página.", url: "/juntos#intercambio" });
      await post(`🎁 **${ex.title}**: ¡ya se sortearon los nombres! Revisen en la página a quién le tocó regalar (es secreto 🤫). Revelación: <t:${Math.floor(ex.reveal_at / 1000)}:F>.`);
    })());
  } else if (b.action === "sent" || b.action === "received") {
    if (ex.status === "signup") return err(409, "Names haven't been drawn yet");
    await env.DB.prepare(`UPDATE exchange_members SET ${b.action} = 1 - ${b.action} WHERE exchange_id = ? AND user_id = ?`).bind(ex.id, me.id).run();
  } else if (b.action === "cancel") {
    if (!staff) return err(403, "Staff only");
    await env.DB.prepare("UPDATE exchanges SET status = 'cancelled' WHERE id = ?").bind(ex.id).run();
  } else return err(400, "Bad action");
  return json({ ok: true });
}
