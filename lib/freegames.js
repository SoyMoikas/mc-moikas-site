// Free games of the week: Epic's weekly giveaways + free-to-keep games on Steam/GOG (via GamerPower).
import { now } from "./util.js";
import { discord } from "./lfg.js";

const CACHE_MS = 3 * 3600000;

async function epic() {
  const r = await fetch("https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=es-MX&country=US&allowCountries=US");
  const d = await r.json();
  const out = [];
  for (const e of d?.data?.Catalog?.searchStore?.elements || []) {
    const cur = e.promotions?.promotionalOffers?.[0]?.promotionalOffers || [];
    const next = e.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers || [];
    const free = (o) => o.discountSetting?.discountPercentage === 0;
    const offer = cur.find(free) || next.find(free);
    if (!offer) continue;
    const slug = e.catalogNs?.mappings?.[0]?.pageSlug || e.offerMappings?.[0]?.pageSlug || e.productSlug;
    const img = (e.keyImages || []).find((k) => k.type === "OfferImageWide") || (e.keyImages || []).find((k) => k.type === "Thumbnail") || e.keyImages?.[0];
    out.push({
      id: `epic:${e.id}`, store: "Epic", title: e.title, img: img?.url || null,
      url: slug ? `https://store.epicgames.com/es-MX/p/${slug}` : "https://store.epicgames.com/es-MX/free-games",
      starts: Date.parse(offer.startDate), ends: Date.parse(offer.endDate), upcoming: !cur.includes(offer),
      worth: /[1-9]/.test(e.price?.totalPrice?.fmtPrice?.originalPrice || "") ? e.price.totalPrice.fmtPrice.originalPrice : null,
    });
  }
  return out;
}

async function gamerpower() {
  const r = await fetch("https://www.gamerpower.com/api/giveaways?platform=steam.gog&type=game&sort-by=date");
  if (!r.ok) return [];
  const d = await r.json();
  return (Array.isArray(d) ? d : []).slice(0, 8).map((g) => ({
    id: `gp:${g.id}`, store: /gog/i.test(g.platforms) ? "GOG" : "Steam", title: String(g.title).replace(/\s*\((Steam|GOG)\)\s*Giveaway$/i, "").replace(/ Giveaway$/i, ""),
    img: g.image || g.thumbnail, url: g.open_giveaway_url || g.gamerpower_url,
    starts: g.published_date ? Date.parse(g.published_date.replace(" ", "T") + "Z") : null,
    ends: g.end_date && g.end_date !== "N/A" ? Date.parse(g.end_date.replace(" ", "T") + "Z") : null,
    upcoming: false, worth: g.worth && g.worth !== "N/A" ? g.worth : null,
  }));
}

export async function freeGames(env, { force = false } = {}) {
  const c = await env.DB.prepare("SELECT value, updated_at FROM kv_cache WHERE key = 'free_games'").first();
  if (c && !force && c.updated_at > now() - CACHE_MS) return JSON.parse(c.value);
  const [a, b] = await Promise.allSettled([epic(), gamerpower()]);
  const list = [...(a.status === "fulfilled" ? a.value : []), ...(b.status === "fulfilled" ? b.value : [])]
    .filter((g) => !g.ends || g.ends > now());
  if (!list.length && c) return JSON.parse(c.value); // both failed: keep the old list
  await env.DB.prepare("INSERT OR REPLACE INTO kv_cache (key, value, updated_at) VALUES ('free_games', ?, ?)").bind(JSON.stringify(list), now()).run();
  return list;
}

// Post games that just became free to Discord, once each.
export async function announceFreeGames(env) {
  const ch = env.DISCORD_FREE_CHANNEL || env.DISCORD_LFG_CHANNEL;
  if (!env.DISCORD_BOT_TOKEN || !ch) return;
  const list = (await freeGames(env)).filter((g) => !g.upcoming);
  const seenRow = await env.DB.prepare("SELECT value FROM kv_cache WHERE key = 'free_announced'").first();
  const seen = new Set(seenRow ? JSON.parse(seenRow.value) : []);
  const fresh = list.filter((g) => !seen.has(g.id));
  if (!seenRow) { // first run: don't flood the channel with everything already free
    await env.DB.prepare("INSERT OR REPLACE INTO kv_cache (key, value, updated_at) VALUES ('free_announced', ?, ?)").bind(JSON.stringify(list.map((g) => g.id)), now()).run();
    return;
  }
  if (!fresh.length) return;
  await discord(env, "POST", `/channels/${ch}/messages`, {
    content: "🎁 **¡Juego gratis!** Reclámalo antes de que se acabe:",
    embeds: fresh.slice(0, 5).map((g) => ({
      title: g.title, url: g.url, color: g.store === "Epic" ? 0x2a2a2a : g.store === "GOG" ? 0x86328a : 0x1b2838,
      description: `**${g.store}**${g.worth ? ` · antes ${g.worth}` : ""}${g.ends ? ` · hasta <t:${Math.floor(g.ends / 1000)}:R>` : ""}`,
      image: g.img ? { url: g.img } : undefined,
    })),
    allowed_mentions: { parse: [] },
  });
  const keep = [...seen, ...fresh.map((g) => g.id)].slice(-200);
  await env.DB.prepare("INSERT OR REPLACE INTO kv_cache (key, value, updated_at) VALUES ('free_announced', ?, ?)").bind(JSON.stringify(keep), now()).run();
}
