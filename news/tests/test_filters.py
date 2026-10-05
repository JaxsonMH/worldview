from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from worldview_news.filters import ArticleFilter, select_articles

NOW = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)


@pytest.fixture
def db(conn):
    conn.executescript("""
    INSERT INTO feeds (id, url, title, folder, default_topic) VALUES
      (1, 'https://tc/rss', 'Times Colonist', 'Local', 'Local'),
      (2, 'https://bbc/rss', 'BBC World', 'World', 'World Politics');
    INSERT INTO articles (id, feed_id, guid, url, title, summary, published_at, fetched_at, content_hash, read, starred) VALUES
      (1, 1, 'g1', 'u1', 'Ferry sailings cancelled', 'BC Ferries cancels', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z', 'h1', 0, 1),
      (2, 1, 'g2', 'u2', 'Legislature sits', 'Victoria debate', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z', 'h2', 1, 0),
      (3, 2, 'g3', 'u3', 'Summit in Paris', 'Leaders meet', '2026-10-05T11:00:00Z', '2026-10-05T11:00:00Z', 'h3', 0, 0),
      (4, 2, 'g4', 'u4', 'Unplaced story', 'No place', '2026-10-04T11:00:00Z', '2026-10-04T11:00:00Z', 'h4', 0, 0);
    INSERT INTO article_topics VALUES (1, 'Local', 'feed_default', 1), (2, 'BC Politics', 'rule', 0.9),
      (3, 'World Politics', 'feed_default', 1), (4, 'World Politics', 'feed_default', 1);
    INSERT INTO places (id, name, country_code, admin1, lat, lon, precision) VALUES
      (1, 'Victoria', 'CA', 'BC', 48.4284, -123.3656, 'city'),
      (2, 'Paris', 'FR', '11', 48.8566, 2.3522, 'city'),
      (3, 'Nanaimo', 'CA', 'BC', 49.1659, -123.9401, 'city');
    INSERT INTO article_places VALUES (1, 1, 'Victoria', 0.9, 0), (1, 3, 'Nanaimo', 0.4, 1),
      (2, 1, 'Victoria', 0.95, 0), (3, 2, 'Paris', 0.9, 0);
    """)
    return conn


def ids(conn, **kw):
    articles, total = select_articles(conn, ArticleFilter(**kw), now=NOW)
    assert total == len(articles)
    return [a["id"] for a in articles]


def test_default_is_newest_first(db):
    assert ids(db) == [3, 1, 4, 2]


def test_oldest_and_source_sort(db):
    assert ids(db, sort="oldest") == [2, 4, 1, 3]
    assert ids(db, sort="source") == [3, 4, 1, 2]


def test_keyword_matches_title_or_summary_all_words(db):
    assert ids(db, q="ferries") == [1]
    assert ids(db, q="victoria debate") == [2]
    assert ids(db, q="victoria paris") == []


def test_feed_folder_topic(db):
    assert ids(db, feeds=[2]) == [3, 4]
    assert ids(db, folders=["Local"]) == [1, 2]
    assert ids(db, topics=["BC Politics", "Local"]) == [1, 2]


def test_dates(db):
    assert ids(db, last_hours=24) == [3, 1]
    assert ids(db, last_hours=26) == [3, 1, 4]
    assert ids(db, since="2026-10-02T00:00:00Z", until="2026-10-05T10:30:00Z") == [1, 4]


def test_read_starred(db):
    assert ids(db, read=False) == [3, 1, 4]
    assert ids(db, starred=True) == [1]


def test_location_hierarchy(db):
    assert ids(db, country="ca") == [1, 2]
    assert ids(db, country="CA", admin1="BC", city="victoria") == [1, 2]
    assert ids(db, country="FR") == [3]


def test_weak_place_guesses_are_ignored(db):
    # Article 1 mentions Nanaimo only with confidence 0.4, below the 0.6 default.
    assert ids(db, city="Nanaimo") == []
    assert ids(db, city="Nanaimo", min_confidence=0.3) == [1]


def test_near_point(db):
    assert ids(db, near={"lat": 48.45, "lon": -123.4, "km": 20}) == [1, 2]
    assert ids(db, near={"lat": 48.45, "lon": -123.4, "km": 20}, last_hours=24) == [1]


def test_has_location(db):
    assert ids(db, has_location=False) == [4]
    assert ids(db, has_location=True) == [3, 1, 2]


def test_results_carry_topics_and_confident_places_in_order(db):
    articles, _ = select_articles(db, ArticleFilter(feeds=[1], sort="newest"), now=NOW)
    first = articles[0]
    assert first["starred"] is True
    assert [p["name"] for p in first["places"]] == ["Victoria"]
    assert first["topics"] == [{"topic": "Local", "source": "feed_default"}]


def test_unknown_filter_keys_are_rejected():
    with pytest.raises(ValidationError):
        ArticleFilter(topic="typo")


def test_paging(db):
    articles, total = select_articles(db, ArticleFilter(limit=2), now=NOW)
    assert [a["id"] for a in articles] == [3, 1] and total == 4
    articles, total = select_articles(db, ArticleFilter(limit=2, offset=2), now=NOW)
    assert [a["id"] for a in articles] == [4, 2] and total == 4
