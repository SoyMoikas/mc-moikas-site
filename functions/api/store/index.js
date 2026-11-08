import { json } from "../../../lib/util.js";
import { getUser, hasRole } from "../../../lib/auth.js";
import { recomputeXP } from "../../../lib/xp.js";
import { loadItems, coinsOf, levelOf, owns, ownedSet, getSettings, rewardForLevel } from "../../../lib/catalog.js";

// Store: items, coin rules, and (if logged in) your balance, what you own and have equipped.
export async function onRequestGet({ request, env }) {
  let user = await getUser(env, request);
  if (user) { await recomputeXP(env, user.id); user = await getUser(env, request); } // fresh coin balance
  const admin = hasRole(user, "admin");
  const [items, settings] = await Promise.all([loadItems(env, { includeInactive: admin }), getSettings(env)]);
  const out = { items, settings, user: null };
  if (user) {
    const bought = await ownedSet(env, user.id);
    const level = levelOf(user.xp);
    out.user = {
      coins: coinsOf(user), xp: user.xp || 0, level,
      next_level_coins: rewardForLevel(level + 1, settings),
      owned: items.filter((i) => owns(i, bought, user.xp)).map((i) => i.id),
      equipped: { frame: user.eq_frame, hat: user.eq_hat, color: user.eq_color },
    };
  }
  return json(out);
}
