# Episode List — Design Spec

**Goal:** Fetch, cache, and display a native episode list for TV show seasons inside `UniversalModal`, replacing direct season-URL webview navigation with a custom episode picker UI.

**Architecture:** Rust/reqwest scrapes the FMovies season page HTML on first open; episodes are cached in a new `episodes` SQLite table and loaded from cache on subsequent opens. The frontend displays an episode grid inside `UniversalModal` after season selection; clicking an episode plays it via the existing `open_video_player` webview command.

**Tech Stack:** Rust (`reqwest`, `scraper`), SQLite/sqlx, React 19/TypeScript, Tauri v2

---

## Global Constraints

- TypeScript strict mode — no `any`
- No new component files — all episode UI in `UniversalModal.tsx`
- Follow existing `.um-*` CSS class pattern in `index.css`
- Follow existing `callTauri<T>()` pattern for all Tauri calls
- `reqwest` must use a browser-like `User-Agent` header
- Scraping logic isolated in one function (`scrape_episodes`) — selectors are a one-line change
- Episode number parsed from URL path (`episode-N`) or text content; store `null` title if unparseable — display as "Episode N" in UI
- Cache is always checked first; network fetch only if cache empty or user clicks Refresh
- All new DB functions in `db.rs`, all new Tauri commands in `commands.rs`, registered in `lib.rs`

---

## Data Layer

### New `episodes` Table

```sql
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
```

**`id` format:** `"{provider_id}:{content_id}:s{season_number}:e{episode_number}"`

**`fetched_at`:** Unix timestamp (seconds). Used for optional future TTL-based refresh; not enforced in this spec — refresh is manual only.

### New DB Functions (`db.rs`)

```rust
pub async fn db_upsert_episodes(
    pool: &SqlitePool,
    episodes: &[Episode],
) -> sqlx::Result<()>

pub async fn db_get_episodes(
    pool: &SqlitePool,
    content_id: &str,
    provider_id: &str,
    season_number: i32,
) -> sqlx::Result<Vec<Episode>>
```

`Episode` struct (public, in `db.rs`):
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
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

`db_upsert_episodes` uses `INSERT OR REPLACE` for each episode (DELETE-then-INSERT per season to remove stale rows):
```sql
DELETE FROM episodes WHERE content_id = ?1 AND provider_id = ?2 AND season_number = ?3;
-- then for each episode:
INSERT INTO episodes (id, content_id, provider_id, season_number, episode_number, title, page_url, fetched_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);
```

---

## Scraping Logic (`commands.rs`)

### `scrape_episodes` (private helper)

```rust
fn scrape_episodes(
    html: &str,
    content_id: &str,
    provider_id: &str,
    season_number: i32,
    base_url: &str,
) -> Vec<db::Episode>
```

Uses `scraper` crate. Tries selectors in order, stops at first that yields results:
```rust
const EPISODE_SELECTORS: &[&str] = &[
    "ul.episodes a",
    ".ep-list a",
    ".episodes-list a",
    ".episodes a",
    "a[href*='episode']",
];
```

For each matched `<a>`:
- `href` → absolute episode URL (prepend `base_url` if relative)
- Text content → episode title (trimmed; `None` if empty)
- Episode number → parsed from URL path segment matching `episode-(\d+)`, fallback to parse from text

Skips any `<a>` where no episode number can be determined.

Returns `Vec<db::Episode>` sorted by `episode_number` ascending.

### `fetch_episodes` Tauri Command

```rust
#[tauri::command]
pub async fn fetch_episodes(
    state: tauri::State<'_, AppState>,
    content_id: String,
    provider_id: String,
    season_number: i32,
    season_url: String,
) -> Result<Vec<db::Episode>, String>
```

1. GET `season_url` with `reqwest` (header: `User-Agent: Mozilla/5.0 ...`)
2. Parse HTML with `scrape_episodes`
3. If no episodes found, return `Err("No episodes found")`
4. Call `db_upsert_episodes` to cache
5. Return episodes

### `get_cached_episodes` Tauri Command

```rust
#[tauri::command]
pub async fn get_cached_episodes(
    state: tauri::State<'_, AppState>,
    content_id: String,
    provider_id: String,
    season_number: i32,
) -> Result<Vec<db::Episode>, String>
```

Reads from DB only. Returns empty `Vec` if nothing cached.

---

## Frontend — `UniversalModal.tsx`

### New Type

```typescript
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

### New State

```typescript
const [selectedSeason, setSelectedSeason] = useState<ContentSource | null>(null);
const [episodes, setEpisodes] = useState<Episode[]>([]);
const [episodesLoading, setEpisodesLoading] = useState(false);
const [episodesError, setEpisodesError] = useState<string | null>(null);
```

Reset all four in the `useEffect` cleanup when `item` changes.

### Season Selection Flow

`handleSelectSeason(src: ContentSource)`:
1. Set `selectedSeason = src`, close season dropdown
2. Set `episodesLoading = true`, clear `episodesError`
3. Call `get_cached_episodes(content_id, provider_id, season_number)`
4. If result non-empty → set `episodes`, done
5. If empty → call `fetch_episodes(content_id, provider_id, season_number, season_url)`
6. On success → set `episodes`; on error → set `episodesError`
7. Set `episodesLoading = false`

`handleRefreshEpisodes()`:
- Same as step 5–7 above, always hits network regardless of cache

### Episode Grid (renders in `.um-body` when `selectedSeason !== null`)

```tsx
<div className="um-episodes-section">
  <div className="um-episodes-header">
    <span>Season {selectedSeason.season_number}</span>
    <button className="um-episodes-refresh" onClick={handleRefreshEpisodes}>
      <RefreshCw size={13} /> Refresh
    </button>
  </div>

  {episodesLoading && <div className="um-episodes-loading">Loading episodes…</div>}
  {episodesError && <div className="um-episodes-error">{episodesError}</div>}

  {!episodesLoading && episodes.length > 0 && (
    <div className="um-episode-grid">
      {episodes.map((ep) => (
        <button
          key={ep.id}
          className="um-episode-btn"
          onClick={() => handlePlayUrl(
            ep.page_url,
            `${item.data.title} S${ep.season_number}E${ep.episode_number}`,
            selectedSeason.provider_id,
          )}
        >
          <span className="um-episode-num">E{ep.episode_number}</span>
          {ep.title && <span className="um-episode-title">{ep.title}</span>}
        </button>
      ))}
    </div>
  )}
</div>
```

Imports to add: `RefreshCw` from `lucide-react`.

The existing "Choose Season" dropdown behavior changes: clicking a season calls `handleSelectSeason` instead of `handlePlayUrl` directly.

---

## CSS (`index.css`)

```css
.um-episodes-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255,255,255,0.08);
}

.um-episodes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 13px;
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
.um-episodes-refresh:hover { color: var(--netflix-red); }

.um-episode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 6px;
}

.um-episode-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 6px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  color: inherit;
  text-align: center;
}
.um-episode-btn:hover {
  background: rgba(255,255,255,0.1);
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
.um-episodes-error { color: #e53e3e; }
```

---

## Cargo.toml Additions

```toml
reqwest = { version = "0.12", features = ["json"] }
scraper = "0.20"
```

`reqwest` must be used with `tokio` async (already present in the project).

---

## File Change Summary

| File | Action |
|---|---|
| `src-tauri/Cargo.toml` | Add `reqwest`, `scraper` dependencies |
| `src-tauri/src/db.rs` | Add `Episode` struct, `episodes` table in `init_db`, `db_upsert_episodes`, `db_get_episodes` |
| `src-tauri/src/commands.rs` | Add `scrape_episodes` helper, `fetch_episodes` command, `get_cached_episodes` command |
| `src-tauri/src/lib.rs` | Register `fetch_episodes`, `get_cached_episodes` in `invoke_handler` |
| `src/src/components/UniversalModal.tsx` | Add `Episode` type, new state, `handleSelectSeason`, `handleRefreshEpisodes`, episode grid JSX, update season dropdown to call `handleSelectSeason` |
| `src/src/index.css` | Append `.um-episodes-*` CSS classes |
