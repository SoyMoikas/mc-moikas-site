-- Moikas Wrapped (year in review) + "¿Cuándo pueden?" (weekly availability). Run once.
-- Playtime from Discord presence, per game per month (seconds) and per hour of day in each person's time zone.
CREATE TABLE IF NOT EXISTS play_log ( user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, game TEXT NOT NULL, month TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, game, month) );
CREATE TABLE IF NOT EXISTS play_hours ( user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, year TEXT NOT NULL, hour INTEGER NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, year, hour) );
-- Two friends on the same game at the same time (a < b), for "your duo of the year".
CREATE TABLE IF NOT EXISTS play_pairs ( a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, year TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (a, b, year) );
-- Each person's usual free hours: slots = JSON array of 0..167 (Monday 0:00 = 0) in their own time zone.
CREATE TABLE IF NOT EXISTS availability ( user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, tz TEXT NOT NULL, slots TEXT NOT NULL, updated_at INTEGER NOT NULL );
