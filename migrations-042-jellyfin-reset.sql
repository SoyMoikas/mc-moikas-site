-- 042: "forgot my Jellyfin password" — the bot sets a temporary password and the site DMs it. Paste as one line in the D1 console; run once.
ALTER TABLE users ADD COLUMN jellyfin_verified INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS jf_resets ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, jf_name TEXT NOT NULL, status TEXT NOT NULL, temp TEXT, detail TEXT, decided_by INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL );
