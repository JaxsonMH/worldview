from fastapi.testclient import TestClient

from worldview_news.api import create_app


def make_client(tmp_path):
    return TestClient(create_app(tmp_path / "t.sqlite3", start_scheduler=False))


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
