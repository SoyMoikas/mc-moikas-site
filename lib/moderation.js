// Shared rules for the whitelist/ban queue. The NAS script re-checks the same rules before typing
// anything into a server console, so a bad value can never become a command.
export const MOD_ACTIONS = ["whitelist_add", "whitelist_remove", "ban", "unban", "whitelist_on", "whitelist_off"];
export const NAMELESS = ["whitelist_on", "whitelist_off"];
export const JAVA_NAME = /^[A-Za-z0-9_]{3,16}$/;
export const BEDROCK_NAME = /^[A-Za-z0-9 _]{1,16}$/;

export function cleanReason(r) {
  return String(r || "").replace(/[\u0000-\u001f\u007f§]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

// Bedrock names in whitelist.json / banned-players.json carry Floodgate's "." prefix.
export function listEntry(e) {
  const raw = String(e?.name || "");
  const bedrock = raw.startsWith(".");
  return { name: bedrock ? raw.slice(1) : raw, edition: bedrock ? "bedrock" : "java", reason: e?.reason ? String(e.reason).slice(0, 120) : null, by: e?.source ? String(e.source).slice(0, 40) : null };
}
