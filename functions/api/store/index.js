import { json } from "../../../lib/util.js";
import { getUser } from "../../../lib/auth.js";
import { CATALOG, coinsOf, levelOf, owns, ownedSet } from "../../../lib/catalog.js";

// Catalog + (if logged in) what you own, have equipped, and your coin balance.
export async function onRequestGet({ request, env }) {
  const user = await getUser(env, request);
  if (!user) return json({ items: CATALOG, user: null });
  const bought = await ownedSet(env, user.id);
  return json({
    items: CATALOG,
    user: {
      coins: coinsOf(user),
      xp: user.xp || 0,
      level: levelOf(user.xp),
      owned: CATALOG.filter((i) => owns(i, bought, user.xp)).map((i) => i.id),
      equipped: { frame: user.eq_frame, hat: user.eq_hat, color: user.eq_color },
    },
  });
}
