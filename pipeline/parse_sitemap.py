#!/usr/bin/env python3
import argparse
import csv
import re
import sqlite3
import sys
from concurrent.futures import ThreadPoolExecutor
import requests
from lxml import etree

PROVIDER_CONFIGS = {
    "fmovies": {
        "sitemap_url": "https://fmoviess.org/sitemap.xml",
        "base_url": "https://fmoviess.org",
        "image_base_url": "https://img.cdno.my.id/thumb/w_200/h_300/",
        "output_db": "fmovies.db",
        "output_csv": "fmovies.csv",
    },
    "123moviesfree": {
        "sitemap_url": "https://ww8.123moviesfree.net/sitemap.xml",
        "base_url": "https://ww8.123moviesfree.net",
        "image_base_url": None,  # will use poster_url from sitemap or leave None
        "output_db": "123moviesfree.db",
        "output_csv": "123moviesfree.csv",
    },
}

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def fetch_xml(url):
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        return etree.fromstring(response.content)
    except Exception as e:
        print(f"Error fetching {url}: {e}", file=sys.stderr)
        return None


def extract_slug(page_url):
    cleaned_url = page_url.rstrip("/")
    slug = cleaned_url.split("/")[-1]
    return slug


def detect_media_type(slug, page_url=None, provider=None):
    # For 123moviesfree: use URL path segments as primary detection
    if provider == "123moviesfree" and page_url:
        path = page_url.rstrip("/")
        if "/movie/" in path:
            return "movie"
        if "/tv-show/" in path or "/tv/" in path:
            return "tv_show"

    # Fallback: check slug for season/episode patterns
    if re.search(r"-(season|episode)-\d+", slug, re.IGNORECASE) or "-season-" in slug.lower():
        return "tv_show"
    return "movie"


def build_image_path(image_base_url, slug):
    if image_base_url is None:
        return None
    return f"{image_base_url}{slug}.jpg"


def parse_sitemap(provider="fmovies"):
    if provider not in PROVIDER_CONFIGS:
        print(f"Unknown provider '{provider}'. Available: {', '.join(PROVIDER_CONFIGS.keys())}", file=sys.stderr)
        sys.exit(1)

    config = PROVIDER_CONFIGS[provider]
    sitemap_url = config["sitemap_url"]
    base_url = config["base_url"]
    image_base_url = config["image_base_url"]
    db_file = config["output_db"]
    csv_file = config["output_csv"]

    print(f"Provider: {provider}")
    print(f"Sitemap: {sitemap_url}")
    print(f"Output DB: {db_file} | CSV: {csv_file}")

    root = fetch_xml(sitemap_url)
    if root is None:
        print("Failed to load root sitemap.", file=sys.stderr)
        sys.exit(1)

    sitemaps = [loc.text for loc in root.findall(".//s:sitemap/s:loc", NS) if loc.text]

    page_urls = []

    if sitemaps:
        print(f"Found {len(sitemaps)} sub-sitemaps. Fetching concurrently...")

        def process_sub_sitemap(url):
            xml_tree = fetch_xml(url)
            if xml_tree is not None:
                return [loc.text for loc in xml_tree.findall(".//s:url/s:loc", NS) if loc.text]
            return []

        with ThreadPoolExecutor(max_workers=10) as executor:
            results = executor.map(process_sub_sitemap, sitemaps)
            for urls in results:
                page_urls.extend(urls)
    else:
        page_urls = [loc.text for loc in root.findall(".//s:url/s:loc", NS) if loc.text]

    print(f"Extracted {len(page_urls)} total page URLs from sitemap.")

    records = []
    seen = set()
    for page_url in page_urls:
        if page_url in seen:
            continue
        seen.add(page_url)

        slug = extract_slug(page_url)
        if not slug or page_url.rstrip("/") == base_url.rstrip("/"):
            continue

        image_path = build_image_path(image_base_url, slug)
        media_type = detect_media_type(slug, page_url=page_url, provider=provider)
        records.append((page_url, image_path, media_type))

    # Populate SQLite DB
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    cursor.execute("DROP TABLE IF EXISTS movies")
    cursor.execute("""
        CREATE TABLE movies (
            page_url TEXT PRIMARY KEY,
            image_path TEXT,
            media_type TEXT
        )
    """)
    cursor.executemany("INSERT INTO movies (page_url, image_path, media_type) VALUES (?, ?, ?)", records)

    # Create convenience views for filtering
    cursor.execute("DROP VIEW IF EXISTS movies_only")
    cursor.execute("CREATE VIEW movies_only AS SELECT page_url, image_path FROM movies WHERE media_type = 'movie'")

    cursor.execute("DROP VIEW IF EXISTS tv_shows_only")
    cursor.execute("CREATE VIEW tv_shows_only AS SELECT page_url, image_path FROM movies WHERE media_type = 'tv_show'")

    conn.commit()
    conn.close()

    # Populate CSV
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["page_url", "image_path", "media_type"])
        writer.writerows(records)

    movie_count = sum(1 for r in records if r[2] == "movie")
    tv_count = sum(1 for r in records if r[2] == "tv_show")

    print(
        f"Successfully ingested {len(records)} records "
        f"({movie_count} movies, {tv_count} TV show seasons) "
        f"into {db_file} and {csv_file}."
    )
    return len(records)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Parse a provider sitemap into a staging DB.")
    parser.add_argument(
        "--provider",
        default="fmovies",
        choices=list(PROVIDER_CONFIGS.keys()),
        help="Provider to parse (default: fmovies)",
    )
    args = parser.parse_args()
    parse_sitemap(provider=args.provider)
