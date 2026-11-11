-- Limpieza for finished series (via Sonarr). Run once. No comments below this line.
ALTER TABLE media_usage ADD COLUMN ended INTEGER;
ALTER TABLE media_usage ADD COLUMN tvdb TEXT;
ALTER TABLE cleanup_items ADD COLUMN type TEXT NOT NULL DEFAULT 'Movie';
ALTER TABLE cleanup_items ADD COLUMN tvdb TEXT;
