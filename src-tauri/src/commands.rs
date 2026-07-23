use tauri::Manager;
use crate::AppState;
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
use crate::db;

#[tauri::command]
pub async fn add_video(
    state: tauri::State<'_, AppState>,
    title: String,
    page_url: String,
    cover_url: Option<String>,
    tags: Vec<String>,
) -> Result<(), String> {
    db_add_video(&state.db, &title, &page_url, cover_url.as_deref(), tags)
        .await
        .map_err(|e| format!("Add video failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn list_videos(state: tauri::State<'_, AppState>) -> Result<Vec<Video>, String> {
    db_list_videos(&state.db)
        .await
        .map_err(|e| format!("List videos failed: {}", e))
}

#[tauri::command]
pub async fn get_video(state: tauri::State<'_, AppState>, id: String) -> Result<Option<Video>, String> {
    db_get_video(&state.db, &id)
        .await
        .map_err(|e| format!("Get video failed: {}", e))
}

#[tauri::command]
pub async fn delete_video(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    db_delete_video(&state.db, &id)
        .await
        .map_err(|e| format!("Delete video failed: {}", e))
}

#[tauri::command]
pub async fn list_playlists(state: tauri::State<'_, AppState>) -> Result<Vec<Playlist>, String> {
    db_list_playlists(&state.db)
        .await
        .map_err(|e| format!("List playlists failed: {}", e))
}

#[tauri::command]
pub async fn create_playlist(state: tauri::State<'_, AppState>, name: String) -> Result<String, String> {
    db_create_playlist(&state.db, &name)
        .await
        .map_err(|e| format!("Create playlist failed: {}", e))
}

#[tauri::command]
pub async fn delete_playlist(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    db_delete_playlist(&state.db, &id)
        .await
        .map_err(|e| format!("Delete playlist failed: {}", e))
}

#[tauri::command]
pub async fn set_video_playlist(
    state: tauri::State<'_, AppState>,
    video_id: String,
    playlist_id: Option<String>,
) -> Result<(), String> {
    db_set_video_playlist(&state.db, &video_id, playlist_id.as_deref())
        .await
        .map_err(|e| format!("Set video playlist failed: {}", e))
}

#[tauri::command]
pub async fn update_video_cover(
    state: tauri::State<'_, AppState>,
    id: String,
    cover_url: String,
) -> Result<(), String> {
    db_update_video_cover(&state.db, &id, &cover_url)
        .await
        .map_err(|e| format!("Update video cover failed: {}", e))
}

#[tauri::command]
pub async fn update_content_cover(
    state: tauri::State<'_, AppState>,
    id: String,
    cover_url_override: Option<String>,
) -> Result<(), String> {
    db_update_content_cover(&state.db, &id, cover_url_override.as_deref())
        .await
        .map_err(|e| format!("Update content cover failed: {}", e))
}

#[tauri::command]
pub async fn open_video_player(
    app: tauri::AppHandle,
    url: String,
    title: String,
    provider_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // Close any existing player window
    if let Some(w) = app.get_webview_window("player") {
        let _ = w.close();
    }

    // Hide dashboard while player is open
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }

    let parsed_url: tauri::Url = url.parse()
        .map_err(|_| format!("Invalid URL: {}", url))?;

    let chrome_ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

    // Load provider mask settings; fall back to defaults if no provider_id given
    let (mask_left, mask_right, mask_top, mask_bottom) = if let Some(ref pid) = provider_id {
        match db::db_get_provider(&state.db, pid).await {
            Ok(Some(p)) => {
                // Force left/right to 0 (horizontal strip format), keep top/bottom as is
                (0, 0, p.mask_top, p.mask_bottom)
            },
            _ => (0, 0, 95, 35),
        }
    } else {
        (0, 0, 95, 35)
    };

    let hole_js = format!(
        "var _HOLE = {{ left: {}, right: {}, top: {}, bottom: {} }};",
        mask_left, mask_right, mask_top, mask_bottom
    );

    // Runs on every page load in the player window.
    // 1. Injects Chrome fingerprint so players don't detect WKWebView.
    // 2. Detects cross-origin player iframes and navigates directly to them,
    //    bypassing WKWebView's cross-origin iframe pointer-event restriction.
    // 3. Blocks Fullscreen API so JW Player can't auto-fullscreen.
    let init_script = r##"
        (function() {
            // Chrome fingerprint
            if (!window.chrome) {
                window.chrome = {
                    runtime: {},
                    loadTimes: function() { return {}; },
                    csi: function() { return {}; },
                    app: {}
                };
            }
            try {
                Object.defineProperty(navigator, 'vendor', {
                    get: function() { return 'Google Inc.'; }
                });
            } catch(e) {}
            try {
                // Modern Chrome 57+ ships with zero plugins — plain array fails
                // instanceof checks. Return empty PluginArray-like object.
                Object.defineProperty(navigator, 'plugins', {
                    get: function() { return { length: 0, item: function() { return null; }, namedItem: function() { return null; } }; }
                });
            } catch(e) {}

            // Block window.open — prevents ad popups spawned by embed pages.
            window.open = function() { return null; };

            // Nuke "install browser" overlays injected by embed hosts.
            // Targets Opera GX promo divs and generic interstitial patterns.
            // Runs immediately and again after DOM settles.
            function _nukeOverlays() {
                var selectors = [
                    '[class*="opera"]', '[id*="opera"]',
                    '[class*="install"]', '[id*="install"]',
                    '[class*="browser-promo"]', '[id*="browser-promo"]',
                    '[class*="interstitial"]', '[id*="interstitial"]',
                    '[class*="adblock"]', '[id*="adblock"]',
                ];
                selectors.forEach(function(sel) {
                    try {
                        document.querySelectorAll(sel).forEach(function(el) {
                            el.remove();
                        });
                    } catch(e) {}
                });
            }
            document.addEventListener('DOMContentLoaded', _nukeOverlays);
            setTimeout(_nukeOverlays, 1500);
            setTimeout(_nukeOverlays, 3000);

            // Fullscreen gating: block auto-fullscreen on page load, allow user-initiated.
            // JW Player calls webkitEnterFullscreen immediately on load (no user gesture).
            // We intercept all fullscreen APIs and only forward the call if the user
            // clicked or pressed a key within the last 1.5s — distinguishing intent from auto-trigger.
            // Keyboard (F key) and click both count as user gestures.
            try {
                var _userClickedAt = 0;
                document.addEventListener('click', function() { _userClickedAt = Date.now(); }, true);
                document.addEventListener('keydown', function() { _userClickedAt = Date.now(); }, true);
                function _isUserGesture() { return (Date.now() - _userClickedAt) < 1500; }

                // Save originals before overriding
                var _origEnterFS = HTMLVideoElement.prototype.webkitEnterFullscreen;
                var _origEnterFSCaps = HTMLVideoElement.prototype.webkitEnterFullScreen;
                var _origReqFS = Element.prototype.requestFullscreen;
                var _origWebkitReqFS = Element.prototype.webkitRequestFullscreen;
                var _origWebkitReqFSCaps = Element.prototype.webkitRequestFullScreen;

                HTMLVideoElement.prototype.webkitEnterFullscreen = function() {
                    if (_isUserGesture() && _origEnterFS) { _origEnterFS.call(this); }
                };
                HTMLVideoElement.prototype.webkitEnterFullScreen = function() {
                    if (_isUserGesture() && _origEnterFSCaps) { _origEnterFSCaps.call(this); }
                };
                Element.prototype.requestFullscreen = function() {
                    if (_isUserGesture() && _origReqFS) { return _origReqFS.call(this); }
                    return Promise.resolve();
                };
                Element.prototype.webkitRequestFullscreen = function() {
                    if (_isUserGesture() && _origWebkitReqFS) { return _origWebkitReqFS.call(this); }
                };
                Element.prototype.webkitRequestFullScreen = function() {
                    if (_isUserGesture() && _origWebkitReqFSCaps) { return _origWebkitReqFSCaps.call(this); }
                };
                // Block document-level fullscreen (never user-initiated)
                document.documentElement.requestFullscreen = function() { return Promise.resolve(); };
            } catch(e) {}

            // Navigate to the #playit iframe URL so it becomes top-level.
            // This is required because WKWebView blocks all pointer events on
            // cross-origin iframes — server buttons and video controls are both
            // inside that iframe. Making it top-level restores full interactivity.
            // Guards: stop if a <video> already exists (already on player page),
            // and only act on pages with a #playit iframe (skips CloudFront gates
            // and other intermediate redirect pages that have no #playit).
            function tryNavigateToPlayer() {
                if (document.querySelector('video')) return false;
                var iframe = document.getElementById('playit');
                if (!iframe) return false;
                var src = iframe.getAttribute('src');
                if (!src || src === '' || src === 'about:blank') return false;
                try {
                    var iframeOrigin = new URL(src, window.location.href).origin;
                    if (iframeOrigin !== window.location.origin) {
                        window.location.replace(new URL(src, window.location.href).href);
                        return true;
                    }
                } catch(e) {}
                return false;
            }

            var observer = new MutationObserver(function() {
                if (tryNavigateToPlayer()) { observer.disconnect(); }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });

            if (!tryNavigateToPlayer()) {
                if (document.readyState !== 'complete') {
                    document.addEventListener('DOMContentLoaded', tryNavigateToPlayer);
                }
                setTimeout(tryNavigateToPlayer, 1000);
                setTimeout(tryNavigateToPlayer, 3000);
                setTimeout(tryNavigateToPlayer, 5000);
            }

            // Black overlay with SVG cutout hole — hides ads/chrome, exposes only the video region.
            // Injected on every page load. Re-injection guard prevents double-stacking on navigations.
            // Hole dimensions are in pixels: left/right/top/bottom insets from viewport edges.
            __HOLE_PLACEHOLDER__

            function _positionOverlayHole() {
                var hole = document.getElementById('__flud_hole__');
                var bg   = document.getElementById('__flud_mask_bg__');
                if (!hole || !bg) return;
                var W = window.innerWidth, H = window.innerHeight;
                bg.setAttribute('width', W);
                bg.setAttribute('height', H);
                hole.setAttribute('x', _HOLE.left);
                hole.setAttribute('y', _HOLE.top);
                hole.setAttribute('width', Math.max(0, W - _HOLE.left - _HOLE.right));
                hole.setAttribute('height', Math.max(0, H - _HOLE.top - _HOLE.bottom));
            }

            function _injectOverlay() {
                if (document.getElementById('__flud_overlay__')) return;

                // Lock scroll
                document.documentElement.style.overflow = 'hidden';
                if (document.body) document.body.style.overflow = 'hidden';

                var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.id = '__flud_overlay__';
                svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2147483647;pointer-events:none;display:block;';
                svg.setAttribute('preserveAspectRatio', 'none');
                svg.innerHTML = [
                    '<defs><mask id="__flud_mask__">',
                    '<rect id="__flud_mask_bg__" fill="white"/>',
                    '<rect id="__flud_hole__" fill="black"/>',
                    '</mask></defs>',
                    '<rect width="100%" height="100%" fill="black" mask="url(#__flud_mask__)"/>'
                ].join('');

                document.documentElement.appendChild(svg);
                _positionOverlayHole();
            }

            window.addEventListener('resize', _positionOverlayHole);

            // Player navbar — sits in the top 125px black mask area.
            // All buttons close the player, returning to the main dashboard.
            function _injectNavbar() {
                if (document.getElementById('__flud_nav__')) return;

                // Scoped styles for nav elements
                var _style = document.createElement('style');
                _style.textContent = [
                    '#__flud_nav__ .__fn_link{background:none;border:none;color:rgba(255,255,255,0.7);font-family:system-ui,-apple-system,sans-serif;font-size:0.875rem;font-weight:500;padding:6px 14px;border-radius:4px;cursor:pointer;}',
                    '#__flud_nav__ .__fn_link:hover{color:#fff;background:rgba(255,255,255,0.08);}',
                    '#__flud_nav__ .__fn_btn_sec{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;font-family:system-ui,-apple-system,sans-serif;font-size:0.8rem;font-weight:600;padding:7px 14px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;}',
                    '#__flud_nav__ .__fn_btn_sec:hover{background:rgba(255,255,255,0.18);}',
                    '#__flud_nav__ .__fn_btn_pri{background:#e50914;border:none;color:#fff;font-family:system-ui,-apple-system,sans-serif;font-size:0.8rem;font-weight:700;padding:7px 16px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;}',
                    '#__flud_nav__ .__fn_btn_pri:hover{background:#f6121d;}',
                    '#__flud_nav__ .__fn_brand{display:flex;align-items:center;gap:10px;cursor:pointer;flex-shrink:0;}',
                    '#__flud_nav__ .__fn_search{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:6px 12px;cursor:pointer;}',
                    '#__flud_nav__ .__fn_search:hover{background:rgba(255,255,255,0.13);}'
                ].join('');
                if (document.head) document.head.appendChild(_style);

                // FLUD logo from React Navbar component
                var _fludLogo = '<svg width="36" height="36" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"><g transform="translate(10, 10) rotate(15 32 32)"><path d="M13.5 31.5c0-2.6 2.4-4.7 5.3-4.7h.1c2.9 0 6.3 2.1 6.3 4.7L22.6 6.4c0-2.4 3-4.4 6.9-4.4h.1c3.8 0 6.9 2 6.9 4.4L35.3 31c0-2.6 2.4-4.7 5.3-4.7h.1c2.9 0 5.3 2.1 5.3 4.7v2.7c.5-1.9 2.4-3.2 4.6-2.7c4.5 1.2 3.6 4.8 4.1 8.7c.5 4.8 1.7 7.9 1.3 9.6c-1 3.7-3.7 3.2-5.1 4.2c-1.4 1-1.8 2.6-2.9 3.6c-2.2 2-6.2 1.6-9.8 2.5c-3.1.8-5.9 2.6-8.3 2.3c-2.7-.3-3.4-2.6-6.4-4c-3-1.4-7.1-.7-8.3-3.1c-2.3-4.8-1.7-23.3-1.7-23.3" fill="#4169E1"/><g fill="#9D00FF"><path d="M13.5 31.5c0-1.4.7-2.7 1.8-3.5c-1.9 2.4-.6 19.4 1.7 24.2c1.2 2.4 5.3 1.7 8.3 3.1c3 1.4 3.7 3.8 6.4 4c2.4.3 5.2-1.4 8.3-2.1c3.6-.9 6.1-.6 8.3-2.6c1.1-1 1.6-2.5 3.8-3.2c1.6-.5 2.7-1 3.9-2.2v.1c-1 3.7-3.7 3.2-5.1 4.2c-1.4 1-1.8 2.6-2.9 3.6c-2.2 2-6.2 1.6-9.8 2.5c-3.1.8-5.9 2.6-8.3 2.3c-2.7-.3-3.4-2.6-6.4-4c-3-1.4-7.1-.7-8.3-3.1c-2.3-4.8-1.7-23.3-1.7-23.3"/><path d="M22.6 5.3c-.9 3.8 2.5 38.4 2.5 38.4c0 2.5 1.3 1.5 1.3-1c0 0-3.6-32.5-2.6-37.3c.4-2 1.8-2.6 4.2-3.3c0 0-4.6.2-5.4 3.2"/><path d="M37 42.3v-13c0-.7.1-1.4.5-2c-1.3.9-2.1 2.2-2.1 3.7v13c-.1 2.7 1.6.9 1.6-1.7"/><path d="M47.4 43.6V33.2c0-.6.1-1.2.4-1.8c-1.1.8-1.9 2-1.9 3.4v10.4c0 2.3 1.5.7 1.5-1.6"/><path d="M34.4 10.8c.8-5.3-1.7-5.5-4.8-5.5c-3.1 0-5.6.2-4.8 5.5c.3 2 2.4 2.7 4.8 2.7s4.5-.8 4.8-2.7"/></g><path d="M34.5 9.9c.8-5.7-1.7-5.9-4.9-5.9s-5.7.2-4.9 5.8c.3 2.1 2.4 2.8 4.9 2.8c2.5 0 4.6-.7 4.9-2.7" fill="#ffffff"/><path d="M15.2 53.6c-3.6-4.2-8.3-6.4-7.1-9.5c1-3 3.1-2.9 5.8-6.3l1.3 15.8" fill="#9D00FF"/></g></svg>';
                var _searchIco  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
                var _folderIco  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>';
                var _plusIco    = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

                var nav = document.createElement('div');
                nav.id = '__flud_nav__';
                nav.style.cssText = 'position:fixed;top:0;left:0;right:0;height:95px;z-index:2147483648;display:flex;align-items:center;justify-content:space-between;padding:0 28px;pointer-events:all;box-sizing:border-box;opacity:1;transition:opacity 0.3s ease;background:linear-gradient(180deg,rgba(0,0,0,0.8) 0%,rgba(0,0,0,0) 100%);';
                nav.innerHTML =
                    '<div class="__fn_brand" id="__flud_n_brand" style="display:flex;align-items:center;gap:10px;cursor:pointer;flex-shrink:0;">' + _fludLogo +
                    '<span style="font-family:\'Plus Jakarta Sans\',system-ui,-apple-system,sans-serif;font-size:1.35rem;font-weight:900;letter-spacing:-0.03em;color:#fff;">FLUD</span></div>' +
                    '<div style="display:flex;align-items:center;gap:20px;flex:1;margin-left:40px;">' +
                        '<button class="__fn_link" id="__flud_n_home" style="background:none;border:none;color:#e5e5e5;font-family:\'Plus Jakarta Sans\',system-ui,-apple-system,sans-serif;font-size:0.875rem;font-weight:500;cursor:pointer;transition:color 0.2s;padding:6px 0;">Home</button>' +
                        '<button class="__fn_link" id="__flud_n_movies" style="background:none;border:none;color:#e5e5e5;font-family:\'Plus Jakarta Sans\',system-ui,-apple-system,sans-serif;font-size:0.875rem;font-weight:500;cursor:pointer;transition:color 0.2s;padding:6px 0;">Movies</button>' +
                        '<button class="__fn_link" id="__flud_n_tv" style="background:none;border:none;color:#e5e5e5;font-family:\'Plus Jakarta Sans\',system-ui,-apple-system,sans-serif;font-size:0.875rem;font-weight:500;cursor:pointer;transition:color 0.2s;padding:6px 0;">TV Shows</button>' +
                        '<button class="__fn_link" id="__flud_n_playlists" style="background:none;border:none;color:#e5e5e5;font-family:\'Plus Jakarta Sans\',system-ui,-apple-system,sans-serif;font-size:0.875rem;font-weight:500;cursor:pointer;transition:color 0.2s;padding:6px 0;">Playlists</button>' +
                        '<button class="__fn_link" id="__flud_n_tags" style="background:none;border:none;color:#e5e5e5;font-family:\'Plus Jakarta Sans\',system-ui,-apple-system,sans-serif;font-size:0.875rem;font-weight:500;cursor:pointer;transition:color 0.2s;padding:6px 0;">Tags &amp; Topics</button>' +
                        '<button class="__fn_link" id="__flud_n_providers" style="background:none;border:none;color:#e5e5e5;font-family:\'Plus Jakarta Sans\',system-ui,-apple-system,sans-serif;font-size:0.875rem;font-weight:500;cursor:pointer;transition:color 0.2s;padding:6px 0;">Providers</button>' +
                    '</div>' +
                    '<div style="display:flex;align-items:center;gap:12px;">' +
                        '<div class="__fn_search" id="__flud_n_search" style="display:flex;align-items:center;gap:8px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:6px 12px;cursor:pointer;">' + _searchIco +
                        '<span style="color:rgba(255,255,255,0.4);font-family:\'Plus Jakarta Sans\',system-ui,-apple-system,sans-serif;font-size:0.85rem;">Titles, tags, URLs...</span></div>' +
                        '<button class="__fn_btn_sec" id="__flud_n_shelf" style="display:inline-flex;align-items:center;gap:8px;background:rgba(109,109,110,0.5);border:none;color:#fff;font-family:\'Plus Jakarta Sans\',system-ui,-apple-system,sans-serif;font-size:0.875rem;font-weight:600;padding:7px 14px;border-radius:4px;cursor:pointer;transition:background 0.2s;">' + _folderIco + '<span>New Shelf</span></button>' +
                        '<button class="__fn_btn_pri" id="__flud_n_addvideo" style="display:inline-flex;align-items:center;gap:8px;background:#E50914;border:none;color:#fff;font-family:\'Plus Jakarta Sans\',system-ui,-apple-system,sans-serif;font-size:0.875rem;font-weight:700;padding:7px 16px;border-radius:4px;cursor:pointer;transition:background 0.2s;">' + _plusIco + '<span>Add Video</span></button>' +
                    '</div>';

                document.documentElement.appendChild(nav);

                // Navbar hover effect: show when mouse is near top, hide when away
                // Only applies when navbar is visible (display: 'flex')
                var _navHoverTimeout;
                function _showNav() {
                    clearTimeout(_navHoverTimeout);
                    if (nav.style.display !== 'none') {
                        nav.style.opacity = '1';
                        nav.style.pointerEvents = 'all';
                    }
                }
                function _hideNav() {
                    if (nav.style.display !== 'none') {
                        _navHoverTimeout = setTimeout(function() {
                            nav.style.opacity = '0';
                            nav.style.pointerEvents = 'none';
                        }, 1500);
                    }
                }
                document.addEventListener('mousemove', function(e) {
                    if (nav.style.display !== 'none') {
                        if (e.clientY < 200) {
                            _showNav();
                        } else {
                            _hideNav();
                        }
                    }
                });
                document.addEventListener('mouseleave', function() {
                    if (nav.style.display !== 'none') {
                        _hideNav();
                    }
                });
                _showNav();

                function _doClose() {
                    try {
                        if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                            window.__TAURI_INTERNALS__.invoke('close_video_player');
                        }
                    } catch(e) {}
                }
                ['__flud_n_brand','__flud_n_home','__flud_n_movies','__flud_n_tv','__flud_n_playlists','__flud_n_tags','__flud_n_providers',
                 '__flud_n_search','__flud_n_shelf','__flud_n_addvideo'].forEach(function(id) {
                    var el = document.getElementById(id);
                    if (el) el.addEventListener('click', _doClose);
                });
            }

            // Mask always visible; navbar shows/hides on mouseover
            var _navHideTimer = null;

            function _hideNavbarOnly() {
                var nav = document.getElementById('__flud_nav__');
                if (nav) nav.style.display = 'none';
            }
            function _showNavbarOnly() {
                clearTimeout(_navHideTimer);
                var nav = document.getElementById('__flud_nav__');
                if (nav) nav.style.display = 'flex';
                _navHideTimer = setTimeout(_hideNavbarOnly, 2500);
            }

            // Hide navbar immediately on page load, keep mask visible
            setTimeout(function() {
                _hideNavbarOnly();
            }, 500);

            // Mousemove anywhere on screen: if mouse is near top, show navbar temporarily
            document.addEventListener('mousemove', function(e) {
                if (e.clientY < 150) {
                    _showNavbarOnly();
                }
            });

            // Hide mask overlay after 10 seconds
            setTimeout(function() {
                var overlay = document.getElementById('__flud_overlay__');
                if (overlay) overlay.style.display = 'none';
            }, 10000);

            if (document.body) {
                _injectOverlay();
                _injectNavbar();
            } else {
                document.addEventListener('DOMContentLoaded', function() {
                    _injectOverlay();
                    _injectNavbar();
                });
            }
        })();
    "##.replace("__HOLE_PLACEHOLDER__", &hole_js);

    let player = tauri::WebviewWindowBuilder::new(
        &app,
        "player",
        tauri::WebviewUrl::External(parsed_url),
    )
    .title(title)
    .fullscreen(true)
    .accept_first_mouse(true)
    .user_agent(chrome_ua)
    .initialization_script(init_script)
    .build()
    .map_err(|e| {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
        }
        format!("Failed to open player: {}", e)
    })?;

    // Restore dashboard when player window is closed
    let app_clone = app.clone();
    player.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let app2 = app_clone.clone();
            let _ = app_clone.run_on_main_thread(move || {
                if let Some(main) = app2.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            });
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn close_video_player(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(player) = app.get_webview_window("player") {
        player.close().map_err(|e| e.to_string())?;
    } else {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
    Ok(())
}

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
    media_type: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::Content>, String> {
    db::db_list_content(&state.db, search.as_deref(), media_type.as_deref(), limit, offset)
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

#[tauri::command]
pub async fn list_recent_content(
    limit: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::Content>, String> {
    db_list_recent_content(&state.db, limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_content_by_genre(
    genre: String,
    media_type: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::Content>, String> {
    db_list_content_by_genre(&state.db, &genre, media_type.as_deref(), limit.unwrap_or(48), offset.unwrap_or(0))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_in_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    Ok(())
}

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
