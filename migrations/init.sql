-- migrations/init.sql
CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  page_url TEXT NOT NULL UNIQUE,
  cover_url TEXT,
  tags TEXT[] DEFAULT '{}',
  playlist_id TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);