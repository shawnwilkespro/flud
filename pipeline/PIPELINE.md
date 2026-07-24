# Flud Content Import Pipeline

## Overview

Three-step pipeline: parse sitemap → import into flud.db → enrich with TMDB metadata.

```
parse_sitemap.py  →  fast_import.py  →  enrich.py
     ↓                    ↓
 <provider>.db        flud.db
 <provider>.csv    (content + provider_content)
```

---

## Step 1: Parse Sitemap

Fetches the provider's sitemap, extracts all content URLs, detects media type (movie vs tv_show), and writes a staging DB and CSV.

```bash
# fmovies (default)
python3 parse_sitemap.py --provider fmovies

# 123moviesfree
python3 parse_sitemap.py --provider 123moviesfree
```

Output files per provider:

| Provider | DB | CSV |
|---|---|---|
| fmovies | `fmovies.db` | `fmovies.csv` |
| 123moviesfree | `123moviesfree.db` | `123moviesfree.csv` |

### Media Type Detection

- **fmovies**: slug pattern — if slug contains `-season-` or `-episode-\d+`, it's a `tv_show`; otherwise `movie`
- **123moviesfree**: URL path takes priority — `/movie/` → `movie`, `/tv-show/` or `/tv/` → `tv_show`; slug pattern is fallback

### Image Paths

- **fmovies**: CDN URL built from slug — `https://img.cdno.my.id/thumb/w_200/h_300/<slug>.jpg`
- **123moviesfree**: `image_path` is `None` — TMDB enrichment fills posters in Step 3

---

## Step 2: Import into flud.db

Reads the staging DB and upserts records into `flud.db`. Populates three tables:

- **`content`** — shared catalog (title, slug, media_type, image_path, tmdb_id, etc.)
- **`provider_content`** — per-provider page URLs linked to content rows
- **`provider_category_settings`** — per-provider category toggles (movies, tv_shows enabled/disabled)

> **Important**: Launch the Flud app at least once before running `fast_import.py`. The app seeds providers into the DB from `config.toml` on first launch — `fast_import.py` requires those provider rows to exist.

```bash
# fmovies
python3 fast_import.py --provider fmovies --source-db fmovies.db

# 123moviesfree
python3 fast_import.py --provider 123moviesfree --source-db 123moviesfree.db

# Custom flud.db path
python3 fast_import.py --provider fmovies --source-db fmovies.db --db /path/to/flud.db
```

---

## Step 3: TMDB Enrichment

Matches content rows against the TMDB API to fill in titles, overviews, posters, ratings, and tmdb_id. Run after import. Processes all providers in one pass.

```bash
python3 enrich.py
```

Do not modify `enrich.py` — it is provider-agnostic and operates on the shared `content` table.

---

## Full Run — Both Providers

```bash
# Parse sitemaps
python3 parse_sitemap.py --provider fmovies
python3 parse_sitemap.py --provider 123moviesfree

# Import (app must have been launched at least once)
python3 fast_import.py --provider fmovies --source-db fmovies.db
python3 fast_import.py --provider 123moviesfree --source-db 123moviesfree.db

# Enrich with TMDB
python3 enrich.py
```

---

## Adding a New Provider

1. Add an entry to `PROVIDER_CONFIGS` in `parse_sitemap.py`
2. Set `sitemap_url`, `base_url`, `image_base_url` (or `None`), `output_db`, `output_csv`
3. If the provider uses URL path segments for type detection, add path-based logic to `detect_media_type`
4. Add the provider to `config.toml` so the app seeds it on first launch
5. Run the pipeline as above with `--provider <name>`
