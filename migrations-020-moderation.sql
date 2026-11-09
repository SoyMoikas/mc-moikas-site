-- Whitelist & bans from the website. Run in the D1 console before pushing.
CREATE TABLE IF NOT EXISTS mc_moderation ( id INTEGER PRIMARY KEY AUTOINCREMENT, ptero_uuid TEXT NOT NULL, action TEXT NOT NULL, name TEXT NOT NULL, edition TEXT NOT NULL DEFAULT 'java', reason TEXT, created_by TEXT, created_at INTEGER NOT NULL, done_at INTEGER, result TEXT );
CREATE INDEX IF NOT EXISTS idx_mc_moderation_pending ON mc_moderation (done_at, ptero_uuid);
CREATE TABLE IF NOT EXISTS mc_player_lists ( ptero_uuid TEXT PRIMARY KEY, whitelist TEXT, bans TEXT, whitelist_on INTEGER, updated_at INTEGER NOT NULL );
