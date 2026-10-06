"""The REST API: the URLs the web app calls to get news.

Everything lives under /api/news so it can sit next to the globe's own /api routes.
Start it with `uv run python -m worldview_news serve` (or ./start.sh from the repo root).
Interactive docs: http://127.0.0.1:8765/docs
"""

from __future__ import annotations

import json
import logging
import math
import sqlite3
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from . import config
from .db import connect, haversine_km, init_db
from .feedcheck import check_feed, make_client
from .fetcher import fetch_all, fetch_feed, iso
from .filters import ArticleFilter, build_query, select_articles
from .gazetteer import GAZETTEER_PATH, normalize
from .opml import export_opml, import_feeds, read_opml, read_opml_text
from .geoparser import geoparse_pending
from .topics import load_topics, set_manual_topics

log = logging.getLogger(__name__)


class SavedSearchIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    query: ArticleFilter
    pinned: bool = False


class ArticlePatch(BaseModel):
    read: bool | None = None
    starred: bool | None = None


class TopicsIn(BaseModel):
    topics: list[str]


class FeedPatch(BaseModel):
    enabled: bool | None = None
    folder: str | None = None
    default_topic: str | None = None
    title: str | None = None


class FeedIn(BaseModel):
    url: str = Field(min_length=8)
    title: str | None = None
    folder: str = "Other"
    default_topic: str | None = None


def create_app(db_path=None, start_scheduler: bool = True, import_opml: bool = True,
               opml_path=None) -> FastAPI:
    opml_path = opml_path or config.FEEDS_OPML
    conn = connect(db_path or config.DB_PATH)
    init_db(conn)
    if import_opml and opml_path.exists():
        # feeds.opml is the source of truth: re-reading it on every start picks up edits.
        added, updated = import_feeds(conn, read_opml(opml_path))
        log.info("feeds.opml: %d added, %d updated", added, updated)
    lock = threading.Lock()  # one writer at a time (fetcher vs. API clicks)
    scheduler = BackgroundScheduler()

    def run_fetch() -> dict:
        """Fetch every feed, then find places and topics for the new articles."""
        fetch_conn = connect(db_path or config.DB_PATH)
        try:
            with lock:
                new = fetch_all(fetch_conn)
            while True:
                with lock:  # in small batches, so clicks in the app aren't held up
                    if not geoparse_pending(fetch_conn, limit=50):
                        break
            return new
        except FileNotFoundError as exc:  # gazetteer not built yet
            log.warning("%s", exc)
            return new
        finally:
            fetch_conn.close()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if start_scheduler:
            scheduler.add_job(run_fetch, "interval", minutes=config.FETCH_INTERVAL_MINUTES,
                              next_run_time=datetime.now(timezone.utc), max_instances=1, coalesce=True)
            scheduler.start()
        yield
        if scheduler.running:
            scheduler.shutdown(wait=False)
        conn.close()

    app = FastAPI(title="Worldview News API", lifespan=lifespan)

    @app.get("/api/news/health")
    def health():
        feeds = conn.execute("SELECT count(*) n, sum(error_count > 0) broken FROM feeds").fetchone()
        articles = conn.execute("SELECT count(*) n, max(fetched_at) latest FROM articles").fetchone()
        return {"ok": True, "feeds": feeds["n"], "broken_feeds": feeds["broken"] or 0,
                "articles": articles["n"], "last_new_article": articles["latest"]}

    @app.post("/api/news/articles/search")
    def search_articles(flt: ArticleFilter):
        articles, total = select_articles(conn, flt)
        return {"total": total, "articles": articles}

    @app.get("/api/news/articles/{article_id}")
    def get_article(article_id: int):
        """One article with its feed name, topics and confident places (same shape as search results)."""
        articles, _ = select_articles(conn, ArticleFilter(ids=[article_id]))
        if not articles:
            raise HTTPException(404, "No such article")
        return articles[0]

    @app.patch("/api/news/articles/{article_id}")
    def patch_article(article_id: int, patch: ArticlePatch):
        changes = patch.model_dump(exclude_none=True)
        if changes:
            with lock:
                sets = ", ".join(f"{k} = ?" for k in changes)
                cur = conn.execute(f"UPDATE articles SET {sets} WHERE id = ?", [*map(int, changes.values()), article_id])
                conn.commit()
            if not cur.rowcount:
                raise HTTPException(404, "No such article")
        return get_article(article_id)

    @app.put("/api/news/articles/{article_id}/topics")
    def put_topics(article_id: int, body: TopicsIn):
        """Re-tag an article by hand; automatic tagging leaves it alone afterwards."""
        known = {t["name"] for t in load_topics(config.TOPICS_YAML)}
        unknown = set(body.topics) - known
        if unknown:
            raise HTTPException(422, f"Unknown topic(s): {', '.join(sorted(unknown))}")
        get_article(article_id)
        with lock:
            set_manual_topics(conn, article_id, body.topics)
            conn.commit()
        return {"topics": body.topics}

    @app.get("/api/news/feeds")
    def list_feeds():
        rows = conn.execute(
            """SELECT f.id, f.url, f.title, f.folder, f.default_topic, f.enabled, f.last_fetched,
                      f.last_error, f.error_count, count(a.id) AS article_count
               FROM feeds f LEFT JOIN articles a ON a.feed_id = f.id GROUP BY f.id ORDER BY f.folder, f.title"""
        ).fetchall()
        return [dict(r) | {"enabled": bool(r["enabled"])} for r in rows]

    def save_opml() -> None:
        """Changes made in the app are written back to feeds.opml, so it stays the source of truth."""
        opml_path.parent.mkdir(parents=True, exist_ok=True)
        opml_path.write_text(export_opml(conn))

    @app.patch("/api/news/feeds/{feed_id}")
    def patch_feed(feed_id: int, patch: FeedPatch):
        changes = patch.model_dump(exclude_none=True)
        if "enabled" in changes:
            changes["enabled"] = int(changes["enabled"])
        if changes:
            with lock:
                sets = ", ".join(f"{k} = ?" for k in changes)
                conn.execute(f"UPDATE feeds SET {sets} WHERE id = ?", [*changes.values(), feed_id])
                conn.commit()
                save_opml()
        feed = next((f for f in list_feeds() if f["id"] == feed_id), None)
        if not feed:
            raise HTTPException(404, "No such feed")
        return feed

    @app.post("/api/news/feeds", status_code=201)
    def add_feed(body: FeedIn):
        """Check the URL really is a working feed, then add it and fetch it once."""
        if conn.execute("SELECT 1 FROM feeds WHERE url = ?", (body.url,)).fetchone():
            raise HTTPException(409, "That feed is already in your list")
        with make_client() as client:
            check = check_feed(body.url, client)
            if not check.ok:
                raise HTTPException(422, f"That address isn't a working feed: {check.problem}")
            with lock:
                import_feeds(conn, [{"url": body.url, "title": body.title or check.title or body.url,
                                     "folder": body.folder, "default_topic": body.default_topic, "enabled": True}])
                save_opml()
                feed = conn.execute("SELECT * FROM feeds WHERE url = ?", (body.url,)).fetchone()
                fetch_feed(conn, feed, client)
        return next(f for f in list_feeds() if f["url"] == body.url)

    @app.post("/api/news/feeds/import")
    async def import_opml_upload(request: Request):
        """Body: the text of an OPML file (e.g. exported from another reader)."""
        try:
            feeds = read_opml_text((await request.body()).decode("utf-8", "replace"))
        except Exception:
            raise HTTPException(422, "That file isn't valid OPML")
        with lock:
            added, updated = import_feeds(conn, feeds)
            save_opml()
        return {"added": added, "updated": updated}

    @app.get("/api/news/feeds.opml")
    def feeds_opml():
        return Response(export_opml(conn), media_type="text/x-opml")

    @app.post("/api/news/articles/mark-read")
    def mark_read(flt: ArticleFilter):
        """Mark every article matching the filter as read."""
        base, params = build_query(flt)
        with lock:
            cur = conn.execute(f"UPDATE articles SET read = 1 WHERE id IN (SELECT a.id {base})", params)
            conn.commit()
        return {"marked": cur.rowcount}

    def gazetteer() -> sqlite3.Connection | None:
        if not GAZETTEER_PATH.exists():
            return None
        gz = sqlite3.connect(f"file:{GAZETTEER_PATH}?mode=ro", uri=True)
        gz.row_factory = sqlite3.Row
        return gz

    @app.get("/api/news/facets")
    def facets():
        """Counts for the sidebar and the location pickers."""
        folders = conn.execute(
            """SELECT f.folder, count(a.id) total, sum(a.read = 0) unread FROM feeds f
               LEFT JOIN articles a ON a.feed_id = f.id WHERE f.enabled = 1 GROUP BY f.folder ORDER BY f.folder""").fetchall()
        feeds = conn.execute(
            """SELECT f.id, f.title, f.folder, f.error_count, count(a.id) total, sum(a.read = 0) unread FROM feeds f
               LEFT JOIN articles a ON a.feed_id = f.id WHERE f.enabled = 1 GROUP BY f.id ORDER BY f.title""").fetchall()
        topics = conn.execute(
            """SELECT t.topic, count(*) total, sum(a.read = 0) unread FROM article_topics t
               JOIN articles a ON a.id = t.article_id GROUP BY t.topic""").fetchall()
        places = conn.execute(
            """SELECT p.country_code, p.admin1, p.name, p.precision, count(DISTINCT ap.article_id) n
               FROM article_places ap JOIN places p ON p.id = ap.place_id
               WHERE ap.confidence >= 0.6 AND p.country_code IS NOT NULL GROUP BY p.id""").fetchall()
        countries: dict[str, int] = {}
        regions: dict[tuple, int] = {}
        cities: dict[tuple, int] = {}
        for p in places:
            countries[p["country_code"]] = countries.get(p["country_code"], 0) + p["n"]
            if p["admin1"]:
                key = (p["country_code"], p["admin1"])
                regions[key] = regions.get(key, 0) + p["n"]
            if p["precision"] == "city":
                key = (p["country_code"], p["admin1"], p["name"])
                cities[key] = cities.get(key, 0) + p["n"]
        names: dict = {}
        gz = gazetteer()
        if gz:
            for r in gz.execute("SELECT kind, country_code, admin1, name FROM gz_places WHERE kind IN ('country','region')"):
                names[(r["country_code"],) if r["kind"] == "country" else (r["country_code"], r["admin1"])] = r["name"]
            gz.close()
        return {
            "folders": [dict(r) | {"unread": r["unread"] or 0} for r in folders],
            "feeds": [dict(r) | {"unread": r["unread"] or 0} for r in feeds],
            "topics": [dict(r) | {"unread": r["unread"] or 0} for r in topics],
            "countries": sorted(({"code": k, "name": names.get((k,), k), "count": v} for k, v in countries.items()),
                                key=lambda x: -x["count"]),
            "regions": sorted(({"country": k[0], "admin1": k[1], "name": names.get(k, k[1]), "count": v}
                               for k, v in regions.items()), key=lambda x: -x["count"]),
            "cities": sorted(({"country": k[0], "admin1": k[1], "name": k[2], "count": v} for k, v in cities.items()),
                             key=lambda x: -x["count"]),
        }

    def home_country() -> str:
        """The owner's home country (the Local folder's home region in geoparser.yaml)."""
        from .geoparser import load_settings

        homes = load_settings().get("home_regions") or {}
        return (homes.get("Local") or {}).get("country", "")

    anchors_cache: dict = {}

    @app.get("/api/news/anchors")
    def anchors():
        """Map points for every country and province/state, used when the globe
        groups stories by country or province. A country's point is the middle of
        its towns (so "Canada" isn't drawn on Ottawa); provinces use the gazetteer's."""
        if anchors_cache:
            return anchors_cache
        gz = gazetteer()
        if not gz:
            return {"countries": {}, "regions": {}}
        try:
            sums: dict[str, list[float]] = {}
            for r in gz.execute("SELECT country_code, lat, lon FROM gz_places WHERE kind = 'city'"):
                la, lo = math.radians(r["lat"]), math.radians(r["lon"])
                acc = sums.setdefault(r["country_code"], [0.0, 0.0, 0.0])
                acc[0] += math.cos(la) * math.cos(lo)
                acc[1] += math.cos(la) * math.sin(lo)
                acc[2] += math.sin(la)
            countries = {}
            for r in gz.execute("SELECT country_code, name, lat, lon FROM gz_places WHERE kind = 'country'"):
                x, y, z = sums.get(r["country_code"], (0, 0, 0))
                if x or y or z:  # average on the sphere, so countries across the date line work
                    lat = math.degrees(math.atan2(z, math.hypot(x, y)))
                    lon = math.degrees(math.atan2(y, x))
                else:
                    lat, lon = r["lat"], r["lon"]
                countries[r["country_code"]] = {"name": r["name"], "lat": round(lat, 3), "lon": round(lon, 3)}
            regions = {
                f"{r['country_code']}.{r['admin1']}": {"name": r["name"], "lat": round(r["lat"], 3), "lon": round(r["lon"], 3)}
                for r in gz.execute("SELECT country_code, admin1, name, lat, lon FROM gz_places WHERE kind = 'region'")
            }
        finally:
            gz.close()
        anchors_cache.update(countries=countries, regions=regions)
        return anchors_cache

    @app.get("/api/news/places/nearest")
    def place_nearest(lat: float, lon: float):
        """Name a point on the globe: the nearest town (or else province/country)."""
        gz = gazetteer()
        if not gz:
            return None
        try:
            box = 1.5
            rows = gz.execute(
                """SELECT p.name, p.kind, p.country_code, p.admin1, p.lat, p.lon, p.population,
                          (SELECT r.name FROM gz_places r WHERE r.kind = 'region' AND r.country_code = p.country_code
                             AND r.admin1 = p.admin1) AS region
                   FROM gz_places p WHERE p.kind = 'city' AND p.population >= 1000
                   AND p.lat BETWEEN ? AND ? AND p.lon BETWEEN ? AND ?""",
                (lat - box, lat + box, lon - box * 2, lon + box * 2),
            ).fetchall()
            if not rows:
                return None
            # The biggest town within 15 km ("London", not "Lambeth"), otherwise the nearest.
            close = [r for r in rows if haversine_km(lat, lon, r["lat"], r["lon"]) <= 15]
            best = (max(close, key=lambda r: r["population"]) if close
                    else min(rows, key=lambda r: haversine_km(lat, lon, r["lat"], r["lon"])))
            return dict(best) | {"distance_km": round(haversine_km(lat, lon, best["lat"], best["lon"]), 1)}
        finally:
            gz.close()

    @app.get("/api/news/places/search")
    def place_search(q: str, limit: int = 8):
        """Look up a place by name (for "within X km of ..."), biggest first."""
        key = normalize(q)
        gz = gazetteer()
        if not gz or len(key) < 2:
            return []
        try:
            rows = gz.execute(
                """SELECT DISTINCT p.geonames_id, p.name, p.kind, p.country_code, p.admin1, p.lat, p.lon, p.population,
                          (SELECT r.name FROM gz_places r WHERE r.kind = 'region' AND r.country_code = p.country_code
                             AND r.admin1 = p.admin1) AS region
                   FROM gz_names n JOIN gz_places p USING (geonames_id)
                   WHERE n.name >= ? AND n.name < ? AND n.is_primary = 1
                   ORDER BY p.country_code = ? DESC, p.population DESC LIMIT ?""",
                (key, key + "\uffff", home_country(), min(limit, 20))).fetchall()
            return [dict(r) for r in rows]
        finally:
            gz.close()

    @app.post("/api/news/fetch")
    def fetch_now():
        return {"new_articles": run_fetch()}

    @app.get("/api/news/topics")
    def topics():
        return load_topics(config.TOPICS_YAML)

    def saved_row(row: sqlite3.Row) -> dict:
        return {"id": row["id"], "name": row["name"], "query": json.loads(row["query_json"]),
                "pinned": bool(row["pinned"]), "created": row["created"], "updated": row["updated"]}

    @app.get("/api/news/saved-searches")
    def list_saved():
        return [saved_row(r) for r in conn.execute("SELECT * FROM saved_searches ORDER BY pinned DESC, name")]

    @app.post("/api/news/saved-searches", status_code=201)
    def create_saved(body: SavedSearchIn):
        stamp = iso(datetime.now(timezone.utc))
        with lock:
            try:
                cur = conn.execute(
                    "INSERT INTO saved_searches (name, query_json, pinned, created, updated) VALUES (?, ?, ?, ?, ?)",
                    (body.name, body.query.model_dump_json(exclude_defaults=True), int(body.pinned), stamp, stamp),
                )
                conn.commit()
            except sqlite3.IntegrityError:
                raise HTTPException(409, f"A saved search called {body.name!r} already exists")
        return saved_row(conn.execute("SELECT * FROM saved_searches WHERE id = ?", (cur.lastrowid,)).fetchone())

    @app.put("/api/news/saved-searches/{search_id}")
    def update_saved(search_id: int, body: SavedSearchIn):
        with lock:
            try:
                cur = conn.execute(
                    "UPDATE saved_searches SET name = ?, query_json = ?, pinned = ?, updated = ? WHERE id = ?",
                    (body.name, body.query.model_dump_json(exclude_defaults=True), int(body.pinned),
                     iso(datetime.now(timezone.utc)), search_id),
                )
                conn.commit()
            except sqlite3.IntegrityError:
                raise HTTPException(409, f"A saved search called {body.name!r} already exists")
        if not cur.rowcount:
            raise HTTPException(404, "No such saved search")
        return saved_row(conn.execute("SELECT * FROM saved_searches WHERE id = ?", (search_id,)).fetchone())

    @app.delete("/api/news/saved-searches/{search_id}", status_code=204)
    def delete_saved(search_id: int):
        with lock:
            cur = conn.execute("DELETE FROM saved_searches WHERE id = ?", (search_id,))
            conn.commit()
        if not cur.rowcount:
            raise HTTPException(404, "No such saved search")

    return app
