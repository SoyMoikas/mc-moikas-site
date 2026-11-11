-- Jellyfin library + Seerr requests, phone push notifications, NAS status page. Run once.
-- What's on your Jellyfin (sent by the NAS bot every ~10 min).
CREATE TABLE IF NOT EXISTS jellyfin_library ( jf_id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, norm TEXT NOT NULL, year INTEGER, tmdb TEXT,
  added_at INTEGER, seen_at INTEGER NOT NULL );
CREATE INDEX IF NOT EXISTS jellyfin_library_norm ON jellyfin_library (norm);
CREATE INDEX IF NOT EXISTS jellyfin_library_added ON jellyfin_library (added_at);
-- "Pedir" on the watchlist → the bot sends it to Seerr.  status: queued → requested → available (or exists / failed)
CREATE TABLE IF NOT EXISTS media_requests ( id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL UNIQUE REFERENCES watch_items(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'queued', detail TEXT, tmdb TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL );
-- Phone/desktop push subscriptions (one per device).
CREATE TABLE IF NOT EXISTS push_subs ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE,
  label TEXT, created_at INTEGER NOT NULL, last_ok INTEGER );
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);
-- NAS status: latest result per service + hourly uptime counts.
CREATE TABLE IF NOT EXISTS status_checks ( name TEXT PRIMARY KEY, ok INTEGER NOT NULL, ms INTEGER, detail TEXT, fails INTEGER NOT NULL DEFAULT 0,
  alerted INTEGER NOT NULL DEFAULT 0, checked_at INTEGER NOT NULL, changed_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS status_hours ( name TEXT NOT NULL, hour INTEGER NOT NULL, ok INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (name, hour) );
