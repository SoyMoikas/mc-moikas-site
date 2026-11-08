import { json } from "../../../lib/util.js";
import { getUser, hasPerm } from "../../../lib/auth.js";
import { recomputeXP } from "../../../lib/xp.js";
import { loadItems, coinsOf, levelOf, owns, ownedSet, getSettings, rewardForLevel, loadCollections, collectionOpen, bundlePrice } from "../../../lib/catalog.js";

// Store: items, collections, coin rules, and (if logged in) your balance, what you own and have equipped.
export async function onRequestGet({ request, env }) {
  let user = await getUser(env, request);
  if (user) { await recomputeXP(env, user.id); user = await getUser(env, request); } // fresh coin balance
  const admin = hasPerm(user, "store");
  const [allItems, settings, collections] = await Promise.all([
    loadItems(env, { includeInactive: admin }), getSettings(env), loadCollections(env, { includeHidden: admin }),
  ]);
  // Items in a collection that isn't open (not started / ended) are hidden from regular visitors.
  const allCols = admin ? collections : await loadCollections(env, { includeHidden: true });
  const colById = Object.fromEntries(allCols.map((c) => [c.id, c]));
  const items = admin ? allItems : allItems.filter((i) => !i.collection_id || collectionOpen(colById[i.collection_id]));

  const bought = user ? await ownedSet(env, user.id) : new Set();
  const ownedIds = new Set(user ? items.filter((i) => owns(i, bought, user.xp)).map((i) => i.id) : []);
  const out = {
    items, settings, user: null,
    collections: collections.map((c) => {
      const its = items.filter((i) => i.collection_id === c.id && i.active);
      return { ...c, open: collectionOpen(c), item_ids: its.map((i) => i.id),
        owned_count: its.filter((i) => ownedIds.has(i.id)).length,
        your_price: user ? bundlePrice(c, its, ownedIds) : c.price };
    }),
  };
  if (user) {
    const level = levelOf(user.xp);
    out.user = {
      coins: coinsOf(user), xp: user.xp || 0, level,
      next_level_coins: rewardForLevel(level + 1, settings),
      owned: [...ownedIds],
      equipped: { frame: user.eq_frame, hat: user.eq_hat, color: user.eq_color, banner: user.eq_banner, wallpaper: user.eq_wallpaper, font: user.eq_font, textstyle: user.eq_text, theme: user.eq_theme }, hat_fit: user.hat_fit || null, acc_extra: user.acc_extra || null,
    };
  }
  return json(out);
}
