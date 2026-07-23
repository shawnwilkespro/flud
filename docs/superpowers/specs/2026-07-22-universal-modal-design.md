# Universal Modal — Design Spec
**Date:** 2026-07-22  
**Status:** Approved  

---

## Goal

Replace `MovieModal` and `ContentLandingModal` with a single `UniversalModal` component that handles all content types — FMovies catalog titles (movies & TV shows) and personal video bookmarks — with a cinematic full-bleed hero layout.

---

## Data Model

### Frontend — discriminated union

```typescript
type ModalItem =
  | { kind: 'content'; data: Content; sources: ContentSource[] }
  | { kind: 'video'; data: Video }
```

`App.tsx` replaces two modal states (`selectedContentId`, `selectedVideoModal`) with one:
```typescript
const [modalItem, setModalItem] = useState<ModalItem | null>(null)
```

### Backend — new DB table for catalog playlists

Current state: `Video` has `playlist_id`; `Content` has no playlist association.

New migration adds a join table:
```sql
CREATE TABLE IF NOT EXISTS content_playlists (
    content_id  TEXT NOT NULL REFERENCES content(id),
    playlist_id TEXT NOT NULL REFERENCES playlists(id),
    PRIMARY KEY (content_id, playlist_id)
);
```

New Rust command: `set_content_playlist(content_id, playlist_id | null)` — upserts or deletes from `content_playlists`.

New Rust query: `get_content_playlist(content_id)` — returns the current playlist_id for a catalog title (single playlist per title, consistent with bookmark behavior).

---

## Layout

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│          BACKDROP (blur + darken)          [✕]      │
│                                                     │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
├──────────────────────────────────────────── fade ──┤
│ ┌───────┐   TITLE                                  │
│ │       │   2024 · ★ 8.2 · Action · Thriller       │
│ │ COVER │                                          │
│ │  [✎]  │   ▶ Watch · FMovies  [↗] [+ Playlist]   │
│ │       │                                          │
│ └───────┘                                          │
├─────────────────────────────────────────────────────┤
│  Synopsis / tags / seasons                          │
│                                                     │
│                              [🗑 Delete Bookmark]   │
└─────────────────────────────────────────────────────┘
```

### Hero section (~45% height)
- Cover image (backdrop) fills the area, blurred and darkened
- Falls back to a cinematic dark gradient if no image is available
- `✕` close button, top-right corner

### Poster + meta (overlapping hero/body boundary)
- Poster floats up from the body, overlapping the hero gradient at the bottom
- Pencil `✎` icon centered on poster, visible on hover
- Clicking pencil flips poster area to inline URL input + Save / Cancel
- Saves to `cover_url_override` (Content) or `cover_url` (Video)
- To the right of the poster: title (large), then a meta row: year · ★ rating · genre pills
- Meta fields render only when present — bookmarks will have fewer fields

### Action bar (below title/meta, right of poster)
- **Movies**: one `▶ Watch · [Provider Name]` button per unique provider (deduplicated by `provider_id`, first URL wins)
- **TV Shows**: single `▶ Choose Season` button that expands an inline dropdown listing all seasons
- **Bookmarks**: `▶ Play Webview` button
- `↗` external link icon button — always present, opens URL in system browser
- `+ Playlist` button — opens dropdown of all shelves + "No Playlist" option, always present

### Body section
- **Catalog movies**: synopsis
- **Catalog TV shows**: synopsis + season list (buttons, each opens in browser for FMovies)
- **Bookmarks**: URL display + tags

### Footer
- `🗑 Delete Bookmark` button — renders only for `kind: 'video'`

---

## Playback Routing

| Content type | Provider | Action |
|---|---|---|
| Movie | FMovies | Open in system browser (`open_in_browser` Tauri cmd) |
| Movie | Other providers | Open in webview (`open_video_player` Tauri cmd) |
| TV Show season | FMovies | Open in system browser |
| TV Show season | Other providers | Open in webview |
| Bookmark | Any | Open in webview (`open_video_player`) |
| Any | `↗` button | Always opens in system browser |

---

## Components

### `UniversalModal.tsx` (new)
Single component. Replaces `MovieModal` and `ContentLandingModal`.

Props:
```typescript
interface UniversalModalProps {
  item: ModalItem | null;
  playlists: Playlist[];
  onClose: () => void;
  onContentUpdated?: (contentId: string) => Promise<void>;
  onVideoUpdated?: (videoId: string) => Promise<void>;
  onDeleteVideo: (id: string) => void;
}
```

Internal state:
- `editingCover: boolean`
- `coverInput: string`
- `localCoverUrl: string | null | undefined`
- `playlistId: string | null` (loaded from DB for catalog; from `video.playlist_id` for bookmarks)
- `seasonDropdownOpen: boolean`

### `App.tsx` changes
- Remove `selectedContentId: string | null` and `selectedVideoModal: Video | null` states
- Add `modalItem: ModalItem | null` state
- Replace all `setSelectedContentId(id)` calls — fetch content detail and set `modalItem`
- Replace all `setSelectedVideoModal(v)` calls — set `modalItem` directly
- Remove `<ContentLandingModal>` and `<MovieModal>` from render tree
- Add single `<UniversalModal>` instance

---

## New Rust Commands

| Command | Args | Returns | Purpose |
|---|---|---|---|
| `set_content_playlist` | `content_id, playlist_id \| null` | `()` | Assign/remove catalog title from playlist |
| `get_content_playlist` | `content_id` | `string \| null` | Get current playlist for catalog title |

---

## Migration

New file: `migrations/003_content_playlists.sql`

```sql
CREATE TABLE IF NOT EXISTS content_playlists (
    content_id  TEXT NOT NULL REFERENCES content(id),
    playlist_id TEXT NOT NULL REFERENCES playlists(id),
    PRIMARY KEY (content_id, playlist_id)
);
```

---

## Files Changed

| File | Change |
|---|---|
| `migrations/003_content_playlists.sql` | New migration |
| `src-tauri/src/db.rs` | Add `set_content_playlist`, `get_content_playlist` |
| `src-tauri/src/commands.rs` | Add two new commands wrapping DB fns |
| `src-tauri/src/lib.rs` | Register new commands |
| `src/src/components/UniversalModal.tsx` | New component |
| `src/src/components/MovieModal.tsx` | Delete |
| `src/src/components/ContentLandingModal.tsx` | Delete |
| `src/src/App.tsx` | Swap modal states + imports |

---

## Out of Scope

- Multiple playlists per title (single playlist per title, consistent with current bookmark behavior)
- Server/mirror labeling in the modal (in-player server switcher handles this)
- Scraper or import changes
