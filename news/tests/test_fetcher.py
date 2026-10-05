from datetime import datetime, timezone

from worldview_news.fetcher import canonical_url, fetch_all
from worldview_news.opml import export_opml, import_feeds, read_opml

from .conftest import mock_client, rss


def add_feed(conn, url, title="Feed", topic="Local", folder="Local"):
    import_feeds(conn, [{"url": url, "title": title, "folder": folder, "default_topic": topic, "enabled": True}])


def test_fetch_stores_articles_and_feed_topic(conn):
    add_feed(conn, "https://a.test/rss", topic="BC Politics")
    client = mock_client({"https://a.test/rss": rss(items=[
        {"title": "Ferry delays", "link": "https://a.test/1"},
        {"title": "Budget day", "link": "https://a.test/2"},
    ])})
    assert fetch_all(conn, client) == {"Feed": 2}
    topics = conn.execute("SELECT topic, source FROM article_topics").fetchall()
    assert [tuple(t) for t in topics] == [("BC Politics", "feed_default")] * 2


def test_refetch_adds_no_duplicates(conn):
    add_feed(conn, "https://a.test/rss")
    client = mock_client({"https://a.test/rss": rss(items=[{"title": "Ferry delays", "link": "https://a.test/1"}])})
    fetch_all(conn, client)
    assert fetch_all(conn, client) == {"Feed": 0}
    assert conn.execute("SELECT count(*) FROM articles").fetchone()[0] == 1


def test_same_story_in_two_feeds_is_stored_once(conn):
    add_feed(conn, "https://a.test/top", title="Top")
    add_feed(conn, "https://a.test/politics", title="Politics")
    client = mock_client({
        "https://a.test/top": rss(items=[{"title": "Vote", "link": "https://www.a.test/vote?utm_source=rss"}]),
        "https://a.test/politics": rss(items=[{"title": "Vote", "link": "https://a.test/vote/"}]),
    })
    assert sum(fetch_all(conn, client).values()) == 1


def test_canonical_url_keeps_meaningful_query():
    assert canonical_url("http://www.x.com/a/?id=5&utm_medium=rss") == "https://x.com/a?id=5"


def test_future_dates_are_clamped_to_fetch_time(conn):
    add_feed(conn, "https://a.test/rss")
    client = mock_client({"https://a.test/rss": rss(items=[
        {"title": "Scheduled page", "link": "https://a.test/1", "date": "Sat, 17 Oct 2099 15:00:00 GMT"},
    ])})
    fetch_all(conn, client)
    row = conn.execute("SELECT published_at, fetched_at FROM articles").fetchone()
    assert row["published_at"] == row["fetched_at"]


def test_georss_point_is_kept(conn):
    add_feed(conn, "https://a.test/rss")
    client = mock_client({"https://a.test/rss": rss(items=[
        {"title": "Quake", "link": "https://a.test/q", "extra": "<georss:point>48.43 -123.37</georss:point>"},
    ])})
    fetch_all(conn, client)
    row = conn.execute("SELECT geo_lat, geo_lon FROM articles").fetchone()
    assert (row["geo_lat"], row["geo_lon"]) == (48.43, -123.37)


def test_broken_feed_is_recorded_and_others_continue(conn):
    add_feed(conn, "https://bad.test/rss", title="Bad")
    add_feed(conn, "https://a.test/rss", title="Good")
    client = mock_client({"https://bad.test/rss": 500, "https://a.test/rss": rss(items=[{"title": "x", "link": "https://a.test/x"}])})
    assert fetch_all(conn, client) == {"Bad": 0, "Good": 1}
    bad = conn.execute("SELECT error_count, last_error FROM feeds WHERE title = 'Bad'").fetchone()
    assert bad["error_count"] == 1 and "500" in bad["last_error"]


def test_opml_round_trip(conn, tmp_path):
    add_feed(conn, "https://a.test/rss", title="A", folder="Local", topic="Local")
    add_feed(conn, "https://b.test/rss", title="B", folder="World", topic="World Politics")
    path = tmp_path / "feeds.opml"
    path.write_text(export_opml(conn))
    feeds = read_opml(path)
    assert {(f["title"], f["folder"], f["default_topic"]) for f in feeds} == {
        ("A", "Local", "Local"), ("B", "World", "World Politics")}
    assert import_feeds(conn, feeds) == (0, 2)
