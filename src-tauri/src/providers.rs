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
