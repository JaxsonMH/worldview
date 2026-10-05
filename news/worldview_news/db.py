"""The database: one SQLite file. This module creates the tables and opens connections.

Table layout follows CLAUDE.md section 6. `CREATE TABLE IF NOT EXISTS` means
running `init_db` again is always safe.
"""

from __future__ import annotations

import math
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS feeds (
    id            INTEGER PRIMARY KEY,
    url           TEXT NOT NULL UNIQUE,
    title         TEXT NOT NULL,
    default_topic TEXT,
    folder        TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    last_fetched  TEXT,
    last_error    TEXT,
    error_count   INTEGER NOT NULL DEFAULT 0,
    etag          TEXT,
    last_modified TEXT
);

CREATE TABLE IF NOT EXISTS articles (
    id           INTEGER PRIMARY KEY,
    feed_id      INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid         TEXT NOT NULL,
    url          TEXT,
    title        TEXT NOT NULL,
    summary      TEXT,
    content      TEXT,
    author       TEXT,
    published_at TEXT NOT NULL,
    fetched_at   TEXT NOT NULL,
    read         INTEGER NOT NULL DEFAULT 0,
    starred      INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL UNIQUE,
    geo_lat      REAL,
    geo_lon      REAL
);
CREATE INDEX IF NOT EXISTS articles_published ON articles(published_at);
CREATE INDEX IF NOT EXISTS articles_feed ON articles(feed_id);

CREATE TABLE IF NOT EXISTS places (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    country_code TEXT,
    admin1       TEXT,
    lat          REAL NOT NULL,
    lon          REAL NOT NULL,
    precision    TEXT NOT NULL CHECK (precision IN ('country','region','city','street','poi')),
    geonames_id  INTEGER,
    osm_id       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS places_geonames ON places(geonames_id) WHERE geonames_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS places_osm ON places(osm_id) WHERE osm_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS article_places (
    article_id    INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    place_id      INTEGER NOT NULL REFERENCES places(id),
    mention_text  TEXT,
    confidence    REAL NOT NULL,
    order_in_text INTEGER NOT NULL,
    PRIMARY KEY (article_id, place_id)
);

CREATE TABLE IF NOT EXISTS article_topics (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    topic      TEXT NOT NULL,
    source     TEXT NOT NULL CHECK (source IN ('feed_default','rule','model','manual')),
    confidence REAL NOT NULL DEFAULT 1.0,
    PRIMARY KEY (article_id, topic)
);

CREATE TABLE IF NOT EXISTS saved_searches (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    query_json TEXT NOT NULL,
    pinned     INTEGER NOT NULL DEFAULT 0,
    created    TEXT NOT NULL,
    updated    TEXT NOT NULL
);
"""


def haversine_km(lat1, lon1, lat2, lon2):
    """Distance in km between two points on Earth (used for "within X km")."""
    if None in (lat1, lon1, lat2, lon2):
        return None
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def connect(path: Path | str) -> sqlite3.Connection:
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")  # lets the API read while the fetcher writes
    conn.create_function("haversine_km", 4, haversine_km, deterministic=True)
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()
