-- 040: custom picker wheels (legends, guns, games, anything) — personal or shared with everyone. Paste as one line in the D1 console.
CREATE TABLE IF NOT EXISTS wheels ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, entries TEXT NOT NULL, shared INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL );
CREATE INDEX IF NOT EXISTS idx_wheels_user ON wheels (user_id);
