"""The shared filter object: one description of "which articles", used by both
the Reader and the Globe (CLAUDE.md section 5 design rule).

A filter is plain JSON, so it can be saved as a saved search and edited later:

    {
      "q": "ferry",                      keyword in title or summary
      "ids": [12, 40],                   exactly these articles
      "feeds": [3, 7], "folders": ["Local"], "topics": ["BC Politics"],
      "since": "2026-10-01T00:00:00Z", "until": "...", "last_hours": 24,
      "read": false, "starred": true, "has_location": true,
      "country": "CA", "admin1": "BC", "city": "Victoria",
      "near": {"lat": 48.43, "lon": -123.37, "km": 50},
      "min_confidence": 0.6,
      "sort": "newest" | "oldest" | "source" | "topic",
      "limit": 100, "offset": 0
    }

Every key is optional. Unknown keys are rejected so typos don't silently match everything.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Near(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    km: float = Field(gt=0, le=20000)


class ArticleFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: str | None = None
    ids: list[int] | None = None
    feeds: list[int] | None = None
    folders: list[str] | None = None
    topics: list[str] | None = None
    since: datetime | None = None
    until: datetime | None = None
    last_hours: float | None = Field(default=None, gt=0)
    read: bool | None = None
    starred: bool | None = None
    has_location: bool | None = None
    country: str | None = None
    admin1: str | None = None
    city: str | None = None
    near: Near | None = None
    min_confidence: float = Field(default=0.6, ge=0, le=1)
    sort: Literal["newest", "oldest", "source", "topic"] = "newest"
    limit: int = Field(default=100, ge=1, le=3000)  # the globe asks for up to ~1,500 at once
    offset: int = Field(default=0, ge=0)


SORTS = {
    "newest": "a.published_at DESC",
    "oldest": "a.published_at ASC",
    "source": "f.title COLLATE NOCASE ASC, a.published_at DESC",
    "topic": "(SELECT min(topic) FROM article_topics t WHERE t.article_id = a.id) ASC, a.published_at DESC",
}


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _in(column: str, values: list) -> tuple[str, list]:
    return f"{column} IN ({','.join('?' * len(values))})", list(values)


def build_query(flt: ArticleFilter, now: datetime | None = None) -> tuple[str, list]:
    """Turn a filter into SQL (+ parameters) that selects matching article rows."""
    where: list[str] = []
    params: list = []

    def add(clause: str, *values) -> None:
        where.append(clause)
        params.extend(values)

    if flt.q:
        for word in flt.q.split():
            like = f"%{word}%"
            add("(a.title LIKE ? OR a.summary LIKE ?)", like, like)
    if flt.ids:
        clause, vals = _in("a.id", flt.ids)
        add(clause, *vals)
    if flt.feeds:
        clause, vals = _in("a.feed_id", flt.feeds)
        add(clause, *vals)
    if flt.folders:
        clause, vals = _in("f.folder", flt.folders)
        add(clause, *vals)
    if flt.topics:
        clause, vals = _in("t.topic", flt.topics)
        add(f"EXISTS (SELECT 1 FROM article_topics t WHERE t.article_id = a.id AND {clause})", *vals)
    if flt.last_hours:
        add("a.published_at >= ?", _iso((now or datetime.now(timezone.utc)) - timedelta(hours=flt.last_hours)))
    if flt.since:
        add("a.published_at >= ?", _iso(flt.since))
    if flt.until:
        add("a.published_at <= ?", _iso(flt.until))
    if flt.read is not None:
        add("a.read = ?", int(flt.read))
    if flt.starred is not None:
        add("a.starred = ?", int(flt.starred))

    # Location filters look only at confident places (or a GeoRSS point from the feed).
    place_conds: list[str] = []
    place_params: list = []
    if flt.country:
        place_conds.append("p.country_code = ?")
        place_params.append(flt.country.upper())
    if flt.admin1:
        place_conds.append("p.admin1 = ?")
        place_params.append(flt.admin1)
    if flt.city:
        place_conds.append("p.name = ? COLLATE NOCASE AND p.precision IN ('city','street','poi')")
        place_params.append(flt.city)
    if flt.near:
        place_conds.append("haversine_km(p.lat, p.lon, ?, ?) <= ?")
        place_params.extend([flt.near.lat, flt.near.lon, flt.near.km])
    place_exists = (
        "EXISTS (SELECT 1 FROM article_places ap JOIN places p ON p.id = ap.place_id "
        "WHERE ap.article_id = a.id AND ap.confidence >= ?{extra})"
    )
    if place_conds:
        clause = place_exists.format(extra="".join(f" AND {c}" for c in place_conds))
        if flt.near and not (flt.country or flt.admin1 or flt.city):
            clause = f"({clause} OR haversine_km(a.geo_lat, a.geo_lon, ?, ?) <= ?)"
            add(clause, flt.min_confidence, *place_params, flt.near.lat, flt.near.lon, flt.near.km)
        else:
            add(clause, flt.min_confidence, *place_params)
    if flt.has_location is not None:
        has = f"({place_exists.format(extra='')} OR a.geo_lat IS NOT NULL)"
        add(has if flt.has_location else f"NOT {has}", flt.min_confidence)

    sql = "FROM articles a JOIN feeds f ON f.id = a.feed_id"
    if where:
        sql += " WHERE " + " AND ".join(where)
    return sql, params


def select_articles(conn, flt: ArticleFilter, now: datetime | None = None) -> tuple[list[dict], int]:
    """Return (one page of matching articles, total number of matches)."""
    base, params = build_query(flt, now)
    total = conn.execute(f"SELECT count(*) {base}", params).fetchone()[0]
    rows = conn.execute(
        f"""SELECT a.id, a.feed_id, f.title AS feed_title, f.folder, a.url, a.title, a.summary,
                   a.author, a.published_at, a.fetched_at, a.read, a.starred, a.geo_lat, a.geo_lon
            {base} ORDER BY {SORTS[flt.sort]} LIMIT ? OFFSET ?""",
        [*params, flt.limit, flt.offset],
    ).fetchall()
    articles = [dict(r) for r in rows]
    if articles:
        ids = [a["id"] for a in articles]
        marks = ",".join("?" * len(ids))
        topics: dict[int, list] = {i: [] for i in ids}
        for r in conn.execute(f"SELECT article_id, topic, source FROM article_topics WHERE article_id IN ({marks})", ids):
            topics[r["article_id"]].append({"topic": r["topic"], "source": r["source"]})
        places: dict[int, list] = {i: [] for i in ids}
        for r in conn.execute(
            f"""SELECT ap.article_id, ap.mention_text, ap.confidence, ap.order_in_text,
                       p.name, p.country_code, p.admin1, p.lat, p.lon, p.precision
                FROM article_places ap JOIN places p ON p.id = ap.place_id
                WHERE ap.article_id IN ({marks}) AND ap.confidence >= ?
                ORDER BY ap.order_in_text""",
            [*ids, flt.min_confidence],
        ):
            places[r["article_id"]].append({k: r[k] for k in r.keys() if k != "article_id"})
        for a in articles:
            a["read"], a["starred"] = bool(a["read"]), bool(a["starred"])
            a["topics"] = topics[a["id"]]
            a["places"] = places[a["id"]]
    return articles, total
