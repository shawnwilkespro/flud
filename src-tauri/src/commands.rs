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
                svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2147483647;pointer-events:none;';
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

                var _monitorPlay = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><polygon points="10,8 16,11.5 10,15" fill="#fff" stroke="#fff"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/></svg>';
                var _searchIco  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
                var _folderIco  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>';
                var _plusIco    = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

                var nav = document.createElement('div');
                nav.id = '__flud_nav__';
                nav.style.cssText = 'position:fixed;top:0;left:0;right:0;height:125px;z-index:2147483648;display:flex;align-items:center;padding:0 28px;pointer-events:all;box-sizing:border-box;gap:8px;';
                nav.innerHTML =
                    '<div class="__fn_brand" id="__flud_n_brand">' + _monitorPlay +
                    '<span style="font-family:system-ui,-apple-system,sans-serif;font-size:1.1rem;font-weight:800;color:#fff;letter-spacing:0.12em;">FLUD</span></div>' +
                    '<div style="display:flex;align-items:center;gap:2px;margin-left:16px;">' +
                        '<button class="__fn_link" id="__flud_n_home">Home</button>' +
                        '<button class="__fn_link" id="__flud_n_playlists">Playlists</button>' +
                        '<button class="__fn_link" id="__flud_n_tags">Tags &amp; Topics</button>' +
                    '</div>' +
                    '<div style="flex:1;"></div>' +
                    '<div style="display:flex;align-items:center;gap:10px;">' +
                        '<div class="__fn_search" id="__flud_n_search">' + _searchIco +
                        '<span style="color:rgba(255,255,255,0.4);font-family:system-ui,-apple-system,sans-serif;font-size:0.8rem;">Titles, tags, URLs...</span></div>' +
                        '<button class="__fn_btn_sec" id="__flud_n_shelf">' + _folderIco + '<span>New Shelf</span></button>' +
                        '<button class="__fn_btn_pri" id="__flud_n_addvideo">' + _plusIco + '<span>Add Video</span></button>' +
                    '</div>';

                document.documentElement.appendChild(nav);

                function _doClose() {
                    try {
                        if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                            window.__TAURI_INTERNALS__.invoke('close_video_player');
                        }
                    } catch(e) {}
                }
                ['__flud_n_brand','__flud_n_home','__flud_n_playlists','__flud_n_tags',
                 '__flud_n_search','__flud_n_shelf','__flud_n_addvideo'].forEach(function(id) {
                    var el = document.getElementById(id);
                    if (el) el.addEventListener('click', _doClose);
                });
            }

            // Hide overlay + navbar on play/fullscreen; restore on pause/end/exit.
            function _hideFludUI() {
                var nav     = document.getElementById('__flud_nav__');
                var overlay = document.getElementById('__flud_overlay__');
                if (nav)     nav.style.display     = 'none';
                if (overlay) overlay.style.display = 'none';
            }
            function _showFludUI() {
                var isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
                if (isFS) return;
                var nav     = document.getElementById('__flud_nav__');
                var overlay = document.getElementById('__flud_overlay__');
                if (nav)     nav.style.display     = 'flex';
                if (overlay) overlay.style.display = '';
            }

            // Signal 1: capture-phase media events (catches non-bubbling video events).
            document.addEventListener('play',  function(e) {
                if (e.target && e.target.tagName === 'VIDEO') { _hideFludUI(); }
            }, true);
            document.addEventListener('pause', function(e) {
                if (e.target && e.target.tagName === 'VIDEO') { _showFludUI(); }
            }, true);
            document.addEventListener('ended', function(e) {
                if (e.target && e.target.tagName === 'VIDEO') { _showFludUI(); }
            }, true);

            // Signal 2: native Fullscreen API changes (F key, native fullscreen button).
            document.addEventListener('fullscreenchange', function() {
                var isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
                if (isFS) { _hideFludUI(); } else { _showFludUI(); }
            });
            document.addEventListener('webkitfullscreenchange', function() {
                var isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
                if (isFS) { _hideFludUI(); } else { _showFludUI(); }
            });

            // Signal 3: ResizeObserver on video elements — catches CSS/custom fullscreen.
            // Many players fake fullscreen by resizing the player element with CSS,
            // never calling requestFullscreen(), so fullscreenchange never fires.
            // When the video covers >= 85% of the viewport, hide the UI.
            function _watchVideoSize(video) {
                if (video.__flud_ro__) return;
                var ro = new ResizeObserver(function() {
                    var r = video.getBoundingClientRect();
                    var large = r.width  >= window.innerWidth  * 0.85 &&
                                r.height >= window.innerHeight * 0.85;
                    if (large) { _hideFludUI(); } else { _showFludUI(); }
                });
                ro.observe(video);
                video.__flud_ro__ = ro;
            }
            function _scanForVideos() {
                document.querySelectorAll('video').forEach(_watchVideoSize);
            }
            _scanForVideos();
            // Watch for video elements added dynamically (SPA page loads, lazy embeds).
            var _videoMO = new MutationObserver(_scanForVideos);
            _videoMO.observe(document.documentElement, { childList: true, subtree: true });

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
