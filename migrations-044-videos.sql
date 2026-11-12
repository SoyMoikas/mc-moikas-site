-- 044: video posts — a video on a feed post (an embed like "yt:ID" or an upload "/api/videos/<id>.mp4") + uploaded clips (files live in R2). Paste as one line; run once.
ALTER TABLE social_posts ADD COLUMN video TEXT;
CREATE TABLE IF NOT EXISTS videos ( id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, r2_key TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL );
