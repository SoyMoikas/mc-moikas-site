// Level curve: reaching level L takes 30·L² XP (1 XP = 1 minute played).
// L1 ≈ 30 min, L5 ≈ 12.5 h, L10 ≈ 50 h, L20 ≈ 200 h of play, less with quests.
import { t } from "./i18n.js";

export const XP_FACTOR = 30;

export const RANKS = [
  { min: 0, key: "novice", color: "#9aa0aa" },
  { min: 5, key: "miner", color: "#c9a26b" },
  { min: 10, key: "crafter", color: "#6fcf5a" },
  { min: 15, key: "engineer", color: "#6aa8e0" },
  { min: 20, key: "veteran", color: "#b48ae6" },
  { min: 30, key: "legend", color: "#f2c94c" },
];

export const xpForLevel = (level) => XP_FACTOR * level * level;

export function levelInfo(xp = 0) {
  xp = Math.max(0, Number(xp) || 0);
  const level = Math.floor(Math.sqrt(xp / XP_FACTOR));
  const cur = xpForLevel(level), next = xpForLevel(level + 1);
  const rank = [...RANKS].reverse().find((r) => level >= r.min);
  return {
    xp, level, cur, next,
    into: xp - cur, needed: next - cur,
    pct: Math.min(100, Math.round(((xp - cur) / (next - cur)) * 100)),
    rank: t(`rank.${rank.key}`), rankKey: rank.key, color: rank.color,
  };
}

// Small "Lv 12" chip, colored by rank.
export function levelBadge(xp, { withRank = false } = {}) {
  const l = levelInfo(xp);
  return `<span class="lvl" style="--rank:${l.color}" title="${l.rank} · ${l.xp.toLocaleString()} XP">${t("lvl.short")} ${l.level}${withRank ? ` · ${l.rank}` : ""}</span>`;
}

export const fmtHours = (minutes) => {
  const h = (Number(minutes) || 0) / 60;
  return h >= 10 ? Math.round(h).toLocaleString() : h.toFixed(1);
};
