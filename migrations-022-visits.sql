-- Site visit log for the admin "Activity" tab. Run in the D1 console before pushing.
CREATE TABLE IF NOT EXISTS page_views ( id INTEGER PRIMARY KEY AUTOINCREMENT, visitor TEXT NOT NULL, user_id INTEGER, path TEXT NOT NULL, ref TEXT, country TEXT, device TEXT, created_at INTEGER NOT NULL );
CREATE INDEX IF NOT EXISTS idx_page_views_time ON page_views (created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_visitor ON page_views (visitor, path, created_at);
