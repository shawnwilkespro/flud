# Universal Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `MovieModal` and `ContentLandingModal` with a single `UniversalModal` that handles both catalog titles and video bookmarks with a cinematic full-bleed hero layout and unified playlist support.

**Architecture:** A discriminated union `ModalItem` type routes to content-specific render paths inside one component. The modal owns all its Tauri calls (cover edits, playlist assignment, playback routing) and notifies the parent via lightweight callbacks. App.tsx collapses two modal states into one.

**Tech Stack:** React 19, TypeScript strict, Tauri v2 (Rust), SQLite via sqlx, Lucide icons, CSS custom properties (no Tailwind in modal CSS)

## Global Constraints

- TypeScript strict mode — no `any`
- No inline `style` objects except for dynamic values (e.g. `backgroundImage`)
- Existing CSS custom properties: `--netflix-dark-card`, `--netflix-red`, `--text-gray`
- Existing utility classes to reuse: `netflix-modal-backdrop`, `modal-close-btn`, `btn-modal-play`, `btn-modal-external`, `btn-modal-delete`, `modal-select`, `modal-link`, `modal-tags-container`, `modal-tags-list`, `modal-tag-chip`, `modal-section-label`, `rating-pill`, `genre-pill`
- `callTauri<T>()` pattern must be copied verbatim (not imported) into `UniversalModal.tsx` — it's defined locally in each component
- FMovies detection: `provider_name.toLowerCase().includes('fmovies')`
- FMovies content → `open_in_browser`; all other providers → `open_video_player`; bookmarks always → `open_video_player`
- `↗` button always calls `open_in_browser`
- Deduplicate movie providers by `provider_id`, keep first URL

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src-tauri/src/db.rs` | Modify | Add `content_playlists` table, `db_set_content_playlist`, `db_get_content_playlist` |
| `src-tauri/src/commands.rs` | Modify | Add `set_content_playlist`, `get_content_playlist` commands |
| `src-tauri/src/lib.rs` | Modify | Register two new commands in invoke handler |
| `src/src/components/UniversalModal.tsx` | Create | New unified modal component |
| `src/src/index.css` | Modify | Add `.um-*` CSS classes for cinematic layout |
| `src/src/App.tsx` | Modify | Swap two modal states → one `modalItem`, replace modal renders |
| `src/src/components/MovieModal.tsx` | Delete | Replaced by UniversalModal |
| `src/src/components/ContentLandingModal.tsx` | Delete | Replaced by UniversalModal |

---

### Task 1: DB schema + Rust functions

**Files:**
- Modify: `src-tauri/src/db.rs`

**Interfaces:**
- Produces: `pub async fn db_set_content_playlist(pool, content_id, playlist_id: Option<&str>) -> sqlx::Result<()>`
- Produces: `pub async fn db_get_content_playlist(pool, content_id) -> sqlx::Result<Option<String>>`

- [ ] **Step 1: Add `content_playlists` table to `init_db`**

In `src-tauri/src/db.rs`, after the `provider_content` table creation (after line 168), add:

```rust
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS content_playlists (
            content_id  TEXT NOT NULL REFERENCES content(id),
            playlist_id TEXT NOT NULL REFERENCES playlists(id),
            PRIMARY KEY (content_id, playlist_id)
        );
        "#,
    )
    .execute(&pool)
    .await?;
```

- [ ] **Step 2: Add `db_set_content_playlist` function**

Append at the end of `src-tauri/src/db.rs`:

```rust
pub async fn db_set_content_playlist(
    pool: &SqlitePool,
    content_id: &str,
    playlist_id: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM content_playlists WHERE content_id = ?1")
        .bind(content_id)
        .execute(pool)
        .await?;
    if let Some(pid) = playlist_id {
        sqlx::query(
            "INSERT INTO content_playlists (content_id, playlist_id) VALUES (?1, ?2)",
        )
        .bind(content_id)
        .bind(pid)
        .execute(pool)
        .await?;
    }
    Ok(())
}
```

- [ ] **Step 3: Add `db_get_content_playlist` function**

Append immediately after `db_set_content_playlist`:

```rust
pub async fn db_get_content_playlist(
    pool: &SqlitePool,
    content_id: &str,
) -> sqlx::Result<Option<String>> {
    let row = sqlx::query_as::<_, (String,)>(
        "SELECT playlist_id FROM content_playlists WHERE content_id = ?1 LIMIT 1",
    )
    .bind(content_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(pid,)| pid))
}
```

- [ ] **Step 4: Verify the Rust compiles**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src-tauri
cargo check 2>&1 | tail -20
```

Expected: `Finished` with no errors. Fix any compile errors before proceeding.

- [ ] **Step 5: Commit**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
git add src-tauri/src/db.rs
git commit -m "feat: add content_playlists table and db_set/get_content_playlist functions"
```

---

### Task 2: Rust commands + registration

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `db_set_content_playlist`, `db_get_content_playlist` from Task 1
- Produces Tauri command `set_content_playlist(content_id: String, playlist_id: Option<String>)`
- Produces Tauri command `get_content_playlist(content_id: String) -> Option<String>`

- [ ] **Step 1: Add imports for new DB functions in `commands.rs`**

Find the existing import block at the top of `src-tauri/src/commands.rs` (lines 1-18). Add the two new functions to the `use crate::db::{...}` block:

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
};
```

- [ ] **Step 2: Add `set_content_playlist` command**

Append to the end of `src-tauri/src/commands.rs` (after the `open_in_browser` command, line 591):

```rust
#[tauri::command]
pub async fn set_content_playlist(
    state: tauri::State<'_, AppState>,
    content_id: String,
    playlist_id: Option<String>,
) -> Result<(), String> {
    db_set_content_playlist(&state.db, &content_id, playlist_id.as_deref())
        .await
        .map_err(|e| format!("Set content playlist failed: {}", e))
}

#[tauri::command]
pub async fn get_content_playlist(
    state: tauri::State<'_, AppState>,
    content_id: String,
) -> Result<Option<String>, String> {
    db_get_content_playlist(&state.db, &content_id)
        .await
        .map_err(|e| format!("Get content playlist failed: {}", e))
}
```

- [ ] **Step 3: Register commands in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `invoke_handler` block (lines 35-54). Add the two new commands after `commands::open_in_browser`:

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
        ])
```

- [ ] **Step 4: Verify compile**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src-tauri
cargo check 2>&1 | tail -20
```

Expected: `Finished` with no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add set_content_playlist and get_content_playlist Tauri commands"
```

---

### Task 3: UniversalModal component + CSS

**Files:**
- Create: `src/src/components/UniversalModal.tsx`
- Modify: `src/src/index.css`

**Interfaces:**
- Consumes: `Content` from `./ContentRow`, `Video` and `Playlist` from `../App`
- Produces: `export type ModalItem = { kind: 'content'; data: Content; sources: ContentSource[] } | { kind: 'video'; data: Video }`
- Produces: `export const UniversalModal: React.FC<UniversalModalProps>`
- Tauri commands called internally: `get_content_playlist`, `set_content_playlist`, `set_video_playlist`, `update_content_cover`, `update_video_cover`, `open_in_browser`, `open_video_player`

- [ ] **Step 1: Create `UniversalModal.tsx`**

Create `/Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src/src/components/UniversalModal.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { X, Play, ExternalLink, Trash2, Pencil, Star, Tv, Film, ChevronDown, ListPlus } from 'lucide-react';
import type { Content } from './ContentRow';
import type { Video, Playlist } from '../App';

interface ContentSource {
  provider_id: string;
  provider_name: string;
  page_url: string;
  season_number?: number | null;
}

export type ModalItem =
  | { kind: 'content'; data: Content; sources: ContentSource[] }
  | { kind: 'video'; data: Video }

interface UniversalModalProps {
  item: ModalItem | null;
  playlists: Playlist[];
  onClose: () => void;
  onContentUpdated?: (contentId: string) => Promise<void>;
  onVideoUpdated?: (videoId: string) => Promise<void>;
  onDeleteVideo: (id: string) => void;
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

export const UniversalModal: React.FC<UniversalModalProps> = ({
  item,
  playlists,
  onClose,
  onContentUpdated,
  onVideoUpdated,
  onDeleteVideo,
}) => {
  const [editingCover, setEditingCover] = useState(false);
  const [coverInput, setCoverInput] = useState('');
  const [localCoverUrl, setLocalCoverUrl] = useState<string | null | undefined>(undefined);
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState(false);
  const [playlistDropdownOpen, setPlaylistDropdownOpen] = useState(false);

  useEffect(() => {
    if (!item) return;
    setEditingCover(false);
    setCoverInput('');
    setLocalCoverUrl(undefined);
    setSeasonDropdownOpen(false);
    setPlaylistDropdownOpen(false);

    if (item.kind === 'video') {
      setPlaylistId(item.data.playlist_id ?? null);
    } else {
      callTauri<string | null>('get_content_playlist', { contentId: item.data.id }).then((pid) => {
        setPlaylistId(pid ?? null);
      });
    }
  }, [item]);

  if (!item) return null;

  const isContent = item.kind === 'content';
  const isVideo = item.kind === 'video';
  const isTV = isContent && item.data.media_type === 'tv_show';

  const rawCoverUrl = isContent
    ? (item.data.cover_url_override ?? item.data.poster_url ?? null)
    : (item.data.cover_url ?? null);
  const effectiveCoverUrl = localCoverUrl !== undefined ? localCoverUrl : rawCoverUrl;

  // Deduplicate movie providers by provider_id, keeping first URL per provider
  const uniqueProviders = isContent && !isTV
    ? (() => {
        const seen = new Set<string>();
        return item.sources.filter((src) => {
          if (seen.has(src.provider_id)) return false;
          seen.add(src.provider_id);
          return true;
        });
      })()
    : [];

  const genres: string[] = isContent
    ? (() => { try { return JSON.parse(item.data.genres ?? '[]') as string[]; } catch { return []; } })()
    : [];

  const handleSaveCover = async () => {
    const val = coverInput.trim() || null;
    if (isContent) {
      await callTauri<void>('update_content_cover', { id: item.data.id, coverUrlOverride: val });
      setLocalCoverUrl(val);
      setEditingCover(false);
      if (onContentUpdated) await onContentUpdated(item.data.id);
    } else {
      await callTauri<void>('update_video_cover', { id: item.data.id, coverUrl: val ?? '' });
      setLocalCoverUrl(val);
      setEditingCover(false);
      if (onVideoUpdated) await onVideoUpdated(item.data.id);
    }
  };

  const handleSetPlaylist = async (pid: string | null) => {
    setPlaylistId(pid);
    setPlaylistDropdownOpen(false);
    if (isContent) {
      await callTauri<void>('set_content_playlist', { contentId: item.data.id, playlistId: pid });
      if (onContentUpdated) await onContentUpdated(item.data.id);
    } else {
      await callTauri<void>('set_video_playlist', { videoId: item.data.id, playlistId: pid });
      if (onVideoUpdated) await onVideoUpdated(item.data.id);
    }
  };

  const handlePlayUrl = async (url: string, label: string, providerId: string | null, isFMovies: boolean) => {
    if (isFMovies) {
      await callTauri<void>('open_in_browser', { url });
    } else {
      const res = await callTauri<void>('open_video_player', { url, title: label, providerId });
      if (res === null) window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleExternalLink = async () => {
    const url = isContent ? (item.sources[0]?.page_url ?? '') : item.data.page_url;
    await callTauri<void>('open_in_browser', { url });
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const currentPlaylistName = playlists.find((pl) => pl.id === playlistId)?.name ?? null;

  return (
    <div
      className="netflix-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="um-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>

        {/* Hero — blurred backdrop */}
        <div className="um-hero">
          {effectiveCoverUrl ? (
            <div
              className="um-hero-bg"
              style={{ backgroundImage: `url(${effectiveCoverUrl})` }}
            />
          ) : (
            <div className="um-hero-bg um-hero-bg--gradient" />
          )}
          <div className="um-hero-fade" />
        </div>

        {/* Info row: poster + meta */}
        <div className="um-info-row">
          {/* Poster area */}
          <div className="um-poster-wrapper">
            {editingCover ? (
              <div className="um-cover-editor">
                <p className="um-cover-editor-label">Cover image URL:</p>
                <input
                  className="modal-select"
                  type="text"
                  value={coverInput}
                  onChange={(e) => setCoverInput(e.target.value)}
                  placeholder="https://..."
                  autoFocus
                />
                <div className="um-cover-editor-actions">
                  <button
                    className="btn-netflix-primary"
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.8rem' }}
                    onClick={handleSaveCover}
                  >
                    Save
                  </button>
                  <button
                    className="btn-netflix-secondary"
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.8rem' }}
                    onClick={() => setEditingCover(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="um-poster"
                onClick={() => { setCoverInput(effectiveCoverUrl ?? ''); setEditingCover(true); }}
                title="Click to change cover image"
              >
                {effectiveCoverUrl ? (
                  <img src={effectiveCoverUrl} alt={item.data.title} />
                ) : (
                  <div className="um-poster-fallback">
                    {isTV ? <Tv size={36} /> : <Film size={36} />}
                  </div>
                )}
                <div className="um-poster-overlay">
                  <Pencil size={22} />
                </div>
              </div>
            )}
          </div>

          {/* Title + meta + actions */}
          <div className="um-meta">
            <h2 className="um-title">{item.data.title}</h2>

            <div className="um-meta-row">
              {isContent && item.data.year && <span>{item.data.year}</span>}
              {isContent && item.data.rating && (
                <span className="rating-pill">
                  <Star size={12} fill="currentColor" />
                  {item.data.rating.toFixed(1)}
                </span>
              )}
              {genres.slice(0, 3).map((g) => (
                <span key={g} className="genre-pill">{g}</span>
              ))}
            </div>

            {/* Action bar */}
            <div className="um-actions">
              {/* Catalog movie: one button per unique provider */}
              {isContent && !isTV && uniqueProviders.map((src) => {
                const isFMovies = src.provider_name.toLowerCase().includes('fmovies');
                return (
                  <button
                    key={src.provider_id}
                    className="btn-modal-play"
                    onClick={() => handlePlayUrl(src.page_url, item.data.title, src.provider_id, isFMovies)}
                  >
                    <Play size={15} fill="currentColor" />
                    <span>{isFMovies ? 'Watch · FMovies' : `Watch · ${src.provider_name}`}</span>
                  </button>
                );
              })}

              {/* Catalog TV: choose season dropdown */}
              {isContent && isTV && (
                <div className="um-dropdown-wrapper">
                  <button
                    className="btn-modal-play"
                    onClick={() => setSeasonDropdownOpen((o) => !o)}
                  >
                    <Play size={15} fill="currentColor" />
                    <span>Choose Season</span>
                    <ChevronDown size={13} />
                  </button>
                  {seasonDropdownOpen && (
                    <div className="um-dropdown-menu">
                      {item.sources.length === 0 ? (
                        <div className="um-dropdown-empty">No seasons available</div>
                      ) : (
                        item.sources.map((src) => {
                          const isFMovies = src.provider_name.toLowerCase().includes('fmovies');
                          const label = src.season_number != null
                            ? `${item.data.title} S${src.season_number}`
                            : item.data.title;
                          return (
                            <button
                              key={`${src.provider_id}-${src.season_number}`}
                              className="um-dropdown-item"
                              onClick={() => {
                                setSeasonDropdownOpen(false);
                                handlePlayUrl(src.page_url, label, src.provider_id, isFMovies);
                              }}
                            >
                              <span>{src.season_number != null ? `Season ${src.season_number}` : 'Full Series'}</span>
                              <span className="um-dropdown-sub">{src.provider_name}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Video bookmark: play in webview */}
              {isVideo && (
                <button
                  className="btn-modal-play"
                  onClick={() => handlePlayUrl(item.data.page_url, item.data.title, null, false)}
                >
                  <Play size={15} fill="currentColor" />
                  <span>Play Webview</span>
                </button>
              )}

              {/* External link — always opens in system browser */}
              <button
                className="btn-modal-external"
                title="Open in system browser"
                onClick={handleExternalLink}
              >
                <ExternalLink size={17} />
              </button>

              {/* Playlist picker */}
              <div className="um-dropdown-wrapper">
                <button
                  className="btn-modal-external um-playlist-btn"
                  title={currentPlaylistName ? `Playlist: ${currentPlaylistName}` : 'Add to playlist'}
                  onClick={() => setPlaylistDropdownOpen((o) => !o)}
                >
                  <ListPlus size={17} />
                  {currentPlaylistName && (
                    <span className="um-playlist-label">{currentPlaylistName}</span>
                  )}
                </button>
                {playlistDropdownOpen && (
                  <div className="um-dropdown-menu um-dropdown-menu--right">
                    <button
                      className={`um-dropdown-item ${!playlistId ? 'um-dropdown-item--active' : ''}`}
                      onClick={() => handleSetPlaylist(null)}
                    >
                      No Playlist
                    </button>
                    {playlists.map((pl) => (
                      <button
                        key={pl.id}
                        className={`um-dropdown-item ${playlistId === pl.id ? 'um-dropdown-item--active' : ''}`}
                        onClick={() => handleSetPlaylist(pl.id)}
                      >
                        {pl.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="um-body">
          {isContent && item.data.synopsis && (
            <p className="um-synopsis">{item.data.synopsis}</p>
          )}
          {isVideo && (
            <>
              <p className="um-url">
                <a href={item.data.page_url} target="_blank" rel="noreferrer" className="modal-link">
                  {item.data.page_url}
                </a>
              </p>
              {(() => {
                try {
                  const tags = JSON.parse(item.data.tags ?? '[]') as string[];
                  if (tags.length === 0) return null;
                  return (
                    <div className="modal-tags-container" style={{ marginTop: '0.75rem' }}>
                      <span className="modal-section-label">Tags:</span>
                      <div className="modal-tags-list">
                        {tags.map((t, i) => <span key={i} className="modal-tag-chip">#{t}</span>)}
                      </div>
                    </div>
                  );
                } catch { return null; }
              })()}
            </>
          )}
        </div>

        {/* Footer — delete action for bookmarks only */}
        {isVideo && (
          <div className="um-footer">
            <button
              className="btn-modal-delete"
              onClick={() => { onDeleteVideo(item.data.id); onClose(); }}
            >
              <Trash2 size={15} />
              <span>Delete Bookmark</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Add UniversalModal CSS to `index.css`**

Append the following block to the end of `src/src/index.css`:

```css
/* ── UniversalModal ─────────────────────────────────── */
.um-card {
  position: relative;
  background: var(--netflix-dark-card);
  width: 100%;
  max-width: 860px;
  border-radius: 12px;
  overflow: hidden;
  max-height: 88vh;
  overflow-y: auto;
  animation: fadeIn 0.2s ease;
}

.um-hero {
  position: relative;
  height: 240px;
  flex-shrink: 0;
  overflow: hidden;
}

.um-hero-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  filter: blur(14px) brightness(0.4);
  transform: scale(1.14);
}

.um-hero-bg--gradient {
  background: linear-gradient(135deg, #0f0f1a 0%, #1a0a2e 50%, #0d1117 100%);
  filter: none;
  transform: none;
}

.um-hero-fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 30%, var(--netflix-dark-card) 100%);
}

.um-info-row {
  display: flex;
  gap: 1.5rem;
  padding: 0 2rem;
  margin-top: -68px;
  position: relative;
  z-index: 2;
  align-items: flex-start;
}

/* Poster wrapper: fixed width, holds either poster or cover editor */
.um-poster-wrapper {
  width: 120px;
  flex-shrink: 0;
}

.um-poster {
  width: 120px;
  height: 180px;
  border-radius: 8px;
  overflow: hidden;
  background: #1a1a2e;
  cursor: pointer;
  position: relative;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65);
}

.um-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.um-poster-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-gray);
}

.um-poster-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s ease;
  color: #fff;
}

.um-poster:hover .um-poster-overlay {
  opacity: 1;
}

.um-cover-editor {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 4px;
}

.um-cover-editor-label {
  font-size: 0.75rem;
  color: var(--text-gray);
  margin: 0;
}

.um-cover-editor-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

/* Meta column: title, meta row, actions */
.um-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
  padding-top: 72px;
}

.um-title {
  font-size: 1.55rem;
  font-weight: 800;
  margin: 0;
  line-height: 1.2;
}

.um-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: var(--text-gray);
}

.um-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

/* Shared dropdown wrapper */
.um-dropdown-wrapper {
  position: relative;
}

.um-dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  background: #1e1e2e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 0.35rem;
  z-index: 200;
  min-width: 190px;
  max-height: 260px;
  overflow-y: auto;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65);
}

.um-dropdown-menu--right {
  left: auto;
  right: 0;
}

.um-dropdown-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 0.45rem 0.7rem;
  background: none;
  border: none;
  color: #e5e5e5;
  font-size: 0.83rem;
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  gap: 0.5rem;
}

.um-dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.um-dropdown-item--active {
  color: var(--netflix-red);
  font-weight: 600;
}

.um-dropdown-sub {
  color: var(--text-gray);
  font-size: 0.74rem;
  white-space: nowrap;
}

.um-dropdown-empty {
  padding: 0.5rem 0.75rem;
  color: var(--text-gray);
  font-size: 0.82rem;
}

/* Playlist button — may show playlist name badge */
.um-playlist-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.um-playlist-label {
  font-size: 0.75rem;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Body */
.um-body {
  padding: 1.25rem 2rem 1rem;
}

.um-synopsis {
  color: var(--text-gray);
  line-height: 1.65;
  font-size: 0.88rem;
  margin: 0;
}

.um-url {
  color: var(--text-gray);
  font-size: 0.83rem;
  margin: 0;
  word-break: break-all;
}

/* Footer */
.um-footer {
  padding: 0.25rem 2rem 1.5rem;
  display: flex;
  justify-content: flex-end;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors. Fix any type errors before continuing.

- [ ] **Step 4: Commit**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
git add src/src/components/UniversalModal.tsx src/src/index.css
git commit -m "feat: add UniversalModal component with cinematic hero layout"
```

---

### Task 4: App.tsx wire-up + delete old modals

**Files:**
- Modify: `src/src/App.tsx`
- Delete: `src/src/components/MovieModal.tsx`
- Delete: `src/src/components/ContentLandingModal.tsx`

**Interfaces:**
- Consumes: `ModalItem` and `UniversalModal` from `./components/UniversalModal` (Task 3)
- Removes: `selectedVideoModal`, `selectedContentId` states
- Adds: `modalItem: ModalItem | null` state
- Adds: `openContentModal(contentId: string): Promise<void>` callback

- [ ] **Step 1: Update imports in `App.tsx`**

Replace the existing modal imports (lines 5-6 and line 24):

**Remove:**
```tsx
import { MovieModal } from './components/MovieModal';
// ...
import { ContentLandingModal } from './components/ContentLandingModal';
```

**Add (after the existing Navbar import):**
```tsx
import { UniversalModal, type ModalItem } from './components/UniversalModal';
```

- [ ] **Step 2: Replace two modal states with one**

Find lines 130-131 in `App.tsx`:
```tsx
  const [selectedVideoModal, setSelectedVideoModal] = useState<Video | null>(null);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
```

Replace with:
```tsx
  const [modalItem, setModalItem] = useState<ModalItem | null>(null);
```

- [ ] **Step 3: Add `openContentModal` callback**

After the `fetchCatalogPage` callback (around line 163), add:

```tsx
  const openContentModal = useCallback(async (contentId: string) => {
    const detail = await callTauri<ContentDetail>('get_content_detail', { contentId });
    if (detail) {
      setModalItem({ kind: 'content', data: detail.content, sources: detail.sources });
    }
  }, []);
```

- [ ] **Step 4: Update `handleDeleteVideo`**

Find the existing `handleDeleteVideo` function (around line 311):
```tsx
    if (selectedVideoModal?.id === id) setSelectedVideoModal(null);
```

Remove that line. The UniversalModal calls `onClose()` itself before `onDeleteVideo`, so no state sync needed here.

- [ ] **Step 5: Remove `handleSetVideoPlaylist` and `handleUpdateVideoCover` functions**

These are now handled internally by UniversalModal. Delete the following functions entirely:

```tsx
  const handleSetVideoPlaylist = async (videoId: string, playlistId: string | null) => { ... };
  const handleUpdateVideoCover = async (id: string, coverUrl: string) => { ... };
```

- [ ] **Step 6: Remove `handlePlayContent` function**

This was only passed to `ContentLandingModal`. Delete it:

```tsx
  const handlePlayContent = async (url: string, title: string, providerId: string) => { ... };
```

- [ ] **Step 7: Add `handleVideoUpdated` callback**

After `handleContentUpdated` (around line 239), add:

```tsx
  const handleVideoUpdated = async (_videoId: string) => {
    const vList = await callTauri<Video[]>('list_videos');
    if (vList !== null) setVideos(vList);
  };
```

- [ ] **Step 8: Replace `setSelectedContentId` calls with `openContentModal`**

There are multiple places in `App.tsx` where `setSelectedContentId` is passed as `onOpenDetail`. Replace all occurrences:

- `onOpenDetail={setSelectedContentId}` → `onOpenDetail={openContentModal}`
- `onOpenDetail={(id) => setSelectedContentId(id)}` → `onOpenDetail={openContentModal}`

Also in `renderCatalogTab` where `setSelectedContentId` is used in `GenreCatalog`:
- `onOpenDetail={setSelectedContentId}` → `onOpenDetail={openContentModal}`

- [ ] **Step 9: Replace `setSelectedVideoModal` calls with `setModalItem`**

Find all places where `setSelectedVideoModal(v)` is called (in `MovieRow` `onOpenDetails` props). Replace:

```tsx
onOpenDetails={(v) => setSelectedVideoModal(v)}
```

with:

```tsx
onOpenDetails={(v) => setModalItem({ kind: 'video', data: v })}
```

- [ ] **Step 10: Replace modal renders at bottom of `App.tsx`**

Find lines 702-704:
```tsx
      <MovieModal video={selectedVideoModal} playlists={playlists} onClose={() => setSelectedVideoModal(null)}
        onPlay={handlePlayWebview} onDelete={handleDeleteVideo} onSetPlaylist={handleSetVideoPlaylist} onUpdateCover={handleUpdateVideoCover} />
      <ContentLandingModal contentId={selectedContentId} onClose={() => setSelectedContentId(null)} onPlay={handlePlayContent} onContentUpdated={handleContentUpdated} />
```

Replace with:
```tsx
      <UniversalModal
        item={modalItem}
        playlists={playlists}
        onClose={() => setModalItem(null)}
        onContentUpdated={handleContentUpdated}
        onVideoUpdated={handleVideoUpdated}
        onDeleteVideo={handleDeleteVideo}
      />
```

- [ ] **Step 11: Verify TypeScript compiles with no errors**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors. Fix any before continuing.

- [ ] **Step 12: Delete old modal files**

```bash
rm /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src/src/components/MovieModal.tsx
rm /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src/src/components/ContentLandingModal.tsx
```

- [ ] **Step 13: Verify TypeScript still passes after deletes**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors (no more imports referencing deleted files).

- [ ] **Step 14: Build the Tauri app**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
npm run tauri dev 2>&1 | head -60
```

Or if using a separate build step:
```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app/src-tauri
cargo build 2>&1 | tail -20
```

Expected: Tauri dev window opens. Verify manually:
1. Click a catalog movie card → UniversalModal opens with hero backdrop, poster, title, rating, genre pills, Watch button
2. Click a catalog TV show card → UniversalModal opens with "Choose Season" button → dropdown lists seasons
3. Click a bookmark card → UniversalModal opens with "Play Webview" button, Delete button in footer
4. Hover over poster → pencil icon appears → click → URL input replaces poster → Save updates image
5. Click `↗` external link → opens in system browser
6. Click `+ Playlist` → dropdown shows all playlists → selecting one persists (closes and reopens modal to confirm)
7. Click `✕` → modal closes

- [ ] **Step 15: Commit**

```bash
cd /Users/shawnwilkes/Documents/GitHub/flud-shell/flud-app
git add src/src/App.tsx
git add -A src/src/components/
git commit -m "feat: replace MovieModal + ContentLandingModal with UniversalModal"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Discriminated union `ModalItem` type — Task 3
- ✅ `App.tsx` collapses `selectedContentId` + `selectedVideoModal` → `modalItem` — Task 4
- ✅ `content_playlists` join table + migration — Task 1
- ✅ `set_content_playlist` + `get_content_playlist` Rust commands — Tasks 1 & 2
- ✅ Cinematic full-bleed hero (blurred backdrop or dark gradient) — Task 3 CSS
- ✅ Poster floats up from body (-68px margin-top) — Task 3 CSS
- ✅ Pencil centered on poster hover → flips to URL input — Task 3 component
- ✅ Cover saves to `cover_url_override` (Content) or `cover_url` (Video) — Task 3 `handleSaveCover`
- ✅ Movie: one button per unique provider (deduped by `provider_id`) — Task 3 `uniqueProviders`
- ✅ TV: single "Choose Season" button with inline dropdown — Task 3
- ✅ Bookmark: "Play Webview" button — Task 3
- ✅ `↗` always opens in system browser — Task 3 `handleExternalLink`
- ✅ `+ Playlist` dropdown with all shelves + "No Playlist" — Task 3 `handleSetPlaylist`
- ✅ FMovies → `open_in_browser`; others → `open_video_player` — Task 3 `handlePlayUrl`
- ✅ Synopsis for catalog content — Task 3 body section
- ✅ URL + tags for bookmarks — Task 3 body section
- ✅ Delete bookmark button — renders only for `kind: 'video'` — Task 3 footer
- ✅ Delete `MovieModal.tsx` and `ContentLandingModal.tsx` — Task 4

**Type consistency check:**
- `ModalItem` defined in `UniversalModal.tsx`, exported, imported into `App.tsx` ✅
- `openContentModal` in App.tsx calls `get_content_detail` → sets `{ kind: 'content', data: detail.content, sources: detail.sources }` ✅
- `ContentDetail` type stays in `App.tsx` (used by `handlePlayContentDirect` and `openContentModal`) ✅
- `callTauri<void>('set_content_playlist', { contentId, playlistId })` matches command args `content_id: String, playlist_id: Option<String>` — note Tauri snake_case: the frontend uses camelCase (`contentId`, `playlistId`) and Tauri converts automatically ✅
