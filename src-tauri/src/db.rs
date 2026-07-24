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

#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub mask_left: i32,
    pub mask_right: i32,
    pub mask_top: i32,
    pub mask_bottom: i32,
    pub enabled: bool,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct ProviderCategorySetting {
    pub provider_id: String,
    pub category: String,  // "movie" | "tv_show"
    pub enabled: bool,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct Content {
    pub id: String,
    pub tmdb_id: Option<i64>,
    pub title: String,
    pub media_type: String, // "movie" | "tv_show"
    pub synopsis: Option<String>,
    pub poster_url: Option<String>,
    pub cover_url_override: Option<String>,
    pub year: Option<i32>,
    pub genres: Option<String>, // JSON array string
    pub rating: Option<f64>,
    pub release_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentSource {
    pub provider_id: String,
    pub provider_name: String,
    pub page_url: String,
    pub season_number: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentDetail {
    pub content: Content,
    pub sources: Vec<ContentSource>,
}

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

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS providers (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            base_url    TEXT NOT NULL,
            mask_left   INTEGER NOT NULL DEFAULT 0,
            mask_right  INTEGER NOT NULL DEFAULT 0,
            mask_top    INTEGER NOT NULL DEFAULT 95,
            mask_bottom INTEGER NOT NULL DEFAULT 35,
            enabled     INTEGER NOT NULL DEFAULT 1
        );
        "#,
    )
    .execute(&pool)
    .await?;

    // Fix existing records with old mask values (strip format: left=0, right=0)
    sqlx::query("UPDATE providers SET mask_left = 0 WHERE mask_left = 210;")
        .execute(&pool)
        .await?;
    sqlx::query("UPDATE providers SET mask_right = 0 WHERE mask_right = 210;")
        .execute(&pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS content (
            id         TEXT PRIMARY KEY,
            tmdb_id    INTEGER UNIQUE,
            title      TEXT NOT NULL,
            media_type TEXT NOT NULL,
            synopsis   TEXT,
            poster_url TEXT,
            year       INTEGER,
            genres     TEXT,
            rating     REAL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    // Add cover_url_override column if it doesn't exist yet (idempotent migration)
    let _ = sqlx::query("ALTER TABLE content ADD COLUMN cover_url_override TEXT")
        .execute(&pool)
        .await;

    // Add release_date column if it doesn't exist yet (idempotent migration)
    let _ = sqlx::query("ALTER TABLE content ADD COLUMN release_date TEXT")
        .execute(&pool)
        .await;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS provider_content (
            id            TEXT PRIMARY KEY,
            content_id    TEXT NOT NULL REFERENCES content(id),
            provider_id   TEXT NOT NULL REFERENCES providers(id),
            page_url      TEXT NOT NULL UNIQUE,
            season_number INTEGER
        );
        "#,
    )
    .execute(&pool)
    .await?;

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

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS provider_category_settings (
            provider_id TEXT NOT NULL REFERENCES providers(id),
            category    TEXT NOT NULL,
            enabled     INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (provider_id, category)
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_provider_content_content_id ON provider_content(content_id);"
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

pub async fn db_upsert_provider(pool: &SqlitePool, p: &Provider) -> sqlx::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO providers (id, name, base_url, mask_left, mask_right, mask_top, mask_bottom, enabled)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
            name        = excluded.name,
            base_url    = excluded.base_url,
            mask_left   = excluded.mask_left,
            mask_right  = excluded.mask_right,
            mask_top    = excluded.mask_top,
            mask_bottom = excluded.mask_bottom,
            enabled     = excluded.enabled
        "#,
    )
    .bind(&p.id)
    .bind(&p.name)
    .bind(&p.base_url)
    .bind(p.mask_left)
    .bind(p.mask_right)
    .bind(p.mask_top)
    .bind(p.mask_bottom)
    .bind(p.enabled as i32)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn db_list_providers(pool: &SqlitePool) -> sqlx::Result<Vec<Provider>> {
    sqlx::query_as::<_, Provider>(
        "SELECT id, name, base_url, mask_left, mask_right, mask_top, mask_bottom, enabled FROM providers ORDER BY name ASC"
    )
    .fetch_all(pool)
    .await
}

pub async fn db_get_provider(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Provider>> {
    sqlx::query_as::<_, Provider>(
        "SELECT id, name, base_url, mask_left, mask_right, mask_top, mask_bottom, enabled FROM providers WHERE id = ?1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn db_list_content(
    pool: &SqlitePool,
    search: Option<&str>,
    media_type: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> sqlx::Result<Vec<Content>> {
    let lim = limit.unwrap_or(500);
    let off = offset.unwrap_or(0);
    match (search, media_type) {
        (Some(q), Some(mt)) => {
            let like = format!("%{}%", q);
            sqlx::query_as::<_, Content>(
                "SELECT id, tmdb_id, title, media_type, synopsis, poster_url, cover_url_override, year, genres, rating, release_date FROM content WHERE title LIKE ?1 AND media_type = ?2 AND EXISTS (SELECT 1 FROM provider_content pc LEFT JOIN provider_category_settings pcs ON pcs.provider_id = pc.provider_id AND pcs.category = content.media_type WHERE pc.content_id = content.id AND (pcs.enabled IS NULL OR pcs.enabled = 1)) ORDER BY title ASC LIMIT ?3 OFFSET ?4"
            )
            .bind(like)
            .bind(mt)
            .bind(lim)
            .bind(off)
            .fetch_all(pool)
            .await
        }
        (Some(q), None) => {
            let like = format!("%{}%", q);
            sqlx::query_as::<_, Content>(
                "SELECT id, tmdb_id, title, media_type, synopsis, poster_url, cover_url_override, year, genres, rating, release_date FROM content WHERE title LIKE ?1 AND EXISTS (SELECT 1 FROM provider_content pc LEFT JOIN provider_category_settings pcs ON pcs.provider_id = pc.provider_id AND pcs.category = content.media_type WHERE pc.content_id = content.id AND (pcs.enabled IS NULL OR pcs.enabled = 1)) ORDER BY title ASC LIMIT ?2 OFFSET ?3"
            )
            .bind(like)
            .bind(lim)
            .bind(off)
            .fetch_all(pool)
            .await
        }
        (None, Some(mt)) => {
            sqlx::query_as::<_, Content>(
                "SELECT id, tmdb_id, title, media_type, synopsis, poster_url, cover_url_override, year, genres, rating, release_date FROM content WHERE media_type = ?1 AND EXISTS (SELECT 1 FROM provider_content pc LEFT JOIN provider_category_settings pcs ON pcs.provider_id = pc.provider_id AND pcs.category = content.media_type WHERE pc.content_id = content.id AND (pcs.enabled IS NULL OR pcs.enabled = 1)) ORDER BY title ASC LIMIT ?2 OFFSET ?3"
            )
            .bind(mt)
            .bind(lim)
            .bind(off)
            .fetch_all(pool)
            .await
        }
        (None, None) => {
            sqlx::query_as::<_, Content>(
                "SELECT id, tmdb_id, title, media_type, synopsis, poster_url, cover_url_override, year, genres, rating, release_date FROM content WHERE EXISTS (SELECT 1 FROM provider_content pc LEFT JOIN provider_category_settings pcs ON pcs.provider_id = pc.provider_id AND pcs.category = content.media_type WHERE pc.content_id = content.id AND (pcs.enabled IS NULL OR pcs.enabled = 1)) ORDER BY title ASC LIMIT ?1 OFFSET ?2"
            )
            .bind(lim)
            .bind(off)
            .fetch_all(pool)
            .await
        }
    }
}

pub async fn db_get_content_detail(
    pool: &SqlitePool,
    content_id: &str,
) -> sqlx::Result<Option<ContentDetail>> {
    let content = sqlx::query_as::<_, Content>(
        "SELECT id, tmdb_id, title, media_type, synopsis, poster_url, cover_url_override, year, genres, rating, release_date FROM content WHERE id = ?1"
    )
    .bind(content_id)
    .fetch_optional(pool)
    .await?;

    let Some(content) = content else {
        return Ok(None);
    };

    let sources = sqlx::query_as::<_, (String, String, String, Option<i32>)>(
        r#"
        SELECT pc.provider_id, p.name, pc.page_url, pc.season_number
        FROM provider_content pc
        JOIN providers p ON p.id = pc.provider_id
        WHERE pc.content_id = ?1
        ORDER BY pc.season_number ASC NULLS LAST, p.name ASC
        "#,
    )
    .bind(content_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(provider_id, provider_name, page_url, season_number)| ContentSource {
        provider_id,
        provider_name,
        page_url,
        season_number,
    })
    .collect();

    Ok(Some(ContentDetail { content, sources }))
}

pub async fn db_list_recent_content(pool: &SqlitePool, limit: i64) -> sqlx::Result<Vec<Content>> {
    sqlx::query_as::<_, Content>(
        "SELECT id, tmdb_id, title, media_type, synopsis, poster_url, cover_url_override, year, genres, rating, release_date FROM content WHERE poster_url IS NOT NULL AND EXISTS (SELECT 1 FROM provider_content pc LEFT JOIN provider_category_settings pcs ON pcs.provider_id = pc.provider_id AND pcs.category = content.media_type WHERE pc.content_id = content.id AND (pcs.enabled IS NULL OR pcs.enabled = 1)) ORDER BY release_date DESC NULLS LAST, year DESC NULLS LAST LIMIT ?1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn db_list_content_by_genre(
    pool: &SqlitePool,
    genre: &str,
    media_type: Option<&str>,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<Content>> {
    let like = format!("%\"{}\"%" , genre);
    match media_type {
        Some(mt) => sqlx::query_as::<_, Content>(
            "SELECT id, tmdb_id, title, media_type, synopsis, poster_url, cover_url_override, year, genres, rating, release_date FROM content WHERE genres LIKE ?1 AND media_type = ?2 AND poster_url IS NOT NULL AND EXISTS (SELECT 1 FROM provider_content pc LEFT JOIN provider_category_settings pcs ON pcs.provider_id = pc.provider_id AND pcs.category = content.media_type WHERE pc.content_id = content.id AND (pcs.enabled IS NULL OR pcs.enabled = 1)) ORDER BY rating DESC NULLS LAST, release_date DESC NULLS LAST LIMIT ?3 OFFSET ?4"
        )
        .bind(like)
        .bind(mt)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await,
        None => sqlx::query_as::<_, Content>(
            "SELECT id, tmdb_id, title, media_type, synopsis, poster_url, cover_url_override, year, genres, rating, release_date FROM content WHERE genres LIKE ?1 AND poster_url IS NOT NULL AND EXISTS (SELECT 1 FROM provider_content pc LEFT JOIN provider_category_settings pcs ON pcs.provider_id = pc.provider_id AND pcs.category = content.media_type WHERE pc.content_id = content.id AND (pcs.enabled IS NULL OR pcs.enabled = 1)) ORDER BY rating DESC NULLS LAST, release_date DESC NULLS LAST LIMIT ?2 OFFSET ?3"
        )
        .bind(like)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await,
    }
}

pub async fn db_update_video_cover(pool: &SqlitePool, id: &str, cover_url: &str) -> sqlx::Result<()> {
    sqlx::query("UPDATE videos SET cover_url = ?1 WHERE id = ?2")
        .bind(cover_url)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn db_update_content_cover(
    pool: &SqlitePool,
    id: &str,
    cover_url_override: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE content SET cover_url_override = ?1 WHERE id = ?2")
        .bind(cover_url_override)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

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

pub async fn db_list_provider_category_settings(
    pool: &SqlitePool,
) -> sqlx::Result<Vec<ProviderCategorySetting>> {
    sqlx::query_as::<_, ProviderCategorySetting>(
        "SELECT provider_id, category, enabled FROM provider_category_settings ORDER BY provider_id, category"
    )
    .fetch_all(pool)
    .await
}

pub async fn db_set_provider_category(
    pool: &SqlitePool,
    provider_id: &str,
    category: &str,
    enabled: bool,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO provider_category_settings (provider_id, category, enabled)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(provider_id, category) DO UPDATE SET enabled = excluded.enabled
        "#,
    )
    .bind(provider_id)
    .bind(category)
    .bind(enabled as i32)
    .execute(pool)
    .await?;
    Ok(())
}