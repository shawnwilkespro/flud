use tauri::Manager;
use sqlx::SqlitePool;

mod commands;
mod db;

pub struct AppState {
    pub db: SqlitePool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();
            let rt = tokio::runtime::Runtime::new().expect("Failed to create runtime");
            let pool = rt.block_on(db::init_db()).expect("DB init failed");
            handle.manage(AppState { db: pool });

            Ok(())
        })
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
