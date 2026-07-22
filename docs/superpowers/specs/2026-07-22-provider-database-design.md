# Provider Database & Multi-Source Architecture
**Date:** 2026-07-22  
**Status:** Approved  
**Scope:** flud-app — multi-provider streaming catalog with TMDB enrichment

---

## Problem

The current flud app stores manually bookmarked video URLs with no concept of streaming providers. With multiple streaming sites planned, titles will overlap across providers, TV show seasons will be split across sites, and each site needs different webview overlay settings. A structured provider + content layer is required.

---

## Approach

**Option B: Core directory + unified DB**

- `src-tauri/core/providers/<slug>/config.toml` — one config file per provider, version-controlled, human-editable
- On app start, Rust reads all `config.toml` files and upserts them into the `providers` table in SQLite
- A single unified SQLite DB (`flud.db`) holds all tables — canonical content, provider links, providers, playlists, and existing videos
- Cross-provider queries are trivial (single DB, JOIN on `provider_id`)

---

## Data Layer

### New Tables

**`providers`** — seeded from `core/` config files on every app start
```sql
CREATE TABLE providers (
    id          TEXT PRIMARY KEY,   -- slug: "fmovies"
    name        TEXT NOT NULL,      -- "FMovies"
    base_url    TEXT NOT NULL,      -- "https://fmoviess.org"
    mask_left   INTEGER NOT NULL DEFAULT 210,
    mask_right  INTEGER NOT NULL DEFAULT 210,
    mask_top    INTEGER NOT NULL DEFAULT 125,
    mask_bottom INTEGER NOT NULL DEFAULT 35,
    enabled     INTEGER NOT NULL DEFAULT 1  -- BOOLEAN
);
```

**`content`** — canonical titles, provider-agnostic, TMDB-enriched
```sql
CREATE TABLE content (
    id          TEXT PRIMARY KEY,   -- UUID
    tmdb_id     INTEGER UNIQUE,     -- NULL if no TMDB match found
    title       TEXT NOT NULL,
    media_type  TEXT NOT NULL,      -- "movie" | "tv_show"
    synopsis    TEXT,
    poster_url  TEXT,
    year        INTEGER,
    genres      TEXT,               -- JSON array: ["Action","Crime"]
    rating      REAL
);
```

**`provider_content`** — links a canonical title to a provider URL
```sql
CREATE TABLE provider_content (
    id             TEXT PRIMARY KEY,   -- UUID
    content_id     TEXT NOT NULL REFERENCES content(id),
    provider_id    TEXT NOT NULL REFERENCES providers(id),
    page_url       TEXT NOT NULL UNIQUE,
    season_number  INTEGER             -- NULL for movies; 1,2,3… for TV show seasons
);
```

### Existing Tables

`videos` and `playlists` remain unchanged. Manually bookmarked items continue to work as-is during the transition.

---

## Core Directory Structure

```
src-tauri/core/
└── providers/
    └── fmovies/
        └── config.toml
```

### `config.toml` format
```toml
[provider]
id       = "fmovies"
name     = "FMovies"
base_url = "https://fmoviess.org"
enabled  = true

[webview]
mask_left   = 210
mask_right  = 210
mask_top    = 125
mask_bottom = 35
```

Adding a new provider: create `core/providers/<slug>/config.toml`. App picks it up on next launch with no code changes required.

---

## Import Pipeline

### Script: `.flud/enrich.py`

Extends the existing `parse_sitemap.py`. Reads from the scraped `movies.db` (36,618 records) and writes enriched data into `flud.db`.

**Per-record flow:**
```
page_url: https://fmoviess.org/film/the-dark-knight-1234567/
  ↓ extract slug:         the-dark-knight-1234567
  ↓ strip trailing ID:    the-dark-knight
  ↓ humanize:             The Dark Knight
  ↓ TMDB search (movie or tv based on media_type)
  ↓ top result → tmdb_id, title, synopsis, poster_url, year, genres, rating
  ↓ INSERT INTO content   (skip if tmdb_id already exists)
  ↓ INSERT INTO provider_content (content_id, provider_id, page_url, season_number)
```

**TV show season extraction:**
Slug `breaking-bad-season-2-1234567` → base title `breaking-bad` → `season_number = 2`. The `content` row is the show itself; each season is a `provider_content` row with `season_number` set.

**TMDB confidence rule:**
- Title similarity ≥ 80% → use TMDB result (title, synopsis, poster, year, genres, rating)
- Below 80% → store slug-derived title with `tmdb_id = NULL`, no synopsis/rating. URL is still available for playback.

**Rate limiting:** TMDB free tier allows ~40 req/s. With 10 concurrent workers on 36k records, full enrichment completes in ~15–20 minutes. Re-runs skip already-matched records (idempotent).

**Usage:**
```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/.flud
python3 enrich.py --provider fmovies --tmdb-key YOUR_KEY
```

---

## UI & Playback Flow

### Navigation

Existing tabs: Home · Playlists · Tags  
New tab added: **Providers**

Home screen remains unified — all providers mixed, small provider badge on each card.

### Content Landing Page (modal)

Clicking any title opens a landing page instead of directly launching the webview.

**Movies:**
- Poster, title, year, star rating, genres
- Synopsis
- "Watch on:" buttons — one per provider that has this title
- Selecting a provider loads that provider's mask settings + opens WebviewWindow at that provider's URL

**TV Shows:**
- Poster, title, rating, genres
- Season list — each row: `Season N → [Provider Name]`
- Seasons from different providers appear in the same list
- Selecting a season row loads that provider's mask settings + opens WebviewWindow

### Providers Tab

Lists all configured providers. Each card shows:
- Name + base URL
- Movie count / TV show count indexed
- Current mask dimensions
- Enable / disable toggle

### Webview Changes (`commands.rs`)

`open_video_player` gains a `provider_id: String` parameter. Rust looks up that provider's `mask_left/right/top/bottom` from the DB and injects them dynamically into the `_HOLE` config in `init_script`. The hardcoded `{ left: 210, right: 210, top: 125, bottom: 35 }` is replaced with DB-driven values per provider.

---

## Implementation Order

1. Add `providers`, `content`, `provider_content` tables to `db.rs` + `init_db()`
2. Create `src-tauri/core/providers/fmovies/config.toml`
3. Rust startup routine: read all `core/providers/*/config.toml` → upsert into `providers`
4. Write `.flud/enrich.py` — slug parsing + TMDB enrichment + DB import
5. Run enrichment for fmovies (36k records → `flud.db`)
6. Update `open_video_player` to accept `provider_id`, look up mask from DB
7. Build content landing page modal (movies + TV shows)
8. Add Providers tab to Navbar + provider list UI
9. Wire home screen to show `content` rows with provider badges

---

## Out of Scope (this phase)

- Editing mask settings via the UI (read-only for now — edit `config.toml` directly)
- Scraping additional providers beyond fmovies
- User watchlist / watch history
- Automatic re-enrichment when new titles are added to a provider's sitemap
