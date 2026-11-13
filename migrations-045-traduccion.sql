-- 045: traducción automática de lo que escribe la gente (caché de traducciones y uso diario)
CREATE TABLE IF NOT EXISTS translations (k TEXT PRIMARY KEY, out TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS translate_usage (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
