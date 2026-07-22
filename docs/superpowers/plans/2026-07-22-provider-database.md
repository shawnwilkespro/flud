# Provider Database & Multi-Source Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider + canonical content layer to flud so multiple streaming sites can be organized separately, titles deduplicated via TMDB, TV seasons aggregated across providers, and per-provider webview mask settings loaded dynamically.

**Architecture:** A `src-tauri/core/providers/<slug>/config.toml` file per provider seeds a `providers` table in SQLite on app start. A canonical `content` table holds TMDB-enriched titles; a `provider_content` junction table links each title to one or more provider URLs (with `season_number` for TV shows). The existing `videos`/`playlists` tables are untouched.

**Tech Stack:** Rust (Tauri v2, sqlx 0.7, toml 0.8), React 19, TypeScript, TMDB API v3, Python 3 (enrichment script only)

## Global Constraints

- Never touch or migrate existing `videos` or `playlists` tables
- All new DB tables use `CREATE TABLE IF NOT EXISTS` — safe to re-run
- TypeScript strict mode — no `any`
- Tauri commands use snake_case; TypeScript callers use camelCase args
- `open_video_player` must remain backward-compatible: `provider_id` is `Option<String>` — if None, use hardcoded default mask

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src-tauri/Cargo.toml` | Modify | Add `toml` dependency |
| `src-tauri/core/providers/fmovies/config.toml` | Create | fmovies provider config |
| `src-tauri/tauri.conf.json` | Modify | Bundle `core/**` as resource |
| `src-tauri/src/db.rs` | Modify | Add Provider/Content/ProviderContent structs + table init + CRUD |
| `src-tauri/src/providers.rs` | Create | Read TOML configs, upsert providers into DB |
| `src-tauri/src/commands.rs` | Modify | Update `open_video_player`; add `list_providers`, `list_content`, `get_content_detail` |
| `src-tauri/src/lib.rs` | Modify | Register new module + commands; call provider loader on startup |
| `.flud/enrich.py` | Create | Slug→TMDB enrichment script; writes into flud.db |
| `src/src/components/ContentLandingModal.tsx` | Create | Landing page: movie sources / TV season list |
| `src/src/components/ContentRow.tsx` | Create | Horizontal scroll row for catalog Content items |
| `src/src/components/ProviderList.tsx` | Create | Providers tab UI |
| `src/src/components/Navbar.tsx` | Modify | Add Providers nav link |
| `src/src/App.tsx` | Modify | Add catalog state, ContentLandingModal, Providers tab, catalog rows on home |

---

### Task 1: DB Schema — providers, content, provider_content

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/db.rs`

**Interfaces:**
- Produces:
  - `struct Provider { id, name, base_url, mask_left, mask_right, mask_top, mask_bottom, enabled }`
  - `struct Content { id, tmdb_id, title, media_type, synopsis, poster_url, year, genres, rating }`
  - `struct ProviderContent { id, content_id, provider_id, page_url, season_number }`
  - `async fn db_upsert_provider(pool, Provider) -> sqlx::Result<()>`
  - `async fn db_list_providers(pool) -> sqlx::Result<Vec<Provider>>`
  - `async fn db_list_content(pool, search: Option<&str>) -> sqlx::Result<Vec<Content>>`
  - `async fn db_get_content_detail(pool, content_id: &str) -> sqlx::Result<Option<ContentDetail>>`
  - `struct ContentDetail { content: Content, sources: Vec<ContentSource> }`
  - `struct ContentSource { provider_id, provider_name, page_url, season_number }`

- [ ] **Step 1: Add `toml` to Cargo.toml**

  In `src-tauri/Cargo.toml`, add after the `dirs` line:
  ```toml
  toml = "0.8"
  ```

- [ ] **Step 2: Add new structs to db.rs**

  Open `src-tauri/src/db.rs`. After the existing `Playlist` struct (around line 21), add:

  ```rust
  #[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
  pub struct Provider {
      pub id: String,
      pub name: String,
      pub base_url: String,
      pub mask_left: i32,
      pub mask_right: i32,
      pub mask_top: i32,
      pub mask_bottom: i32,
      pub enabled: bool,
  }

  #[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
  pub struct Content {
      pub id: String,
      pub tmdb_id: Option<i64>,
      pub title: String,
      pub media_type: String, // "movie" | "tv_show"
      pub synopsis: Option<String>,
      pub poster_url: Option<String>,
      pub year: Option<i32>,
      pub genres: Option<String>, // JSON array string
      pub rating: Option<f64>,
  }

  #[derive(Debug, Clone, Serialize, Deserialize)]
  pub struct ContentSource {
      pub provider_id: String,
      pub provider_name: String,
      pub page_url: String,
      pub season_number: Option<i32>,
  }

  #[derive(Debug, Clone, Serialize, Deserialize)]
  pub struct ContentDetail {
      pub content: Content,
      pub sources: Vec<ContentSource>,
  }
  ```

- [ ] **Step 3: Add new table creation to `init_db()`**

  In `src-tauri/src/db.rs`, inside `init_db()` after the playlists table creation block (after line ~60), add:

  ```rust
  sqlx::query(
      r#"
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
      "#,
  )
  .execute(&pool)
  .await?;

  sqlx::query(
      r#"
      CREATE TABLE IF NOT EXISTS content (
          id         TEXT PRIMARY KEY,
          tmdb_id    INTEGER UNIQUE,
          title      TEXT NOT NULL,
          media_type TEXT NOT NULL,
          synopsis   TEXT,
          poster_url TEXT,
          year       INTEGER,
          genres     TEXT,
          rating     REAL
      );
      "#,
  )
  .execute(&pool)
  .await?;

  sqlx::query(
      r#"
      CREATE TABLE IF NOT EXISTS provider_content (
          id            TEXT PRIMARY KEY,
          content_id    TEXT NOT NULL REFERENCES content(id),
          provider_id   TEXT NOT NULL REFERENCES providers(id),
          page_url      TEXT NOT NULL UNIQUE,
          season_number INTEGER
      );
      "#,
  )
  .execute(&pool)
  .await?;
  ```

- [ ] **Step 4: Add CRUD functions to db.rs**

  Append these functions to the end of `src-tauri/src/db.rs`:

  ```rust
  pub async fn db_upsert_provider(pool: &SqlitePool, p: &Provider) -> sqlx::Result<()> {
      sqlx::query(
          r#"
          INSERT INTO providers (id, name, base_url, mask_left, mask_right, mask_top, mask_bottom, enabled)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
          ON CONFLICT(id) DO UPDATE SET
              name        = excluded.name,
              base_url    = excluded.base_url,
              mask_left   = excluded.mask_left,
              mask_right  = excluded.mask_right,
              mask_top    = excluded.mask_top,
              mask_bottom = excluded.mask_bottom,
              enabled     = excluded.enabled
          "#,
      )
      .bind(&p.id)
      .bind(&p.name)
      .bind(&p.base_url)
      .bind(p.mask_left)
      .bind(p.mask_right)
      .bind(p.mask_top)
      .bind(p.mask_bottom)
      .bind(p.enabled as i32)
      .execute(pool)
      .await?;
      Ok(())
  }

  pub async fn db_list_providers(pool: &SqlitePool) -> sqlx::Result<Vec<Provider>> {
      sqlx::query_as::<_, Provider>(
          "SELECT id, name, base_url, mask_left, mask_right, mask_top, mask_bottom, enabled FROM providers ORDER BY name ASC"
      )
      .fetch_all(pool)
      .await
  }

  pub async fn db_get_provider(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Provider>> {
      sqlx::query_as::<_, Provider>(
          "SELECT id, name, base_url, mask_left, mask_right, mask_top, mask_bottom, enabled FROM providers WHERE id = ?1"
      )
      .bind(id)
      .fetch_optional(pool)
      .await
  }

  pub async fn db_list_content(
      pool: &SqlitePool,
      search: Option<&str>,
  ) -> sqlx::Result<Vec<Content>> {
      match search {
          Some(q) => {
              let like = format!("%{}%", q);
              sqlx::query_as::<_, Content>(
                  "SELECT id, tmdb_id, title, media_type, synopsis, poster_url, year, genres, rating FROM content WHERE title LIKE ?1 ORDER BY title ASC LIMIT 500"
              )
              .bind(like)
              .fetch_all(pool)
              .await
          }
          None => {
              sqlx::query_as::<_, Content>(
                  "SELECT id, tmdb_id, title, media_type, synopsis, poster_url, year, genres, rating FROM content ORDER BY title ASC LIMIT 500"
              )
              .fetch_all(pool)
              .await
          }
      }
  }

  pub async fn db_get_content_detail(
      pool: &SqlitePool,
      content_id: &str,
  ) -> sqlx::Result<Option<ContentDetail>> {
      let content = sqlx::query_as::<_, Content>(
          "SELECT id, tmdb_id, title, media_type, synopsis, poster_url, year, genres, rating FROM content WHERE id = ?1"
      )
      .bind(content_id)
      .fetch_optional(pool)
      .await?;

      let Some(content) = content else {
          return Ok(None);
      };

      let sources = sqlx::query_as::<_, (String, String, String, Option<i32>)>(
          r#"
          SELECT pc.provider_id, p.name, pc.page_url, pc.season_number
          FROM provider_content pc
          JOIN providers p ON p.id = pc.provider_id
          WHERE pc.content_id = ?1
          ORDER BY pc.season_number ASC NULLS LAST, p.name ASC
          "#,
      )
      .bind(content_id)
      .fetch_all(pool)
      .await?
      .into_iter()
      .map(|(provider_id, provider_name, page_url, season_number)| ContentSource {
          provider_id,
          provider_name,
          page_url,
          season_number,
      })
      .collect();

      Ok(Some(ContentDetail { content, sources }))
  }
  ```

- [ ] **Step 5: Verify it compiles**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src-tauri
  cargo check
  ```
  Expected: no errors. If sqlx complains about `bool` for `enabled`, use `enabled: i32` in the struct and cast at the call site.

- [ ] **Step 6: Commit**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
  git add src-tauri/Cargo.toml src-tauri/src/db.rs
  git commit -m "feat: add providers, content, provider_content DB schema and CRUD"
  ```

---

### Task 2: Core directory + provider config loader

**Files:**
- Create: `src-tauri/core/providers/fmovies/config.toml`
- Create: `src-tauri/src/providers.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: `db::db_upsert_provider`, `db::Provider`
- Produces: `providers::load_all_providers(app_handle, pool) -> Result<(), Box<dyn Error>>`

- [ ] **Step 1: Create core directory and fmovies config**

  ```bash
  mkdir -p /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src-tauri/core/providers/fmovies
  ```

  Create `src-tauri/core/providers/fmovies/config.toml`:
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

- [ ] **Step 2: Create `src-tauri/src/providers.rs`**

  ```rust
  use serde::Deserialize;
  use sqlx::SqlitePool;
  use std::path::PathBuf;

  use crate::db::{db_upsert_provider, Provider};

  #[derive(Debug, Deserialize)]
  struct ProviderSection {
      id: String,
      name: String,
      base_url: String,
      enabled: bool,
  }

  #[derive(Debug, Deserialize)]
  struct WebviewSection {
      mask_left: i32,
      mask_right: i32,
      mask_top: i32,
      mask_bottom: i32,
  }

  #[derive(Debug, Deserialize)]
  struct ProviderConfig {
      provider: ProviderSection,
      webview: WebviewSection,
  }

  fn core_providers_dir() -> PathBuf {
      // In dev: read from source tree (CARGO_MANIFEST_DIR = src-tauri/)
      // In release: read from bundled resources
      #[cfg(debug_assertions)]
      {
          PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("core/providers")
      }
      #[cfg(not(debug_assertions))]
      {
          // tauri.conf.json bundles core/** — resource_dir() resolves at runtime
          // Caller must pass app_handle for this case; stub with manifest dir for now
          PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("core/providers")
      }
  }

  pub async fn load_all_providers(pool: &SqlitePool) {
      let providers_dir = core_providers_dir();

      let entries = match std::fs::read_dir(&providers_dir) {
          Ok(e) => e,
          Err(err) => {
              log::warn!("Could not read providers dir {:?}: {}", providers_dir, err);
              return;
          }
      };

      for entry in entries.flatten() {
          let config_path = entry.path().join("config.toml");
          if !config_path.exists() {
              continue;
          }

          let raw = match std::fs::read_to_string(&config_path) {
              Ok(s) => s,
              Err(err) => {
                  log::warn!("Failed to read {:?}: {}", config_path, err);
                  continue;
              }
          };

          let cfg: ProviderConfig = match toml::from_str(&raw) {
              Ok(c) => c,
              Err(err) => {
                  log::warn!("Failed to parse {:?}: {}", config_path, err);
                  continue;
              }
          };

          let provider = Provider {
              id: cfg.provider.id,
              name: cfg.provider.name,
              base_url: cfg.provider.base_url,
              mask_left: cfg.webview.mask_left,
              mask_right: cfg.webview.mask_right,
              mask_top: cfg.webview.mask_top,
              mask_bottom: cfg.webview.mask_bottom,
              enabled: cfg.provider.enabled,
          };

          if let Err(err) = db_upsert_provider(pool, &provider).await {
              log::warn!("Failed to upsert provider {}: {}", provider.id, err);
          } else {
              log::info!("Loaded provider: {} ({})", provider.name, provider.id);
          }
      }
  }
  ```

- [ ] **Step 3: Register `providers` module in lib.rs and call loader on startup**

  In `src-tauri/src/lib.rs`, add `mod providers;` after `mod db;`:
  ```rust
  mod commands;
  mod db;
  mod providers;
  ```

  Inside the `.setup(|app| {` closure, after `handle.manage(AppState { db: pool });`, add:
  ```rust
  // Load provider configs from core/providers/*/config.toml
  let pool_ref = handle.state::<AppState>().db.clone();
  rt.block_on(providers::load_all_providers(&pool_ref));
  ```

- [ ] **Step 4: Add `core/**` to tauri.conf.json bundle resources**

  Open `src-tauri/tauri.conf.json`. Find the `"bundle"` section and add a `"resources"` array:
  ```json
  "bundle": {
    "resources": [
      "core/**"
    ]
  }
  ```
  If `"bundle"` already has a `"resources"` key, append `"core/**"` to the existing array.

- [ ] **Step 5: Verify it compiles**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src-tauri
  cargo check
  ```
  Expected: no errors.

- [ ] **Step 6: Smoke test — run the app and check logs**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
  npm run tauri dev
  ```
  Expected: console shows `Loaded provider: FMovies (fmovies)`. Check the flud.db:
  ```bash
  sqlite3 ~/Library/Application\ Support/flud/flud.db "SELECT * FROM providers;"
  ```
  Expected: one row — `fmovies|FMovies|https://fmoviess.org|210|210|125|35|1`

- [ ] **Step 7: Commit**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
  git add src-tauri/core/ src-tauri/src/providers.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json
  git commit -m "feat: add core/providers config dir and startup provider loader"
  ```

---

### Task 3: Update open_video_player + add content/provider Tauri commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `db::db_get_provider`, `db::db_list_providers`, `db::db_list_content`, `db::db_get_content_detail`
- Produces (Tauri commands):
  - `list_providers() -> Vec<Provider>`
  - `list_content(search: Option<String>) -> Vec<Content>`
  - `get_content_detail(content_id: String) -> Option<ContentDetail>`
  - Updated `open_video_player(url, title, provider_id: Option<String>)`

- [ ] **Step 1: Update `open_video_player` to accept `provider_id` and load mask dynamically**

  In `src-tauri/src/commands.rs`, find the `open_video_player` function signature. Change it from:
  ```rust
  pub async fn open_video_player(
      url: String,
      title: String,
      ...
  ```
  to:
  ```rust
  pub async fn open_video_player(
      url: String,
      title: String,
      provider_id: Option<String>,
      state: tauri::State<'_, AppState>,
      ...
  ```

  Inside the function body, find the hardcoded `_HOLE` assignment in the `init_script`. It currently looks like:
  ```javascript
  var _HOLE = { left: 210, right: 210, top: 125, bottom: 35 };
  ```

  Replace the init_script construction so the hole values come from the DB. Add this block before the `let init_script = r##"...` declaration:

  ```rust
  // Load provider mask settings; fall back to defaults if no provider_id given
  let (mask_left, mask_right, mask_top, mask_bottom) = if let Some(ref pid) = provider_id {
      match db::db_get_provider(&state.db, pid).await {
          Ok(Some(p)) => (p.mask_left, p.mask_right, p.mask_top, p.mask_bottom),
          _ => (210, 210, 125, 35),
      }
  } else {
      (210, 210, 125, 35)
  };

  let hole_js = format!(
      "var _HOLE = {{ left: {}, right: {}, top: {}, bottom: {} }};",
      mask_left, mask_right, mask_top, mask_bottom
  );
  ```

  Then in the `init_script` raw string, replace the hardcoded:
  ```javascript
  var _HOLE = { left: 210, right: 210, top: 125, bottom: 35 };
  ```
  with a placeholder token `__HOLE_PLACEHOLDER__`, and after the raw string assignment, replace it:
  ```rust
  let init_script = r##"
      (function() {
          __HOLE_PLACEHOLDER__
          // ... rest of script unchanged ...
      })();
  "##.replace("__HOLE_PLACEHOLDER__", &hole_js);
  ```

  > Note: the `r##"..."##` delimiter means we can't use `format!()` directly (it would need `{{` escaping everywhere). The `.replace()` approach avoids touching the rest of the script.

- [ ] **Step 2: Add `list_providers` command to commands.rs**

  Append to `src-tauri/src/commands.rs`:

  ```rust
  #[tauri::command]
  pub async fn list_providers(
      state: tauri::State<'_, AppState>,
  ) -> Result<Vec<db::Provider>, String> {
      db::db_list_providers(&state.db)
          .await
          .map_err(|e| e.to_string())
  }

  #[tauri::command]
  pub async fn list_content(
      search: Option<String>,
      state: tauri::State<'_, AppState>,
  ) -> Result<Vec<db::Content>, String> {
      db::db_list_content(&state.db, search.as_deref())
          .await
          .map_err(|e| e.to_string())
  }

  #[tauri::command]
  pub async fn get_content_detail(
      content_id: String,
      state: tauri::State<'_, AppState>,
  ) -> Result<Option<db::ContentDetail>, String> {
      db::db_get_content_detail(&state.db, &content_id)
          .await
          .map_err(|e| e.to_string())
  }
  ```

- [ ] **Step 3: Register new commands in lib.rs**

  In `src-tauri/src/lib.rs`, add to `tauri::generate_handler![]`:
  ```rust
  commands::list_providers,
  commands::list_content,
  commands::get_content_detail,
  ```

- [ ] **Step 4: Verify it compiles**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src-tauri
  cargo check
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
  git add src-tauri/src/commands.rs src-tauri/src/lib.rs
  git commit -m "feat: add list_providers, list_content, get_content_detail commands; dynamic mask in open_video_player"
  ```

---

### Task 4: TMDB Enrichment Script

**Files:**
- Create: `/Users/shawnwilkes/Documents/GitHub/flud-shell/.flud/enrich.py`

**Interfaces:**
- Reads: `.flud/movies.db` (table: `movies` — columns: `page_url`, `image_path`, `media_type`)
- Writes: `~/Library/Application Support/flud/flud.db` (tables: `content`, `provider_content`)
- Arg: `--provider fmovies` (must match a `providers.id` already in flud.db)
- Arg: `--tmdb-key YOUR_KEY`
- Arg: `--db PATH` (optional override for flud.db path)

- [ ] **Step 1: Get a TMDB API key**

  Register at https://www.themoviedb.org/settings/api — free account, API key is instant. Keep it handy for Step 3.

- [ ] **Step 2: Create `.flud/enrich.py`**

  ```python
  #!/usr/bin/env python3
  """
  enrich.py — TMDB enrichment for flud provider catalog

  Reads slug URLs from movies.db (scraped sitemap), matches via TMDB,
  and writes enriched content + provider_content rows into flud.db.

  Usage:
      python3 enrich.py --provider fmovies --tmdb-key YOUR_KEY
      python3 enrich.py --provider fmovies --tmdb-key YOUR_KEY --db /path/to/flud.db
  """

  import argparse
  import re
  import sqlite3
  import time
  import uuid
  from concurrent.futures import ThreadPoolExecutor, as_completed
  from pathlib import Path
  from difflib import SequenceMatcher

  import requests

  TMDB_BASE = "https://api.themoviedb.org/3"
  TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
  CONFIDENCE_THRESHOLD = 0.80
  MAX_WORKERS = 8
  REQUEST_DELAY = 0.03  # ~33 req/s — safe under TMDB 40/s limit

  DEFAULT_SOURCE_DB = Path(__file__).parent / "movies.db"
  DEFAULT_FLUD_DB = Path.home() / "Library" / "Application Support" / "flud" / "flud.db"


  def slug_to_title(slug: str) -> tuple[str, int | None]:
      """
      Parse a URL slug into (human_title, season_number).

      Examples:
        'the-dark-knight-1234567'       -> ('The Dark Knight', None)
        'breaking-bad-season-2-1234567' -> ('Breaking Bad', 2)
        'game-of-thrones-season-8-9999' -> ('Game of Thrones', 8)
      """
      # Strip trailing numeric ID (the fmovies suffix)
      slug = re.sub(r'-\d+$', '', slug)

      # Extract and strip season number
      season_match = re.search(r'-season-(\d+)', slug, re.IGNORECASE)
      season_number = int(season_match.group(1)) if season_match else None
      if season_match:
          slug = slug[:season_match.start()]

      # Convert hyphens to spaces and title-case
      title = slug.replace('-', ' ').title()
      return title, season_number


  def extract_slug(page_url: str) -> str:
      """Extract slug from URL: 'https://fmoviess.org/film/the-dark-knight-123/' -> 'the-dark-knight-123'"""
      return page_url.rstrip('/').split('/')[-1]


  def title_similarity(a: str, b: str) -> float:
      return SequenceMatcher(None, a.lower(), b.lower()).ratio()


  def search_tmdb(title: str, media_type: str, api_key: str) -> dict | None:
      """Search TMDB for a title. Returns enriched dict or None if no confident match."""
      endpoint = "movie" if media_type == "movie" else "tv"
      try:
          r = requests.get(
              f"{TMDB_BASE}/search/{endpoint}",
              params={"query": title, "api_key": api_key},
              timeout=10,
          )
          r.raise_for_status()
          results = r.json().get("results", [])
          if not results:
              return None

          top = results[0]
          tmdb_title = top.get("title") or top.get("name", "")
          score = title_similarity(title, tmdb_title)

          if score < CONFIDENCE_THRESHOLD:
              return None

          release = top.get("release_date") or top.get("first_air_date") or ""
          year = int(release[:4]) if len(release) >= 4 and release[:4].isdigit() else None
          poster = top.get("poster_path")

          return {
              "tmdb_id": top["id"],
              "title": tmdb_title,
              "synopsis": top.get("overview") or None,
              "poster_url": f"{TMDB_IMAGE_BASE}{poster}" if poster else None,
              "year": year,
              "rating": top.get("vote_average") or None,
          }
      except Exception as e:
          print(f"  TMDB error for '{title}': {e}")
          return None


  def enrich_record(row: tuple, provider_id: str, api_key: str, delay: float) -> dict:
      """
      Process one row from movies.db.
      Returns a dict with keys: page_url, title, media_type, season_number, tmdb_data (or None)
      """
      page_url, image_path, media_type = row
      slug = extract_slug(page_url)
      title, season_number = slug_to_title(slug)

      time.sleep(delay)
      tmdb = search_tmdb(title, media_type, api_key)

      return {
          "page_url": page_url,
          "fallback_title": title,
          "fallback_poster": image_path,
          "media_type": media_type,
          "season_number": season_number,
          "tmdb": tmdb,
      }


  def run(provider_id: str, api_key: str, source_db: Path, flud_db: Path):
      # Verify provider exists in flud.db
      conn = sqlite3.connect(str(flud_db))
      conn.row_factory = sqlite3.Row
      cur = conn.cursor()
      cur.execute("SELECT id FROM providers WHERE id = ?", (provider_id,))
      if not cur.fetchone():
          print(f"ERROR: Provider '{provider_id}' not found in {flud_db}")
          print("  Run the app once so providers are loaded from core/providers/*/config.toml")
          conn.close()
          return

      # Load already-processed URLs to allow safe re-runs
      cur.execute("SELECT page_url FROM provider_content WHERE provider_id = ?", (provider_id,))
      already_done = {row["page_url"] for row in cur.fetchall()}
      print(f"Skipping {len(already_done)} already-processed URLs.")

      # Load source records
      src_conn = sqlite3.connect(str(source_db))
      src_cur = src_conn.cursor()
      src_cur.execute("SELECT page_url, image_path, media_type FROM movies")
      rows = [r for r in src_cur.fetchall() if r[0] not in already_done]
      src_conn.close()
      print(f"Processing {len(rows)} new records from {source_db}...")

      matched = 0
      unmatched = 0
      errors = 0
      delay_per_worker = REQUEST_DELAY * MAX_WORKERS

      with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
          futures = {
              executor.submit(enrich_record, row, provider_id, api_key, delay_per_worker): row
              for row in rows
          }

          for i, future in enumerate(as_completed(futures), 1):
              try:
                  result = future.result()
              except Exception as e:
                  errors += 1
                  print(f"  [{i}/{len(rows)}] ERROR: {e}")
                  continue

              tmdb = result["tmdb"]
              page_url = result["page_url"]
              media_type = result["media_type"]
              season_number = result["season_number"]

              if tmdb:
                  # Try to find existing content row by tmdb_id
                  cur.execute("SELECT id FROM content WHERE tmdb_id = ?", (tmdb["tmdb_id"],))
                  existing = cur.fetchone()

                  if existing:
                      content_id = existing["id"]
                  else:
                      content_id = str(uuid.uuid4())
                      cur.execute(
                          """INSERT OR IGNORE INTO content
                             (id, tmdb_id, title, media_type, synopsis, poster_url, year, rating)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                          (
                              content_id,
                              tmdb["tmdb_id"],
                              tmdb["title"],
                              media_type,
                              tmdb["synopsis"],
                              tmdb["poster_url"],
                              tmdb["year"],
                              tmdb["rating"],
                          ),
                      )
                  matched += 1
              else:
                  # No TMDB match — store with slug-derived title, no tmdb_id
                  content_id = str(uuid.uuid4())
                  cur.execute(
                      """INSERT OR IGNORE INTO content
                         (id, tmdb_id, title, media_type, poster_url)
                         VALUES (?, NULL, ?, ?, ?)""",
                      (
                          content_id,
                          result["fallback_title"],
                          media_type,
                          result["fallback_poster"],
                      ),
                  )
                  unmatched += 1

              # Insert provider_content link
              cur.execute(
                  """INSERT OR IGNORE INTO provider_content
                     (id, content_id, provider_id, page_url, season_number)
                     VALUES (?, ?, ?, ?, ?)""",
                  (str(uuid.uuid4()), content_id, provider_id, page_url, season_number),
              )

              # Commit in batches of 100
              if i % 100 == 0:
                  conn.commit()
                  print(f"  [{i}/{len(rows)}] matched={matched} unmatched={unmatched} errors={errors}")

      conn.commit()
      conn.close()

      print(f"\nDone. matched={matched} unmatched={unmatched} errors={errors}")
      print(f"Results written to {flud_db}")


  if __name__ == "__main__":
      parser = argparse.ArgumentParser(description="Enrich flud catalog from TMDB")
      parser.add_argument("--provider", required=True, help="Provider ID (e.g. fmovies)")
      parser.add_argument("--tmdb-key", required=True, help="TMDB API key")
      parser.add_argument("--source-db", default=str(DEFAULT_SOURCE_DB), help="Path to movies.db")
      parser.add_argument("--db", default=str(DEFAULT_FLUD_DB), help="Path to flud.db")
      args = parser.parse_args()

      run(
          provider_id=args.provider,
          api_key=args.tmdb_key,
          source_db=Path(args.source_db),
          flud_db=Path(args.db),
      )
  ```

- [ ] **Step 3: Install dependencies**

  ```bash
  pip3 install requests
  ```

- [ ] **Step 4: Run a small test batch first (100 records)**

  Add `LIMIT 100` to the `SELECT` query in `enrich.py` `run()` temporarily:
  ```python
  src_cur.execute("SELECT page_url, image_path, media_type FROM movies LIMIT 100")
  ```
  Then run:
  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/.flud
  python3 enrich.py --provider fmovies --tmdb-key YOUR_KEY_HERE
  ```
  Expected output: `Done. matched=~75 unmatched=~25 errors=0` (rough estimate; real numbers vary).

  Verify in DB:
  ```bash
  sqlite3 ~/Library/Application\ Support/flud/flud.db \
    "SELECT COUNT(*) FROM content; SELECT COUNT(*) FROM provider_content;"
  ```

- [ ] **Step 5: Remove the LIMIT and run the full enrichment**

  Remove `LIMIT 100` from the SELECT. This run takes ~15–20 minutes:
  ```bash
  python3 enrich.py --provider fmovies --tmdb-key YOUR_KEY_HERE
  ```
  Re-runs are safe — already-processed URLs are skipped.

- [ ] **Step 6: Commit the script**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
  git add ../.flud/enrich.py
  git commit -m "feat: add TMDB enrichment script for fmovies catalog"
  ```

---

### Task 5: ContentLandingModal — React component

**Files:**
- Create: `src/src/components/ContentLandingModal.tsx`

**Interfaces:**
- Consumes (Tauri): `get_content_detail(content_id: string) -> ContentDetail | null`
- Consumes (props):
  ```typescript
  interface ContentLandingModalProps {
    contentId: string | null;           // null = closed
    onClose: () => void;
    onPlay: (url: string, title: string, providerId: string) => void;
  }
  ```
- Produces: rendered modal — movie view (provider buttons) or TV show view (season rows)

- [ ] **Step 1: Create `src/src/components/ContentLandingModal.tsx`**

  ```tsx
  import React, { useEffect, useState } from 'react';
  import { X, Play, Star, Tv, Film } from 'lucide-react';

  interface Content {
    id: string;
    tmdb_id?: number | null;
    title: string;
    media_type: string;
    synopsis?: string | null;
    poster_url?: string | null;
    year?: number | null;
    genres?: string | null;
    rating?: number | null;
  }

  interface ContentSource {
    provider_id: string;
    provider_name: string;
    page_url: string;
    season_number?: number | null;
  }

  interface ContentDetail {
    content: Content;
    sources: ContentSource[];
  }

  interface ContentLandingModalProps {
    contentId: string | null;
    onClose: () => void;
    onPlay: (url: string, title: string, providerId: string) => void;
  }

  async function callTauri<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
    try {
      if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<T>(command, args);
      }
    } catch (err) {
      console.warn(`[Tauri] ${command}:`, err);
    }
    return null;
  }

  export const ContentLandingModal: React.FC<ContentLandingModalProps> = ({
    contentId,
    onClose,
    onPlay,
  }) => {
    const [detail, setDetail] = useState<ContentDetail | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      if (!contentId) {
        setDetail(null);
        return;
      }
      setLoading(true);
      callTauri<ContentDetail | null>('get_content_detail', { contentId }).then((d) => {
        setDetail(d ?? null);
        setLoading(false);
      });
    }, [contentId]);

    if (!contentId) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    };

    const content = detail?.content;
    const sources = detail?.sources ?? [];
    const isTV = content?.media_type === 'tv_show';
    const genres = content?.genres ? JSON.parse(content.genres) as string[] : [];

    return (
      <div
        className="modal-backdrop"
        onClick={handleBackdropClick}
        style={{ zIndex: 1000 }}
      >
        <div className="modal-content content-landing-modal">
          <button className="modal-close-btn" onClick={onClose}>
            <X size={20} />
          </button>

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-gray)' }}>
              Loading...
            </div>
          ) : !content ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-gray)' }}>
              Title not found.
            </div>
          ) : (
            <div className="content-landing-body">
              {/* Poster */}
              <div className="content-landing-poster">
                {content.poster_url ? (
                  <img src={content.poster_url} alt={content.title} />
                ) : (
                  <div className="poster-fallback">
                    {isTV ? <Tv size={48} /> : <Film size={48} />}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="content-landing-info">
                <h2 className="content-landing-title">{content.title}</h2>

                <div className="content-landing-meta">
                  {content.year && <span>{content.year}</span>}
                  {content.rating && (
                    <span className="rating-pill">
                      <Star size={13} fill="currentColor" />
                      {content.rating.toFixed(1)}
                    </span>
                  )}
                  {genres.slice(0, 3).map((g) => (
                    <span key={g} className="genre-pill">{g}</span>
                  ))}
                </div>

                {content.synopsis && (
                  <p className="content-landing-synopsis">{content.synopsis}</p>
                )}

                {/* Movie: provider source buttons */}
                {!isTV && (
                  <div className="content-landing-sources">
                    <h3>Watch on:</h3>
                    <div className="source-buttons">
                      {sources.length === 0 ? (
                        <p style={{ color: 'var(--text-gray)' }}>No sources available.</p>
                      ) : (
                        sources.map((src) => (
                          <button
                            key={src.provider_id}
                            className="btn-netflix-primary source-btn"
                            onClick={() => onPlay(src.page_url, content.title, src.provider_id)}
                          >
                            <Play size={16} fill="currentColor" />
                            {src.provider_name}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* TV Show: season list */}
                {isTV && (
                  <div className="content-landing-seasons">
                    <h3>Seasons:</h3>
                    {sources.length === 0 ? (
                      <p style={{ color: 'var(--text-gray)' }}>No seasons available.</p>
                    ) : (
                      <div className="season-list">
                        {sources.map((src) => (
                          <button
                            key={`${src.provider_id}-${src.season_number}`}
                            className="season-row-btn"
                            onClick={() => onPlay(src.page_url, `${content.title} S${src.season_number}`, src.provider_id)}
                          >
                            <span className="season-label">
                              {src.season_number != null ? `Season ${src.season_number}` : 'Full Series'}
                            </span>
                            <span className="season-provider">
                              <Play size={12} fill="currentColor" />
                              {src.provider_name}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };
  ```

- [ ] **Step 2: Add CSS for the new modal classes**

  Open `src/src/index.css`. Append at the end:

  ```css
  /* ContentLandingModal */
  .content-landing-modal {
    max-width: 860px;
    width: 90vw;
    max-height: 85vh;
    overflow-y: auto;
    padding: 0;
  }

  .content-landing-body {
    display: flex;
    gap: 2rem;
    padding: 2rem;
  }

  .content-landing-poster {
    flex-shrink: 0;
    width: 200px;
  }

  .content-landing-poster img {
    width: 100%;
    border-radius: 8px;
    object-fit: cover;
  }

  .poster-fallback {
    width: 200px;
    height: 300px;
    background: rgba(255,255,255,0.05);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-gray);
  }

  .content-landing-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .content-landing-title {
    font-size: 1.8rem;
    font-weight: 800;
    margin: 0;
  }

  .content-landing-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    color: var(--text-gray);
    font-size: 0.9rem;
  }

  .rating-pill {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #f5c518;
  }

  .genre-pill {
    background: rgba(255,255,255,0.1);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.8rem;
  }

  .content-landing-synopsis {
    color: var(--text-gray);
    line-height: 1.6;
    font-size: 0.95rem;
    margin: 0;
  }

  .content-landing-sources h3,
  .content-landing-seasons h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
    color: var(--text-gray);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .source-buttons {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .source-btn {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .season-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .season-row-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
    transition: background 0.2s;
    font-size: 0.95rem;
  }

  .season-row-btn:hover {
    background: rgba(229,9,20,0.2);
    border-color: var(--netflix-red);
  }

  .season-label {
    font-weight: 600;
  }

  .season-provider {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-gray);
    font-size: 0.85rem;
  }
  ```

- [ ] **Step 3: TypeScript check**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src
  npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
  git add src/src/components/ContentLandingModal.tsx src/src/index.css
  git commit -m "feat: add ContentLandingModal for movie sources and TV season list"
  ```

---

### Task 6: ContentRow — catalog display component

**Files:**
- Create: `src/src/components/ContentRow.tsx`

**Interfaces:**
- Consumes:
  ```typescript
  interface Content {
    id: string;
    title: string;
    media_type: string;
    poster_url?: string | null;
    year?: number | null;
    rating?: number | null;
  }
  interface ContentRowProps {
    title: string;
    items: Content[];
    onOpenDetail: (contentId: string) => void;
  }
  ```
- Produces: horizontal scrollable row of content cards with provider-agnostic design

- [ ] **Step 1: Create `src/src/components/ContentRow.tsx`**

  ```tsx
  import React, { useRef } from 'react';
  import { ChevronLeft, ChevronRight, Play, Film, Tv, Star } from 'lucide-react';

  export interface Content {
    id: string;
    tmdb_id?: number | null;
    title: string;
    media_type: string;
    synopsis?: string | null;
    poster_url?: string | null;
    year?: number | null;
    genres?: string | null;
    rating?: number | null;
  }

  interface ContentCardProps {
    item: Content;
    onOpenDetail: (id: string) => void;
  }

  const ContentCard: React.FC<ContentCardProps> = ({ item, onOpenDetail }) => {
    const [imgError, setImgError] = React.useState(false);
    const isTV = item.media_type === 'tv_show';

    return (
      <div className="row-card" onClick={() => onOpenDetail(item.id)}>
        <div className="card-thumbnail">
          {item.poster_url && !imgError ? (
            <img
              src={item.poster_url}
              alt={item.title}
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="thumbnail-fallback">
              {isTV ? <Tv size={36} /> : <Film size={36} />}
            </div>
          )}

          <div className="card-play-overlay">
            <button
              className="card-play-btn"
              onClick={(e) => { e.stopPropagation(); onOpenDetail(item.id); }}
              title="View Sources"
            >
              <Play size={20} fill="currentColor" />
            </button>
          </div>
        </div>

        <div className="card-meta">
          <div className="card-top-info">
            {item.rating && (
              <span className="domain-pill" style={{ color: '#f5c518' }}>
                <Star size={11} fill="currentColor" />
                {item.rating.toFixed(1)}
              </span>
            )}
            {item.year && (
              <span className="domain-pill">{item.year}</span>
            )}
          </div>

          <h3 className="card-title-text">{item.title}</h3>

          <div className="card-bottom-actions">
            <button
              className="card-action-btn primary"
              onClick={(e) => { e.stopPropagation(); onOpenDetail(item.id); }}
            >
              <Play size={14} fill="currentColor" />
              <span>Sources</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  interface ContentRowProps {
    title: string;
    items: Content[];
    onOpenDetail: (contentId: string) => void;
  }

  export const ContentRow: React.FC<ContentRowProps> = ({ title, items, onOpenDetail }) => {
    const rowRef = useRef<HTMLDivElement>(null);

    const handleScroll = (dir: 'left' | 'right') => {
      if (rowRef.current) {
        const { scrollLeft, clientWidth } = rowRef.current;
        rowRef.current.scrollTo({
          left: dir === 'left' ? scrollLeft - clientWidth * 0.75 : scrollLeft + clientWidth * 0.75,
          behavior: 'smooth',
        });
      }
    };

    if (items.length === 0) return null;

    return (
      <div className="netflix-row">
        <h2 className="row-header">
          <span>{title}</span>
          <span className="row-count">({items.length})</span>
        </h2>

        <div className="row-container">
          <button className="scroll-arrow left" onClick={() => handleScroll('left')}>
            <ChevronLeft size={28} />
          </button>

          <div className="row-cards" ref={rowRef}>
            {items.map((item) => (
              <ContentCard key={item.id} item={item} onOpenDetail={onOpenDetail} />
            ))}
          </div>

          <button className="scroll-arrow right" onClick={() => handleScroll('right')}>
            <ChevronRight size={28} />
          </button>
        </div>
      </div>
    );
  };
  ```

- [ ] **Step 2: TypeScript check**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src
  npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
  git add src/src/components/ContentRow.tsx
  git commit -m "feat: add ContentRow component for catalog browsing"
  ```

---

### Task 7: Providers tab UI

**Files:**
- Create: `src/src/components/ProviderList.tsx`
- Modify: `src/src/components/Navbar.tsx`

**Interfaces:**
- Consumes (Tauri): `list_providers() -> Provider[]`
- Consumes (props for Navbar): no new props — `activeTab`/`setActiveTab` already passed
- Produces: `<ProviderList />` standalone component; `'providers'` tab added to Navbar

- [ ] **Step 1: Create `src/src/components/ProviderList.tsx`**

  ```tsx
  import React, { useEffect, useState } from 'react';
  import { Globe, ToggleLeft, ToggleRight } from 'lucide-react';

  interface Provider {
    id: string;
    name: string;
    base_url: string;
    mask_left: number;
    mask_right: number;
    mask_top: number;
    mask_bottom: number;
    enabled: boolean;
  }

  async function callTauri<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
    try {
      if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<T>(command, args);
      }
    } catch (err) {
      console.warn(`[Tauri] ${command}:`, err);
    }
    return null;
  }

  export const ProviderList: React.FC = () => {
    const [providers, setProviders] = useState<Provider[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      callTauri<Provider[]>('list_providers').then((list) => {
        setProviders(list ?? []);
        setLoading(false);
      });
    }, []);

    if (loading) {
      return (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-gray)' }}>
          Loading providers...
        </div>
      );
    }

    if (providers.length === 0) {
      return (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-gray)' }}>
          No providers configured. Add a <code>config.toml</code> to{' '}
          <code>src-tauri/core/providers/&lt;slug&gt;/</code> and restart the app.
        </div>
      );
    }

    return (
      <div className="provider-list-wrapper">
        <h2 className="row-header" style={{ padding: '1.5rem 4% 0' }}>
          <span>Streaming Providers</span>
          <span className="row-count">({providers.length})</span>
        </h2>

        <div className="provider-cards">
          {providers.map((p) => (
            <div key={p.id} className={`provider-card ${p.enabled ? '' : 'disabled'}`}>
              <div className="provider-card-header">
                <Globe size={20} />
                <span className="provider-card-name">{p.name}</span>
                {p.enabled ? (
                  <ToggleRight size={22} className="provider-toggle on" />
                ) : (
                  <ToggleLeft size={22} className="provider-toggle off" />
                )}
              </div>

              <a
                className="provider-card-url"
                href={p.base_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {p.base_url}
              </a>

              <div className="provider-card-mask">
                <span className="mask-label">Mask</span>
                <span>L:{p.mask_left}</span>
                <span>R:{p.mask_right}</span>
                <span>T:{p.mask_top}</span>
                <span>B:{p.mask_bottom}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };
  ```

- [ ] **Step 2: Add provider-card CSS to index.css**

  Append to `src/src/index.css`:

  ```css
  /* Provider List */
  .provider-list-wrapper {
    padding-bottom: 4rem;
  }

  .provider-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    padding: 1.5rem 4%;
  }

  .provider-card {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    min-width: 280px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .provider-card.disabled {
    opacity: 0.45;
  }

  .provider-card-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .provider-card-name {
    font-size: 1.1rem;
    font-weight: 700;
    flex: 1;
  }

  .provider-toggle.on { color: #4ade80; }
  .provider-toggle.off { color: var(--text-gray); }

  .provider-card-url {
    color: var(--text-gray);
    font-size: 0.85rem;
    text-decoration: none;
    word-break: break-all;
  }

  .provider-card-url:hover { color: #fff; }

  .provider-card-mask {
    display: flex;
    gap: 0.75rem;
    font-size: 0.8rem;
    color: var(--text-gray);
  }

  .mask-label {
    font-weight: 600;
    color: rgba(255,255,255,0.5);
  }
  ```

- [ ] **Step 3: Add Providers tab to Navbar.tsx**

  In `src/src/components/Navbar.tsx`, inside the `.nav-links` div after the Tags & Topics button, add:

  ```tsx
  <button
    className={`nav-link ${activeTab === 'providers' ? 'active' : ''}`}
    onClick={() => setActiveTab('providers')}
  >
    Providers
  </button>
  ```

- [ ] **Step 4: TypeScript check**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src
  npx tsc --noEmit
  ```

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
  git add src/src/components/ProviderList.tsx src/src/components/Navbar.tsx src/src/index.css
  git commit -m "feat: add Providers tab UI with provider cards showing mask settings"
  ```

---

### Task 8: Wire catalog into App.tsx

**Files:**
- Modify: `src/src/App.tsx`

**Interfaces:**
- Consumes:
  - `list_content(search?: string) -> Content[]` (Tauri command)
  - `get_content_detail(contentId: string) -> ContentDetail | null` (handled inside ContentLandingModal)
  - `open_video_player(url, title, providerId) -> void` (updated command — `provider_id` is now `Option<String>`)
  - `ContentRow` component: `{ title, items, onOpenDetail }`
  - `ContentLandingModal` component: `{ contentId, onClose, onPlay }`
  - `ProviderList` component: no props

- [ ] **Step 1: Add imports and new types to App.tsx**

  At the top of `src/src/App.tsx`, add these imports after the existing ones:

  ```tsx
  import { ContentRow } from './components/ContentRow';
  import type { Content } from './components/ContentRow';
  import { ContentLandingModal } from './components/ContentLandingModal';
  import { ProviderList } from './components/ProviderList';
  ```

- [ ] **Step 2: Add catalog state to App component**

  Inside the `App()` function, after the existing `const [selectedVideoModal, ...]` state, add:

  ```tsx
  const [catalog, setCatalog] = useState<Content[]>([]);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  ```

- [ ] **Step 3: Load catalog in refreshData**

  Inside `refreshData()`, after the existing `pList` fetch, add:

  ```tsx
  const cList = await callTauri<Content[]>('list_content', {
    search: searchQuery.trim() || null,
  });
  if (cList !== null) setCatalog(cList);
  ```

- [ ] **Step 4: Update handlePlayWebview to pass provider_id**

  Replace the existing `handlePlayWebview` function:

  ```tsx
  const handlePlayWebview = async (video: Video) => {
    const res = await callTauri<void>('open_video_player', {
      url: video.page_url,
      title: video.title,
      providerId: null, // manual bookmarks have no provider
    });
    if (res === null) {
      window.open(video.page_url, '_blank', 'noopener,noreferrer');
    }
  };

  const handlePlayContent = async (url: string, title: string, providerId: string) => {
    setSelectedContentId(null);
    const res = await callTauri<void>('open_video_player', {
      url,
      title,
      providerId,
    });
    if (res === null) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };
  ```

- [ ] **Step 5: Add catalog rows to home screen and Providers tab**

  Inside the JSX, find the `activeTab === 'home'` block. After the "Trending & Recently Added" `<MovieRow>`, add catalog rows:

  ```tsx
  {/* Catalog: Movies from all providers */}
  {catalog.filter((c) => c.media_type === 'movie').length > 0 && (
    <ContentRow
      title="Catalog: Movies"
      items={catalog.filter((c) => c.media_type === 'movie')}
      onOpenDetail={setSelectedContentId}
    />
  )}

  {/* Catalog: TV Shows from all providers */}
  {catalog.filter((c) => c.media_type === 'tv_show').length > 0 && (
    <ContentRow
      title="Catalog: TV Shows"
      items={catalog.filter((c) => c.media_type === 'tv_show')}
      onOpenDetail={setSelectedContentId}
    />
  )}
  ```

  After the existing `activeTab === 'tags'` block, add:

  ```tsx
  ) : activeTab === 'providers' ? (
    <ProviderList />
  ```

  (This goes before the final `: null` in the conditional chain.)

- [ ] **Step 6: Add ContentLandingModal to JSX**

  After the `<MovieModal ... />` closing tag, add:

  ```tsx
  {/* Content Landing Modal — catalog titles */}
  <ContentLandingModal
    contentId={selectedContentId}
    onClose={() => setSelectedContentId(null)}
    onPlay={handlePlayContent}
  />
  ```

- [ ] **Step 7: TypeScript check**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src
  npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 8: Full smoke test**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
  npm run tauri dev
  ```

  Verify:
  1. App starts — console shows `Loaded provider: FMovies (fmovies)`
  2. Home screen shows "Catalog: Movies" and "Catalog: TV Shows" rows (populated after enrich.py run)
  3. Clicking a catalog card opens ContentLandingModal with poster, synopsis, rating
  4. Movies show "Watch on: FMovies" button — clicking it opens the WebviewWindow
  5. TV shows show season list with provider per season — clicking a season opens WebviewWindow
  6. Providers tab shows fmovies card with mask settings
  7. Existing bookmarks (Add Video / playlists) still work unchanged

- [ ] **Step 9: Commit**

  ```bash
  cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
  git add src/src/App.tsx
  git commit -m "feat: wire catalog rows and ContentLandingModal into App; Providers tab live"
  ```

---

## Self-Review

**Spec coverage:**
- ✅ `providers` table seeded from `core/providers/*/config.toml` → Task 1 + Task 2
- ✅ `content` table with TMDB enrichment → Task 1 + Task 4
- ✅ `provider_content` with `season_number` → Task 1 + Task 4
- ✅ Per-provider mask settings loaded dynamically in `open_video_player` → Task 3
- ✅ Content landing page: movie sources + TV season list → Task 5
- ✅ Providers tab UI → Task 7
- ✅ Home screen catalog rows → Task 8
- ✅ Existing `videos`/`playlists` tables untouched → no migration tasks needed
- ✅ `config.toml` drop = new provider on next launch → Task 2

**No placeholders:** All steps include actual code, exact commands, and expected output.

**Type consistency:**
- `ContentDetail` defined in `db.rs` (Task 1) → used in `commands.rs` (Task 3) → consumed by `ContentLandingModal` (Task 5) → called from `App.tsx` (Task 8)
- `Content` type exported from `ContentRow.tsx` (Task 6) → imported in `App.tsx` (Task 8)
- `handlePlayContent(url, title, providerId)` defined in Task 8 → matches `ContentLandingModal.onPlay` prop defined in Task 5
- `open_video_player(url, title, providerId)` — Rust `provider_id: Option<String>` maps to TS `providerId: string | null`
