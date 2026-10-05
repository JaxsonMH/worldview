"""The REST API: the URLs the web app calls to get news.

Everything lives under /api/news so it can sit next to the globe's own /api routes.
Start it with `uv run python -m worldview_news serve` (or ./start.sh from the repo root).
Interactive docs: http://127.0.0.1:8765/docs
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

from . import config
from .db import connect, init_db
from .fetcher import fetch_all, iso
from .filters import ArticleFilter, select_articles
from .opml import export_opml, import_feeds, read_opml
from .topics import load_topics

log = logging.getLogger(__name__)


class SavedSearchIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    query: ArticleFilter
    pinned: bool = False


class ArticlePatch(BaseModel):
    read: bool | None = None
    starred: bool | None = None


class FeedPatch(BaseModel):
    enabled: bool | None = None
    folder: str | None = None
    default_topic: str | None = None


def create_app(db_path=None, start_scheduler: bool = True, import_opml: bool = True) -> FastAPI:
    conn = connect(db_path or config.DB_PATH)
    init_db(conn)
    if import_opml and config.FEEDS_OPML.exists():
        # feeds.opml is the source of truth: re-reading it on every start picks up edits.
        added, updated = import_feeds(conn, read_opml(config.FEEDS_OPML))
        log.info("feeds.opml: %d added, %d updated", added, updated)
    lock = threading.Lock()  # one writer at a time (fetcher vs. API clicks)
    scheduler = BackgroundScheduler()

    def run_fetch() -> dict:
        fetch_conn = connect(db_path or config.DB_PATH)
        try:
            with lock:
                return fetch_all(fetch_conn)
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
        row = conn.execute("SELECT * FROM articles WHERE id = ?", (article_id,)).fetchone()
        if not row:
            raise HTTPException(404, "No such article")
        return dict(row)

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

    @app.get("/api/news/feeds")
    def list_feeds():
        rows = conn.execute(
            """SELECT f.id, f.url, f.title, f.folder, f.default_topic, f.enabled, f.last_fetched,
                      f.last_error, f.error_count, count(a.id) AS article_count
               FROM feeds f LEFT JOIN articles a ON a.feed_id = f.id GROUP BY f.id ORDER BY f.folder, f.title"""
        ).fetchall()
        return [dict(r) | {"enabled": bool(r["enabled"])} for r in rows]

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
        feed = next((f for f in list_feeds() if f["id"] == feed_id), None)
        if not feed:
            raise HTTPException(404, "No such feed")
        return feed

    @app.get("/api/news/feeds.opml")
    def feeds_opml():
        return Response(export_opml(conn), media_type="text/x-opml")

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
