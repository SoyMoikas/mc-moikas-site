-- Start-server button: members can wake a stopped server you allow it on. Run in the D1 console before pushing.
ALTER TABLE servers ADD COLUMN allow_start INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS server_starts ( id INTEGER PRIMARY KEY AUTOINCREMENT, ptero_uuid TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, done_at INTEGER, result TEXT );
CREATE INDEX IF NOT EXISTS idx_server_starts_pending ON server_starts (done_at, ptero_uuid);
