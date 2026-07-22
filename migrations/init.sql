-- migrations/init.sql
-- Schema reference — mirrors CREATE TABLE IF NOT EXISTS statements in src-tauri/src/db.rs
-- The app initializes the database at runtime via Rust (sqlx); this file is documentation only.

CREATE TABLE IF NOT EXISTS videos (
    id       TEXT PRIMARY KEY,
    title    TEXT NOT NULL,
    page_url TEXT NOT NULL UNIQUE,
    cover_url TEXT,
    tags     TEXT DEFAULT '[]',  -- stored as JSON array string
    playlist_id TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlists (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS providers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    base_url    TEXT NOT NULL,
    mask_left   INTEGER NOT NULL DEFAULT 210,
    mask_right  INTEGER NOT NULL DEFAULT 210,
    mask_top    INTEGER NOT NULL DEFAULT 125,
    mask_bottom INTEGER NOT NULL DEFAULT 35,
    enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS content (
    id         TEXT PRIMARY KEY,
    tmdb_id    INTEGER UNIQUE,
    title      TEXT NOT NULL,
    media_type TEXT NOT NULL,  -- "movie" | "tv_show"
    synopsis   TEXT,
    poster_url TEXT,
    year       INTEGER,
    genres     TEXT,           -- stored as JSON array string
    rating     REAL
);

CREATE TABLE IF NOT EXISTS provider_content (
    id            TEXT PRIMARY KEY,
    content_id    TEXT NOT NULL REFERENCES content(id),
    provider_id   TEXT NOT NULL REFERENCES providers(id),
    page_url      TEXT NOT NULL UNIQUE,
    season_number INTEGER
);
