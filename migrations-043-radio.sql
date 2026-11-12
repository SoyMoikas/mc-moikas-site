-- 043: radio — everyone's YouTube playlists, the songs in them, and who's tuned in. Paste as one line in the D1 console.
CREATE TABLE IF NOT EXISTS radio_playlists ( user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, list_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT, tracks INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, list_id) );
CREATE TABLE IF NOT EXISTS radio_tracks ( user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, vid TEXT NOT NULL, list_id TEXT, title TEXT, author TEXT, dur INTEGER, bad INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, vid) );
CREATE TABLE IF NOT EXISTS radio_listeners ( user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, seen_at INTEGER NOT NULL );
