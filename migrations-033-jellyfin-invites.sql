-- Jellyfin invite links (from Wizarr) that staff paste on the site; members claim one each. Run once.
CREATE TABLE IF NOT EXISTS jellyfin_invites ( id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, multi INTEGER NOT NULL DEFAULT 0,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, claimed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, claimed_at INTEGER );
