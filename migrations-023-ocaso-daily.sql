-- Daily login bonus + Ocaso panel (player cards, Blood Moon, death feed). Run in the D1 console before pushing.
CREATE TABLE IF NOT EXISTS daily_claims ( user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, streak INTEGER NOT NULL, coins INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, day) );
CREATE TABLE IF NOT EXISTS ocaso_players ( ptero_uuid TEXT NOT NULL, mc_uuid TEXT NOT NULL, name TEXT, data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (ptero_uuid, mc_uuid) );
CREATE TABLE IF NOT EXISTS ocaso_world ( ptero_uuid TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS mc_deaths ( id INTEGER PRIMARY KEY AUTOINCREMENT, ptero_uuid TEXT NOT NULL, mc_uuid TEXT, name TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (ptero_uuid, name, created_at) );
CREATE INDEX IF NOT EXISTS idx_mc_deaths_time ON mc_deaths (created_at);
