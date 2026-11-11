-- Notifications (the bell) + per-person settings, including Discord DMs. Run in the D1 console before pushing.
CREATE TABLE IF NOT EXISTS notifications ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, url TEXT, created_at INTEGER NOT NULL, read_at INTEGER );
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at);
CREATE TABLE IF NOT EXISTS notif_prefs ( user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL );
