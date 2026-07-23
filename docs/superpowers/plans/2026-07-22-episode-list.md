# Episode List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch, cache, and display a native episode list inside `UniversalModal` for TV show seasons, replacing direct season-URL webview navigation with a custom episode picker UI.

**Architecture:** Rust/reqwest scrapes the FMovies season page HTML on first open; the `scraper` crate parses episode links using a cascade of CSS selectors; episodes are cached in a new `episodes` SQLite table and loaded from cache on subsequent opens. The frontend displays an episode grid in `UniversalModal` after season selection; clicking an episode plays it via the existing `open_video_player` command.

**Tech Stack:** Rust (`reqwest 0.12`, `scraper 0.20`), SQLite/sqlx 0.7, React 19/TypeScript, Tauri v2, lucide-react

## Global Constraints

- TypeScript strict mode — no `any`
- No new component files — all episode UI stays in `UniversalModal.tsx`
- Follow existing `.um-*` CSS class pattern in `index.css`
- Use local `callTauri<T>()` pattern for all Tauri calls (defined at top of `UniversalModal.tsx`)
- `reqwest` must be added with `default-features = false, features = ["rustls-tls"]` to avoid TLS conflicts with sqlx's rustls runtime
- Episode id format: `"{provider_id}:{content_id}:s{season_number}:e{episode_number}"`
- `scrape_episodes` is a **sync** private `fn` in `commands.rs` — not async
- Cache-first: call `get_cached_episodes` first; only call `fetch_episodes` if cache is empty or user clicks Refresh
- All new DB functions in `db.rs`, all new Tauri commands in `commands.rs`, registered in `lib.rs`
- Build test for Rust: `cd src-tauri && cargo build` — must compile with zero errors
- Build test for TypeScript: `cd src && npm run build` — must compile with zero errors

---

## File Change Map

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/Cargo.toml` | Modify | Add `reqwest` and `scraper` deps |
| `src-tauri/src/db.rs` | Modify | `Episode` struct, `episodes` table, `db_upsert_episodes`, `db_get_episodes` |
| `src-tauri/src/commands.rs` | Modify | `scrape_episodes` helper, `fetch_episodes` command, `get_cached_episodes` command |
| `src-tauri/src/lib.rs` | Modify | Register `fetch_episodes` and `get_cached_episodes` in `invoke_handler` |
| `src/src/components/UniversalModal.tsx` | Modify | `Episode` type, new state, season/episode handlers, episode grid JSX |
| `src/src/index.css` | Modify | Append `.um-episodes-*` CSS classes |

---

### Task 1: DB Schema — `episodes` table and db functions

**Files:**
- Modify: `src-tauri/src/db.rs`

**Interfaces:**
- Produces:
  - `pub struct Episode` (public, in `db.rs`)
  - `pub async fn db_upsert_episodes(pool: &SqlitePool, episodes: &[Episode]) -> sqlx::Result<()>`
  - `pub async fn db_get_episodes(pool: &SqlitePool, content_id: &str, provider_id: &str, season_number: i32) -> sqlx::Result<Vec<Episode>>`

- [ ] **Step 1: Add `Episode` struct to `db.rs`**

Open `src-tauri/src/db.rs`. After the `ContentDetail` struct (currently around line 62), add:

```rust
#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct Episode {
    pub id: String,
    pub content_id: String,
    pub provider_id: String,
    pub season_number: i32,
    pub episode_number: i32,
    pub title: Option<String>,
    pub page_url: String,
    pub fetched_at: i64,
}
```

- [ ] **Step 2: Add `episodes` table to `init_db()`**

In `src-tauri/src/db.rs`, inside `pub async fn init_db()`, after the `content_playlists` block (currently the last `sqlx::query(...)` before `Ok(pool)`), add:

```rust
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS episodes (
            id             TEXT PRIMARY KEY,
            content_id     TEXT NOT NULL REFERENCES content(id),
            provider_id    TEXT NOT NULL,
            season_number  INTEGER NOT NULL,
            episode_number INTEGER NOT NULL,
            title          TEXT,
            page_url       TEXT NOT NULL,
            fetched_at     INTEGER NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;
```

- [ ] **Step 3: Add `db_upsert_episodes` function**

At the end of `src-tauri/src/db.rs`, append:

```rust
pub async fn db_upsert_episodes(
    pool: &SqlitePool,
    episodes: &[Episode],
) -> sqlx::Result<()> {
    if episodes.is_empty() {
        return Ok(());
    }
    let first = &episodes[0];
    let mut tx = pool.begin().await?;
    sqlx::query(
        "DELETE FROM episodes WHERE content_id = ?1 AND provider_id = ?2 AND season_number = ?3",
    )
    .bind(&first.content_id)
    .bind(&first.provider_id)
    .bind(first.season_number)
    .execute(&mut *tx)
    .await?;
    for ep in episodes {
        sqlx::query(
            r#"
            INSERT INTO episodes
                (id, content_id, provider_id, season_number, episode_number, title, page_url, fetched_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
        )
        .bind(&ep.id)
        .bind(&ep.content_id)
        .bind(&ep.provider_id)
        .bind(ep.season_number)
        .bind(ep.episode_number)
        .bind(&ep.title)
        .bind(&ep.page_url)
        .bind(ep.fetched_at)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
```

- [ ] **Step 4: Add `db_get_episodes` function**

Immediately after `db_upsert_episodes`, append:

```rust
pub async fn db_get_episodes(
    pool: &SqlitePool,
    content_id: &str,
    provider_id: &str,
    season_number: i32,
) -> sqlx::Result<Vec<Episode>> {
    sqlx::query_as::<_, Episode>(
        r#"
        SELECT id, content_id, provider_id, season_number, episode_number, title, page_url, fetched_at
        FROM episodes
        WHERE content_id = ?1 AND provider_id = ?2 AND season_number = ?3
        ORDER BY episode_number ASC
        "#,
    )
    .bind(content_id)
    .bind(provider_id)
    .bind(season_number)
    .fetch_all(pool)
    .await
}
```

- [ ] **Step 5: Build to verify**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src-tauri
cargo build 2>&1 | tail -5
```

Expected: `Finished` with zero errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
git add src-tauri/src/db.rs
git commit -m "feat: add episodes table and db_upsert/get_episodes functions"
```

---

### Task 2: Rust commands — `fetch_episodes` and `get_cached_episodes`

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes (from Task 1):
  - `db::Episode`
  - `db_upsert_episodes(&state.db, &episodes)`
  - `db_get_episodes(&state.db, &content_id, &provider_id, season_number)`
- Produces:
  - `pub async fn fetch_episodes(state, content_id: String, provider_id: String, season_number: i32, season_url: String) -> Result<Vec<db::Episode>, String>`
  - `pub async fn get_cached_episodes(state, content_id: String, provider_id: String, season_number: i32) -> Result<Vec<db::Episode>, String>`

- [ ] **Step 1: Add `reqwest` and `scraper` to `Cargo.toml`**

Open `src-tauri/Cargo.toml`. After the `toml = "0.8"` line, add:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
scraper = "0.20"
```

- [ ] **Step 2: Add `scraper` import to `commands.rs`**

Open `src-tauri/src/commands.rs`. At the top, the existing imports are:

```rust
use tauri::Manager;
use crate::AppState;
use crate::db::{
    Video, Playlist,
    db_add_video,
    ...
    db_set_content_playlist,
    db_get_content_playlist,
};
use crate::db;
```

Add `scraper` import after the existing `use` lines (after `use crate::db;`):

```rust
use scraper::{Html, Selector};
```

Also extend the named `crate::db` import block to include the new functions:

```rust
use crate::db::{
    Video, Playlist,
    db_add_video,
    db_list_videos,
    db_get_video,
    db_delete_video,
    db_list_playlists,
    db_create_playlist,
    db_delete_playlist,
    db_set_video_playlist,
    db_update_video_cover,
    db_update_content_cover,
    db_list_recent_content,
    db_list_content_by_genre,
    db_set_content_playlist,
    db_get_content_playlist,
    db_upsert_episodes,
    db_get_episodes,
};
use crate::db;
use scraper::{Html, Selector};
```

- [ ] **Step 3: Add `scrape_episodes` private helper**

At the end of `src-tauri/src/commands.rs`, append this private sync function:

```rust
fn scrape_episodes(
    html: &str,
    content_id: &str,
    provider_id: &str,
    season_number: i32,
    base_url: &str,
) -> Vec<crate::db::Episode> {
    let document = Html::parse_document(html);
    let now = chrono::Utc::now().timestamp();

    const SELECTORS: &[&str] = &[
        "ul.episodes a",
        ".ep-list a",
        ".episodes-list a",
        ".episodes a",
        "a[href*='episode']",
    ];

    for sel_str in SELECTORS {
        let Ok(selector) = Selector::parse(sel_str) else {
            continue;
        };
        let links: Vec<_> = document.select(&selector).collect();
        if links.is_empty() {
            continue;
        }

        let mut episodes: Vec<crate::db::Episode> = links
            .iter()
            .filter_map(|el| {
                let href = el.value().attr("href")?;
                // Parse episode number from URL path segment "episode-N"
                let episode_number = href.split('/').find_map(|seg| {
                    seg.strip_prefix("episode-")
                        .and_then(|n| n.parse::<i32>().ok())
                })?;
                // Build absolute URL
                let page_url = if href.starts_with("http") {
                    href.to_string()
                } else {
                    format!(
                        "{}/{}",
                        base_url.trim_end_matches('/'),
                        href.trim_start_matches('/')
                    )
                };
                // Extract title text
                let text = el.text().collect::<String>();
                let text = text.trim().to_string();
                let title = if text.is_empty() { None } else { Some(text) };

                let id = format!(
                    "{}:{}:s{}:e{}",
                    provider_id, content_id, season_number, episode_number
                );

                Some(crate::db::Episode {
                    id,
                    content_id: content_id.to_string(),
                    provider_id: provider_id.to_string(),
                    season_number,
                    episode_number,
                    title,
                    page_url,
                    fetched_at: now,
                })
            })
            .collect();

        if !episodes.is_empty() {
            episodes.sort_by_key(|ep| ep.episode_number);
            episodes.dedup_by_key(|ep| ep.episode_number);
            return episodes;
        }
    }

    vec![]
}
```

- [ ] **Step 4: Add `fetch_episodes` Tauri command**

Immediately after `scrape_episodes`, append:

```rust
#[tauri::command]
pub async fn fetch_episodes(
    state: tauri::State<'_, AppState>,
    content_id: String,
    provider_id: String,
    season_number: i32,
    season_url: String,
) -> Result<Vec<crate::db::Episode>, String> {
    let client = reqwest::Client::new();
    let html = client
        .get(&season_url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
             AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/120.0.0.0 Safari/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("Fetch failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Body read failed: {}", e))?;

    // Extract scheme://host for resolving relative hrefs
    let base_url = if let Some(rest) = season_url.strip_prefix("https://") {
        let host = rest.split('/').next().unwrap_or("");
        format!("https://{}", host)
    } else if let Some(rest) = season_url.strip_prefix("http://") {
        let host = rest.split('/').next().unwrap_or("");
        format!("http://{}", host)
    } else {
        String::new()
    };

    let episodes = scrape_episodes(&html, &content_id, &provider_id, season_number, &base_url);

    if episodes.is_empty() {
        return Err("No episodes found — site structure may have changed".to_string());
    }

    db_upsert_episodes(&state.db, &episodes)
        .await
        .map_err(|e| format!("DB error: {}", e))?;

    Ok(episodes)
}
```

- [ ] **Step 5: Add `get_cached_episodes` Tauri command**

Immediately after `fetch_episodes`, append:

```rust
#[tauri::command]
pub async fn get_cached_episodes(
    state: tauri::State<'_, AppState>,
    content_id: String,
    provider_id: String,
    season_number: i32,
) -> Result<Vec<crate::db::Episode>, String> {
    db_get_episodes(&state.db, &content_id, &provider_id, season_number)
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 6: Register commands in `lib.rs`**

Open `src-tauri/src/lib.rs`. In `invoke_handler`, add the two new commands after `commands::get_content_playlist`:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::add_video,
            commands::list_videos,
            commands::get_video,
            commands::delete_video,
            commands::list_playlists,
            commands::create_playlist,
            commands::delete_playlist,
            commands::set_video_playlist,
            commands::open_video_player,
            commands::close_video_player,
            commands::list_providers,
            commands::list_content,
            commands::get_content_detail,
            commands::update_video_cover,
            commands::update_content_cover,
            commands::list_recent_content,
            commands::list_content_by_genre,
            commands::open_in_browser,
            commands::set_content_playlist,
            commands::get_content_playlist,
            commands::fetch_episodes,
            commands::get_cached_episodes,
        ])
```

- [ ] **Step 7: Build to verify**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src-tauri
cargo build 2>&1 | tail -10
```

Expected: `Finished` with zero errors. If `reqwest` or `scraper` fail to resolve, run `cargo update` first.

- [ ] **Step 8: Commit**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
git add src-tauri/Cargo.toml src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add fetch_episodes and get_cached_episodes Tauri commands"
```

---

### Task 3: Frontend — Episode UI in `UniversalModal`

**Files:**
- Modify: `src/src/components/UniversalModal.tsx`
- Modify: `src/src/index.css`

**Interfaces:**
- Consumes (from Tasks 1–2):
  - Tauri command `get_cached_episodes(contentId, providerId, seasonNumber)` → `Episode[]`
  - Tauri command `fetch_episodes(contentId, providerId, seasonNumber, seasonUrl)` → `Episode[]`
- Produces: Episode grid UI rendered in `UniversalModal` when a season is selected

- [ ] **Step 1: Add `RefreshCw` to lucide import**

Open `src/src/components/UniversalModal.tsx`. Line 2 currently reads:

```tsx
import { X, Play, ExternalLink, Trash2, Pencil, Star, Tv, Film, ChevronDown, ListPlus } from 'lucide-react';
```

Change it to:

```tsx
import { X, Play, ExternalLink, Trash2, Pencil, Star, Tv, Film, ChevronDown, ListPlus, RefreshCw } from 'lucide-react';
```

- [ ] **Step 2: Add `Episode` interface**

After line 11 (`  season_number?: number | null;`) and before `export type ModalItem`, add:

```tsx
interface Episode {
  id: string;
  content_id: string;
  provider_id: string;
  season_number: number;
  episode_number: number;
  title: string | null;
  page_url: string;
  fetched_at: number;
}
```

- [ ] **Step 3: Add new state variables**

In the component body, after the existing state declarations (after `setPlaylistDropdownOpen`), add:

```tsx
  const [selectedSeason, setSelectedSeason] = useState<ContentSource | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
```

- [ ] **Step 4: Reset new state in `useEffect`**

The existing `useEffect` body starts with resets. Add four resets after `setPlaylistDropdownOpen(false)`:

```tsx
    setSelectedSeason(null);
    setEpisodes([]);
    setEpisodesLoading(false);
    setEpisodesError(null);
```

- [ ] **Step 5: Add `handleSelectSeason` function**

After the existing `handleSetPlaylist` function, add:

```tsx
  const loadEpisodes = async (src: ContentSource) => {
    if (!isContent) return;
    setEpisodesLoading(true);
    setEpisodesError(null);
    const cached = await callTauri<Episode[]>('get_cached_episodes', {
      contentId: item.data.id,
      providerId: src.provider_id,
      seasonNumber: src.season_number ?? 1,
    });
    if (cached && cached.length > 0) {
      setEpisodes(cached);
      setEpisodesLoading(false);
      return;
    }
    const fetched = await callTauri<Episode[]>('fetch_episodes', {
      contentId: item.data.id,
      providerId: src.provider_id,
      seasonNumber: src.season_number ?? 1,
      seasonUrl: src.page_url,
    });
    if (fetched && fetched.length > 0) {
      setEpisodes(fetched);
    } else {
      setEpisodesError('No episodes found — try refreshing or check the site.');
    }
    setEpisodesLoading(false);
  };

  const handleSelectSeason = (src: ContentSource) => {
    setSelectedSeason(src);
    setSeasonDropdownOpen(false);
    setEpisodes([]);
    loadEpisodes(src);
  };

  const handleRefreshEpisodes = async () => {
    if (!selectedSeason || !isContent) return;
    setEpisodesLoading(true);
    setEpisodesError(null);
    const fetched = await callTauri<Episode[]>('fetch_episodes', {
      contentId: item.data.id,
      providerId: selectedSeason.provider_id,
      seasonNumber: selectedSeason.season_number ?? 1,
      seasonUrl: selectedSeason.page_url,
    });
    if (fetched && fetched.length > 0) {
      setEpisodes(fetched);
    } else {
      setEpisodesError('No episodes found — site structure may have changed.');
    }
    setEpisodesLoading(false);
  };
```

- [ ] **Step 6: Change season dropdown items to call `handleSelectSeason`**

Find the TV season dropdown section. It currently looks like this (inside `{isContent && isTV && ...}`):

```tsx
                        item.sources.map((src) => {
                          const label = src.season_number != null
                            ? `${item.data.title} S${src.season_number}`
                            : item.data.title;
                          return (
                            <button
                              key={`${src.provider_id}-${src.season_number}`}
                              className="um-dropdown-item"
                              onClick={() => {
                                setSeasonDropdownOpen(false);
                                handlePlayUrl(src.page_url, label, src.provider_id);
                              }}
                            >
```

Replace the `onClick` handler only — change it to call `handleSelectSeason`:

```tsx
                              onClick={() => handleSelectSeason(src)}
```

The full updated map block:

```tsx
                        item.sources.map((src) => {
                          const label = src.season_number != null
                            ? `${item.data.title} S${src.season_number}`
                            : item.data.title;
                          return (
                            <button
                              key={`${src.provider_id}-${src.season_number}`}
                              className="um-dropdown-item"
                              onClick={() => handleSelectSeason(src)}
                            >
                              <span>{src.season_number != null ? `Season ${src.season_number}` : 'Full Series'}</span>
                              <span className="um-dropdown-sub">{src.provider_name}</span>
                            </button>
                          );
                        })
```

- [ ] **Step 7: Add episode grid JSX in `.um-body`**

Find the `.um-body` div. It currently contains:

```tsx
        <div className="um-body">
          {isContent && item.data.synopsis && (
            <p className="um-synopsis">{item.data.synopsis}</p>
          )}
          {isVideo && (
            ...
          )}
        </div>
```

Add the episode section between the synopsis paragraph and the `{isVideo && ...}` block:

```tsx
        <div className="um-body">
          {isContent && item.data.synopsis && (
            <p className="um-synopsis">{item.data.synopsis}</p>
          )}

          {isContent && isTV && selectedSeason && (
            <div className="um-episodes-section">
              <div className="um-episodes-header">
                <span>
                  Season {selectedSeason.season_number ?? 1}
                  {' · '}{selectedSeason.provider_name}
                </span>
                <button className="um-episodes-refresh" onClick={handleRefreshEpisodes}>
                  <RefreshCw size={12} />
                  Refresh
                </button>
              </div>

              {episodesLoading && (
                <div className="um-episodes-loading">Loading episodes…</div>
              )}

              {episodesError && !episodesLoading && (
                <div className="um-episodes-error">{episodesError}</div>
              )}

              {!episodesLoading && episodes.length > 0 && (
                <div className="um-episode-grid">
                  {episodes.map((ep) => (
                    <button
                      key={ep.id}
                      className="um-episode-btn"
                      onClick={() =>
                        handlePlayUrl(
                          ep.page_url,
                          `${item.data.title} S${ep.season_number}E${ep.episode_number}`,
                          selectedSeason.provider_id,
                        )
                      }
                    >
                      <span className="um-episode-num">E{ep.episode_number}</span>
                      {ep.title && (
                        <span className="um-episode-title">{ep.title}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {isVideo && (
```

- [ ] **Step 8: Append episode CSS to `index.css`**

Open `src/src/index.css`. At the very end of the file, append:

```css
/* ── Episode List ─────────────────────────────────────────── */
.um-episodes-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.um-episodes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-gray);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.um-episodes-refresh {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-gray);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.15s;
}

.um-episodes-refresh:hover {
  color: var(--netflix-red);
}

.um-episode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
}

.um-episode-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 4px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  color: inherit;
  text-align: center;
  min-width: 0;
}

.um-episode-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--netflix-red);
}

.um-episode-num {
  font-size: 13px;
  font-weight: 700;
  color: var(--netflix-red);
}

.um-episode-title {
  font-size: 10px;
  color: var(--text-gray);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.um-episodes-loading,
.um-episodes-error {
  font-size: 12px;
  color: var(--text-gray);
  padding: 8px 0;
}

.um-episodes-error {
  color: #e53e3e;
}
```

- [ ] **Step 9: TypeScript build check**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src
npm run build 2>&1 | tail -10
```

Expected: `built in` with zero TypeScript errors.

- [ ] **Step 10: Commit**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
git add src/src/components/UniversalModal.tsx src/src/index.css
git commit -m "feat: add episode list UI to UniversalModal with season select and episode grid"
```
