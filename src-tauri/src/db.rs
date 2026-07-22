use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use uuid::Uuid;
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct Video {
    pub id: String,
    pub title: String,
    pub page_url: String,
    pub cover_url: Option<String>,
    pub tags: Option<String>, // stored as JSON array string
    pub playlist_id: Option<String>,
    pub added_at: String,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
}

pub async fn init_db() -> sqlx::Result<SqlitePool> {
    let mut path = dirs::data_dir().expect("Failed to get data dir");
    path.push("flud");
    std::fs::create_dir_all(&path).ok();
    path.push("flud.db");

    let db_url = format!("sqlite://{}?mode=rwc", path.display());
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            page_url TEXT NOT NULL UNIQUE,
            cover_url TEXT,
            tags TEXT DEFAULT '[]',
            playlist_id TEXT,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS playlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}

pub async fn db_add_video(
    pool: &SqlitePool,
    title: &str,
    page_url: &str,
    cover_url: Option<&str>,
    tags: Vec<String>,
) -> sqlx::Result<()> {
    let id = Uuid::new_v4().to_string();
    let tags_json = serde_json::to_string(&tags).unwrap_or("[]".to_string());
    let added_at = Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        INSERT INTO videos (id, title, page_url, cover_url, tags, added_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
    )
    .bind(id)
    .bind(title)
    .bind(page_url)
    .bind(cover_url)
    .bind(tags_json)
    .bind(added_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn db_list_videos(pool: &SqlitePool) -> sqlx::Result<Vec<Video>> {
    sqlx::query_as::<_, Video>(
        r#"
        SELECT id, title, page_url, cover_url, tags, playlist_id, 
               COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', added_at), datetime('now')) as added_at
        FROM videos
        ORDER BY added_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn db_get_video(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Video>> {
    sqlx::query_as::<_, Video>(
        r#"
        SELECT id, title, page_url, cover_url, tags, playlist_id,
               COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', added_at), datetime('now')) as added_at
        FROM videos
        WHERE id = ?1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn db_delete_video(pool: &SqlitePool, id: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM videos WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn db_list_playlists(pool: &SqlitePool) -> sqlx::Result<Vec<Playlist>> {
    sqlx::query_as::<_, Playlist>("SELECT id, name FROM playlists ORDER BY name ASC")
        .fetch_all(pool)
        .await
}

pub async fn db_create_playlist(pool: &SqlitePool, name: &str) -> sqlx::Result<String> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO playlists (id, name) VALUES (?1, ?2)")
        .bind(&id)
        .bind(name)
        .execute(pool)
        .await?;
    Ok(id)
}

pub async fn db_delete_playlist(pool: &SqlitePool, id: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM playlists WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE videos SET playlist_id = NULL WHERE playlist_id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn db_set_video_playlist(
    pool: &SqlitePool,
    video_id: &str,
    playlist_id: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE videos SET playlist_id = ?1 WHERE id = ?2")
        .bind(playlist_id)
        .bind(video_id)
        .execute(pool)
        .await?;
    Ok(())
}