from worldview_news.topics import apply_rules, keyword_topics, set_manual_topics

CFG = {
    "topics": [
        {"name": "Local"}, {"name": "BC Politics", "keywords": ["legislature", "BC NDP"]},
        {"name": "Canadian Politics"},
        {"name": "Disasters & Environment", "keywords": ["wildfire", "evacuation", "flood"]},
    ],
    "place_rules": [
        {"topic": "Local", "within_box": {"south": 48.25, "north": 51.0, "west": -128.6, "east": -123.27}},
        {"topic": "BC Politics", "if_topic": "Canadian Politics", "all_places_in": {"country": "CA", "admin1": "02"},
         "needs_keyword_from": ["BC Politics"]},
    ],
}


def test_keywords_in_title_or_twice_in_summary():
    assert keyword_topics(CFG, "Wildfire forces evacuation", "") == {"Disasters & Environment"}
    assert keyword_topics(CFG, "Budget day", "a flood of bills") == set()
    assert keyword_topics(CFG, "Budget day", "flood and evacuation plans") == {"Disasters & Environment"}
    assert keyword_topics(CFG, "Legislatures across Canada", "") == set()  # whole words only


def seed(conn, places, topic="Canadian Politics"):
    conn.executescript(f"""
    INSERT INTO feeds (id, url, title, default_topic) VALUES (1, 'u', 'f', '{topic}');
    INSERT INTO articles (id, feed_id, guid, title, published_at, fetched_at, content_hash)
      VALUES (1, 1, 'g', 't', '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z', 'h');
    INSERT INTO article_topics VALUES (1, '{topic}', 'feed_default', 1);
    """)
    for i, (lat, lon, cc, a1, prec, conf) in enumerate(places, 1):
        conn.execute("INSERT INTO places (id, name, country_code, admin1, lat, lon, precision) VALUES (?,?,?,?,?,?,?)",
                     (i, f"p{i}", cc, a1, lat, lon, prec))
        conn.execute("INSERT INTO article_places VALUES (1, ?, 'm', ?, ?)", (i, conf, i))


def topics(conn):
    return {r[0] for r in conn.execute("SELECT topic FROM article_topics WHERE article_id = 1")}


def test_canadian_political_story_set_in_bc_becomes_bc_politics_and_local(conn):
    seed(conn, [(48.43, -123.37, "CA", "02", "city", 0.9), (56.1, -106.3, "CA", None, "country", 0.9)])
    assert apply_rules(conn, 1, "Budget", "The BC NDP tabled its plan", CFG) == {"BC Politics", "Local"}


def test_bc_crime_story_is_not_bc_politics(conn):
    seed(conn, [(49.25, -123.12, "CA", "02", "city", 0.9)])
    assert apply_rules(conn, 1, "Woman arrested at ferry terminal", "Police say", CFG) == set()


def test_mixed_provinces_stay_canadian(conn):
    seed(conn, [(48.43, -123.37, "CA", "02", "city", 0.9), (45.42, -75.70, "CA", "08", "city", 0.9)])
    assert apply_rules(conn, 1, "Budget", "", CFG) == {"Local"}


def test_weak_places_are_ignored(conn):
    seed(conn, [(48.43, -123.37, "CA", "02", "city", 0.4)])
    assert apply_rules(conn, 1, "Budget", "", CFG) == set()


def test_vancouver_is_not_local(conn):
    seed(conn, [(49.25, -123.12, "CA", "02", "city", 0.9)])
    assert "Local" not in apply_rules(conn, 1, "Budget", "", CFG)


def test_manual_topics_win(conn):
    seed(conn, [(48.43, -123.37, "CA", "02", "city", 0.9)])
    set_manual_topics(conn, 1, ["Technology"])
    assert apply_rules(conn, 1, "Wildfire", "", CFG) == set()
    assert topics(conn) == {"Technology"}
