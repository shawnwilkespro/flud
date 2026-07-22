posed to?# Design: Seamless Chrome Video Player with Floating Overlay Header

**Date:** 2026-07-20
**Project:** flud-app (Tauri v2 + React)
**Status:** Approved

---

## Problem

Playing third-party streaming videos (JW Player, etc.) inside Tauri on macOS is blocked by:

1. **X-Frame-Options / CSP `frame-ancestors`** — JW Player refuses to load in any iframe.
2. **WKWebView restrictions** — No Widevine DRM, restricted autoplay, broken pointer events.
3. **Previous Chrome `--app` approach** — Used a `file://` temp HTML with an iframe, which Chrome blocks cross-origin. Window position/size was hardcoded and didn't match the Tauri window.

## Solution

Launch a full-size Chromium browser window (`--app` mode) in front of the Tauri window at the exact same position and size. A thin always-on-top decoration-free Tauri `WebviewWindow` (40px tall) floats above Chrome as a custom header bar showing the video title and a close button. Tauri's main window is hidden only after Chrome is already covering it — creating a seamless visual page-switch illusion.

## Architecture

### Flow

```
User clicks Play
      │
      ▼
[Rust] Read main window outer_position() + outer_size() → (x, y, w, h)
      │
      ├─► Launch Chrome --app={url}
      │     position: (x, y)
      │     size:     (w, h)        ← exact match, comes to foreground
      │
      ├─► Spawn overlay WebviewWindow ("player-overlay")
      │     position: (x, y)
      │     size:     (w, 40)
      │     always_on_top: true
      │     decorations: false
      │     URL: tauri://localhost/overlay.html?title={encoded_title}
      │
      ├─► Hide main Tauri window   ← already fully covered, seamless
      │
      └─► Background thread: wait for Chrome process exit
                │
                ▼
          Close overlay window (if still open)
          Show + focus main window
          Clear PlayerState
```

### Close via overlay button

```
User clicks "Close" in overlay header
      │
      ▼
invoke('close_video_player')
      │
      ├─► Kill Chrome process (SIGKILL via PlayerState)
      ├─► Close overlay WebviewWindow ("player-overlay")
      └─► Show + focus main window ("main")
```

Background thread's cleanup is a no-op if `close_video_player` already ran (Chrome child is None).

---

## Components

### 1. `PlayerState` (new — `src-tauri/src/lib.rs`)

```rust
pub struct PlayerState {
    pub chrome_child: Mutex<Option<std::process::Child>>,
}
```

Registered via `app.manage(PlayerState { chrome_child: Mutex::new(None) })` in `run()`.

### 2. `play_video_in_chrome` command (refactored — `src-tauri/src/commands.rs`)

- Read `app.get_webview_window("main")` outer position and size.
- Search installed Chromium browsers in priority order (Brave → Chrome → Chromium → Edge → Arc).
- Launch browser with `--app={url}`, `--window-position={x},{y}`, `--window-size={w},{h}`, `--no-first-run`, `--no-default-browser-check`.
- Store `Child` handle in `PlayerState`.
- Spawn `WebviewWindow` for overlay (label `"player-overlay"`), `always_on_top: true`, `decorations: false`, width `w`, height `40`, positioned at `(x, y)`.
- Hide main window.
- Spawn background thread: `child.wait()` → close overlay → show main → clear state.

### 3. `close_video_player` command (new — `src-tauri/src/commands.rs`)

- Lock `PlayerState`, take the `Child`, call `child.kill()`.
- Get overlay window `"player-overlay"`, call `close()`.
- Get main window `"main"`, call `show()` + `set_focus()`.

### 4. `overlay.html` (new — `src/public/overlay.html`)

Static HTML file bundled as a Tauri frontend asset. Loaded via `WebviewUrl::App("overlay.html".into())` with `?title={url_encoded_title}` appended.

- Black background (`#000`), full width, 40px height.
- Left: video title parsed from `URLSearchParams`.
- Right: "Close Video" button that calls `window.__TAURI__.core.invoke('close_video_player')`.
- Styling: system-ui font, white text, subtle hover state on button. Matches app dark aesthetic.
- `-webkit-app-region: drag` on the header so the user can drag the combined Chrome+overlay window.

---

## File Changes

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Add `PlayerState` struct; register with `app.manage()`; add `close_video_player` to invoke handler |
| `src-tauri/src/commands.rs` | Refactor `play_video_in_chrome`; add `close_video_player` |
| `src/public/overlay.html` | New static file — overlay header UI |

No new Rust dependencies required. No frontend React changes required.

---

## Error Handling

- If no Chromium browser is found: show main window, return error string to frontend (existing fallback behavior).
- If overlay window fails to spawn: log warning, continue — Chrome still plays the video, just without the custom header.
- If `close_video_player` is called but Chrome already exited: `kill()` on a dead process is a no-op; proceed to show main window.

---

## Out of Scope

- DRM (Widevine) support — Chrome handles this natively.
- Overlay drag moving the Chrome window — not implemented (complex cross-process window sync).
- Overlay resize sync — Tauri window is hidden during playback; resize is not expected.
