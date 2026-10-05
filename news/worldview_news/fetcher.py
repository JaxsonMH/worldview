"""Download every enabled feed and save new articles.

Plain-English rules:
- Polite: sends ETag / Last-Modified so unchanged feeds cost almost nothing.
- No duplicates: an article is identified by its link (with tracking junk such
  as utm_* removed). The same story in two feeds (e.g. CBC Top Stories and CBC
  Politics) is stored once. Items without a link fall back to feed + guid.
- Honest dates: some feeds stamp items in the future (scheduled pages, or a
  wrong time zone). Anything more than 10 minutes ahead of "now" is treated as
  "published when we first saw it".
- One broken feed never stops the others; its error is saved and shown later.
"""

from __future__ import annotations

import calendar
import hashlib
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import feedparser
import httpx

from .feedcheck import make_client

log = logging.getLogger(__name__)

FUTURE_TOLERANCE = timedelta(minutes=10)
TRACKING_PARAMS = {"cmp", "ref", "taid", "ito", "fbclid", "gclid", "mc_cid", "mc_eid", "cmpid", "ocid"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical_url(url: str) -> str:
    parts = urlsplit(url.strip())
    query = [(k, v) for k, v in parse_qsl(parts.query) if not (k.lower().startswith("utm_") or k.lower() in TRACKING_PARAMS)]
    host = parts.netloc.lower().removeprefix("www.")
    return urlunsplit(("https", host, parts.path.rstrip("/"), urlencode(query), ""))


def content_hash(feed_id: int, guid: str, url: str | None) -> str:
    key = canonical_url(url) if url else f"feed:{feed_id}:{guid}"
    return hashlib.sha256(key.encode()).hexdigest()


def entry_published(entry, fetched: datetime) -> datetime:
    stamp = entry.get("published_parsed") or entry.get("updated_parsed")
    if not stamp:
        return fetched
    published = datetime.fromtimestamp(calendar.timegm(stamp), timezone.utc)
    return fetched if published > fetched + FUTURE_TOLERANCE else published


def entry_geo(entry) -> tuple[float | None, float | None]:
    """GeoRSS point if the feed provides one (step 1 of the geolocation pipeline)."""
    point = entry.get("where", {}).get("coordinates") if isinstance(entry.get("where"), dict) else None
    if point and len(point) == 2:  # GeoJSON order: lon, lat
        return float(point[1]), float(point[0])
    raw = entry.get("georss_point")
    if raw:
        try:
            lat, lon = (float(x) for x in raw.split())
            return lat, lon
        except ValueError:
            pass
    return None, None


def store_entries(conn: sqlite3.Connection, feed: sqlite3.Row, parsed, fetched: datetime) -> int:
    new = 0
    for entry in parsed.entries:
        title = (entry.get("title") or "").strip()
        url = entry.get("link")
        guid = entry.get("id") or url or title
        if not title or not guid:
            continue
        content = entry.get("content", [{}])[0].get("value") if entry.get("content") else None
        lat, lon = entry_geo(entry)
        cur = conn.execute(
            """INSERT INTO articles (feed_id, guid, url, title, summary, content, author,
                                     published_at, fetched_at, content_hash, geo_lat, geo_lon)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(content_hash) DO NOTHING""",
            (feed["id"], guid, url, title, entry.get("summary"), content, entry.get("author"),
             iso(entry_published(entry, fetched)), iso(fetched), content_hash(feed["id"], guid, url), lat, lon),
        )
        if cur.rowcount:
            new += 1
            if feed["default_topic"]:
                conn.execute(
                    "INSERT OR IGNORE INTO article_topics (article_id, topic, source) VALUES (?, ?, 'feed_default')",
                    (cur.lastrowid, feed["default_topic"]),
                )
    return new


def fetch_feed(conn: sqlite3.Connection, feed: sqlite3.Row, client: httpx.Client) -> int:
    fetched = now_utc()
    headers = {}
    if feed["etag"]:
        headers["If-None-Match"] = feed["etag"]
    if feed["last_modified"]:
        headers["If-Modified-Since"] = feed["last_modified"]
    try:
        resp = client.get(feed["url"], headers=headers)
        if resp.status_code == 304:
            new = 0
        else:
            resp.raise_for_status()
            parsed = feedparser.parse(resp.content)
            if not parsed.entries and parsed.bozo:
                raise ValueError(f"not a valid feed ({parsed.bozo_exception})")
            new = store_entries(conn, feed, parsed, fetched)
        conn.execute(
            """UPDATE feeds SET last_fetched=?, last_error=NULL, error_count=0,
                 etag=COALESCE(?, etag), last_modified=COALESCE(?, last_modified) WHERE id=?""",
            (iso(fetched), resp.headers.get("ETag"), resp.headers.get("Last-Modified"), feed["id"]),
        )
        conn.commit()
        return new
    except (httpx.HTTPError, ValueError) as exc:
        conn.rollback()
        conn.execute(
            "UPDATE feeds SET last_fetched=?, last_error=?, error_count=error_count+1 WHERE id=?",
            (iso(fetched), str(exc)[:500], feed["id"]),
        )
        conn.commit()
        log.warning("feed %s failed: %s", feed["url"], exc)
        return 0


def fetch_all(conn: sqlite3.Connection, client: httpx.Client | None = None) -> dict[str, int]:
    own = client is None
    client = client or make_client()
    try:
        results = {}
        for feed in conn.execute("SELECT * FROM feeds WHERE enabled = 1").fetchall():
            results[feed["title"]] = fetch_feed(conn, feed, client)
        return results
    finally:
        if own:
            client.close()
