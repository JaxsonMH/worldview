from fastapi.testclient import TestClient

from worldview_news.api import create_app


def make_client(tmp_path):
    return TestClient(create_app(tmp_path / "t.sqlite3", start_scheduler=False, import_opml=False))


def test_saved_search_lifecycle(tmp_path):
    with make_client(tmp_path) as c:
        r = c.post("/api/news/saved-searches", json={"name": "Island politics", "query": {"topics": ["BC Politics"], "last_hours": 24}})
        assert r.status_code == 201
        sid = r.json()["id"]
        assert r.json()["query"] == {"topics": ["BC Politics"], "last_hours": 24}

        assert c.post("/api/news/saved-searches", json={"name": "Island politics", "query": {}}).status_code == 409

        r = c.put(f"/api/news/saved-searches/{sid}", json={"name": "Island", "query": {"q": "ferry"}, "pinned": True})
        assert r.json()["name"] == "Island" and r.json()["pinned"] is True and r.json()["query"] == {"q": "ferry"}

        assert c.post("/api/news/saved-searches", json={"name": "Bad", "query": {"nope": 1}}).status_code == 422

        assert c.delete(f"/api/news/saved-searches/{sid}").status_code == 204
        assert c.get("/api/news/saved-searches").json() == []
        assert c.delete(f"/api/news/saved-searches/{sid}").status_code == 404


def test_search_and_health_on_empty_db(tmp_path):
    with make_client(tmp_path) as c:
        assert c.post("/api/news/articles/search", json={}).json() == {"total": 0, "articles": []}
        assert c.get("/api/news/health").json()["articles"] == 0
        assert len(c.get("/api/news/topics").json()) >= 9


def test_manual_retag(tmp_path):
    with make_client(tmp_path) as c:
        assert c.put("/api/news/articles/1/topics", json={"topics": ["Nope"]}).status_code == 422
        assert c.put("/api/news/articles/1/topics", json={"topics": ["Local"]}).status_code == 404


def test_feed_changes_are_written_to_opml(tmp_path):
    opml = tmp_path / "feeds.opml"
    app = create_app(tmp_path / "t.sqlite3", start_scheduler=False, import_opml=False, opml_path=opml)
    with TestClient(app) as c:
        body = """<?xml version="1.0"?><opml version="2.0"><body><outline text="Local">
          <outline type="rss" text="A" xmlUrl="https://a.test/rss" category="Local"/></outline></body></opml>"""
        assert c.post("/api/news/feeds/import", content=body).json() == {"added": 1, "updated": 0}
        feed_id = c.get("/api/news/feeds").json()[0]["id"]
        c.patch(f"/api/news/feeds/{feed_id}", json={"enabled": False})
        assert 'enabled="false"' in opml.read_text()
        assert c.post("/api/news/feeds/import", content="not xml").status_code == 422


def test_facets_and_mark_read_on_empty_db(tmp_path):
    with make_client(tmp_path) as c:
        f = c.get("/api/news/facets").json()
        assert f["folders"] == [] and f["countries"] == []
        assert c.post("/api/news/articles/mark-read", json={"topics": ["Local"]}).json() == {"marked": 0}
