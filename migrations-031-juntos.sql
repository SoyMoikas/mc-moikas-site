-- "Juntos": movie nights, watchlist, music, clubs, personal goals, question of the day, calendar events, Secret Santa.
-- Run in the D1 console before pushing (once — it adds columns).
ALTER TABLE game_nights ADD COLUMN kind TEXT NOT NULL DEFAULT 'game';
ALTER TABLE users ADD COLUMN jellyfin_name TEXT;
ALTER TABLE social_posts ADD COLUMN club TEXT;
CREATE TABLE IF NOT EXISTS watch_items ( id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, year TEXT, poster TEXT, ext TEXT, added_by INTEGER REFERENCES users(id) ON DELETE SET NULL, watched_at INTEGER, created_at INTEGER NOT NULL, UNIQUE (ext) );
CREATE TABLE IF NOT EXISTS watch_wants ( item_id INTEGER NOT NULL REFERENCES watch_items(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (item_id, user_id) );
CREATE TABLE IF NOT EXISTS watch_ratings ( item_id INTEGER NOT NULL REFERENCES watch_items(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, stars INTEGER NOT NULL, comment TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (item_id, user_id) );
CREATE TABLE IF NOT EXISTS listening ( user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, title TEXT, artist TEXT, cover TEXT, url TEXT, kind TEXT NOT NULL DEFAULT 'music', updated_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS listen_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL, artist TEXT, created_at INTEGER NOT NULL );
CREATE INDEX IF NOT EXISTS idx_listen_log_time ON listen_log (created_at);
CREATE TABLE IF NOT EXISTS clubs ( slug TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, description TEXT, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS club_members ( slug TEXT NOT NULL REFERENCES clubs(slug) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, joined_at INTEGER NOT NULL, PRIMARY KEY (slug, user_id) );
CREATE TABLE IF NOT EXISTS goals ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, icon TEXT, per_week INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS goal_checks ( goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE, day TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (goal_id, day) );
CREATE TABLE IF NOT EXISTS goal_cheers ( goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, PRIMARY KEY (goal_id, user_id, day) );
CREATE TABLE IF NOT EXISTS qotd_answers ( day TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, answer TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (day, user_id) );
CREATE TABLE IF NOT EXISTS events ( id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, place TEXT, description TEXT, starts_at INTEGER NOT NULL, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS event_rsvp ( event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, PRIMARY KEY (event_id, user_id) );
CREATE TABLE IF NOT EXISTS exchanges ( id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, budget TEXT, signup_until INTEGER NOT NULL, reveal_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'signup', created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS exchange_members ( exchange_id INTEGER NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, wishlist TEXT, notes TEXT, giftee_id INTEGER, sent INTEGER NOT NULL DEFAULT 0, received INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (exchange_id, user_id) );
INSERT OR IGNORE INTO clubs (slug, name, icon, description, created_at) VALUES
  ('cocina', 'Cocina', '🍳', 'Recetas, lo que comiste hoy y antojos.', 0),
  ('musica', 'Música', '🎵', 'Lo que andas escuchando, conciertos y recomendaciones.', 0),
  ('anime', 'Anime y series', '📺', 'Qué ver, teorías y recomendaciones.', 0),
  ('gym', 'Gym y deporte', '💪', 'Rutinas, progreso y motivación.', 0),
  ('autos', 'Autos', '🚗', 'Proyectos, fotos y dudas de mecánica.', 0),
  ('tech', 'Tecnología', '💻', 'Homelab, PCs, programación y gadgets.', 0);
