-- D1 schema for mc.moikas.cc. Safe to re-run (IF NOT EXISTS / INSERT OR IGNORE).

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT NOT NULL UNIQUE,
  username    TEXT NOT NULL,
  avatar      TEXT,
  role        TEXT NOT NULL DEFAULT 'pending',   -- pending | member | staff | admin
  created_at  INTEGER NOT NULL,
  last_login  INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- One row per public server page. Blank fields fall back to Pterodactyl data.
CREATE TABLE IF NOT EXISTS servers (
  id               TEXT PRIMARY KEY,            -- url slug, e.g. "skyfactory"
  ptero_uuid       TEXT UNIQUE,                 -- linked Pterodactyl server (optional)
  name             TEXT,
  game             TEXT,
  address          TEXT,                        -- host players type; blank = PUBLIC_HOST
  port             INTEGER,                     -- blank = Pterodactyl allocation port
  connect_override TEXT,                        -- exact connect string to show, if set
  description      TEXT,
  mc_version       TEXT,
  loader           TEXT,
  loader_version   TEXT,
  modpack          TEXT,
  modpack_version  TEXT,
  modpack_url      TEXT,
  ram              TEXT,
  join_steps       TEXT,                        -- JSON array of strings
  hidden           INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

-- Raw data pushed by the NAS sync script, keyed by Pterodactyl server UUID.
CREATE TABLE IF NOT EXISTS ptero_servers (
  uuid       TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  synced_at  INTEGER NOT NULL
);

-- Official statements. server_id NULL = network-wide announcement.
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id   TEXT REFERENCES servers(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  tag         TEXT,
  event_at    TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_server ON posts(server_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,
  status      TEXT NOT NULL DEFAULT 'open',    -- open | in_progress | done
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_server ON tasks(server_id);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);

-- Starter content (carried over from the first version of the site).
INSERT OR IGNORE INTO servers (id, name, game, address, modpack, modpack_version, mc_version, loader,
  modpack_url, ram, join_steps, hidden, sort_order, created_at, updated_at)
VALUES ('skyfactory', 'SkyFactory', 'Minecraft', 'mc.moikas.cc', 'SkyFactory 5', NULL, '1.20.1', 'Forge',
  'https://www.curseforge.com/minecraft/modpacks/skyfactory-5', '6–8 GB',
  '["Install the CurseForge app (or Prism Launcher).","Install the modpack at the exact version listed. A mismatched version will not connect.","Give Minecraft the recommended RAM in the launcher settings.","Launch the pack, click Multiplayer → Add Server, and enter the address."]',
  0, 0, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT INTO posts (server_id, title, body, tag, pinned, created_at, updated_at)
SELECT NULL, 'New website is live',
  'This is the new home for server info: which modpack to install, official announcements, events, and the tasks we''re working on together. Log in with Discord to join the discussion.',
  'Announcement', 1, strftime('%s','now')*1000, strftime('%s','now')*1000
WHERE NOT EXISTS (SELECT 1 FROM posts);
