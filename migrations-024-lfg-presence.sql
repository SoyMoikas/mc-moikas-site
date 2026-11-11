-- "¿Quién se apunta?" (looking for group) + "Jugando ahora" (Discord presence). Run in the D1 console before pushing.
CREATE TABLE IF NOT EXISTS lfg_posts ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, game TEXT NOT NULL, note TEXT, starts_at INTEGER NOT NULL, slots INTEGER NOT NULL, discord_msg_id TEXT, pinged INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, closed_at INTEGER );
CREATE INDEX IF NOT EXISTS idx_lfg_open ON lfg_posts (closed_at, starts_at);
CREATE TABLE IF NOT EXISTS lfg_members ( post_id INTEGER NOT NULL REFERENCES lfg_posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, joined_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id) );
CREATE TABLE IF NOT EXISTS presence ( user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, game TEXT NOT NULL, kind TEXT, since INTEGER, updated_at INTEGER NOT NULL );
