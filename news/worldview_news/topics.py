"""Topics: the list lives in config/worldview/topics.yaml (never hard-coded).

Tagging order (CLAUDE.md section 8):
1. feed default   - every article gets its feed's topic (done by the fetcher)
2. keyword rules  - a topic's `keywords` appear in the title (or twice in the summary)
3. place rules    - `place_rules` in topics.yaml, using the places the geoparser found
4. manual         - set in the app; replaces the automatic tags for that article
"""

from __future__ import annotations

import re
import sqlite3
from functools import lru_cache
from pathlib import Path

import yaml

from . import config

MIN_PLACE_CONFIDENCE = 0.6


def load_config(path: Path | None = None) -> dict:
    with open(path or config.TOPICS_YAML) as fh:
        return yaml.safe_load(fh)


def load_topics(path: Path | None = None) -> list[dict]:
    return load_config(path)["topics"]


@lru_cache(maxsize=256)
def _keyword_re(word: str) -> re.Pattern:
    return re.compile(rf"(?<![\w]){re.escape(word)}(?![\w])", re.IGNORECASE)


def keyword_topics(cfg: dict, title: str, summary: str, current: set[str] | None = None) -> set[str]:
    found = set()
    for topic in cfg["topics"]:
        words = topic.get("keywords") or []
        needed = topic.get("only_with_topics")
        if needed and current is not None and not set(needed) & current:
            continue
        in_title = any(_keyword_re(w).search(title or "") for w in words)
        in_summary = sum(1 for w in words if _keyword_re(w).search(summary or ""))
        if in_title or in_summary >= 2:
            found.add(topic["name"])
    return found


def mentions_any_keyword(cfg: dict, topic_names: list[str], text: str) -> bool:
    words = [w for t in cfg["topics"] if t["name"] in topic_names for w in t.get("keywords") or []]
    return any(_keyword_re(w).search(text or "") for w in words)


def place_topics(cfg: dict, current: set[str], places: list[sqlite3.Row], text: str = "") -> set[str]:
    found = set()
    confident = [p for p in places if p["confidence"] >= MIN_PLACE_CONFIDENCE and p["precision"] != "country"]
    for rule in cfg.get("place_rules") or []:
        if "within_box" in rule:
            b = rule["within_box"]
            if any(b["south"] <= p["lat"] <= b["north"] and b["west"] <= p["lon"] <= b["east"] for p in confident):
                found.add(rule["topic"])
        wanted = rule.get("if_topic")
        wanted = set(wanted) if isinstance(wanted, list) else {wanted}
        if "all_places_in" in rule and wanted & current and confident:
            if rule.get("needs_keyword_from") and not mentions_any_keyword(cfg, rule["needs_keyword_from"], text):
                continue
            want = rule["all_places_in"]
            if all(p["country_code"] == want.get("country") and
                   ("admin1" not in want or p["admin1"] == str(want["admin1"])) for p in confident):
                found.add(rule["topic"])
    return found


def apply_rules(conn: sqlite3.Connection, article_id: int, title: str, summary: str, cfg: dict) -> set[str]:
    """Add rule-based topics to one article. Returns the topics added."""
    rows = conn.execute("SELECT topic, source FROM article_topics WHERE article_id = ?", (article_id,)).fetchall()
    if any(r["source"] == "manual" for r in rows):
        return set()  # the owner has decided; don't second-guess
    current = {r["topic"] for r in rows}
    places = conn.execute(
        """SELECT p.lat, p.lon, p.country_code, p.admin1, p.precision, ap.confidence
           FROM article_places ap JOIN places p ON p.id = ap.place_id WHERE ap.article_id = ?""", (article_id,)
    ).fetchall()
    new = keyword_topics(cfg, title, summary, current)
    new |= place_topics(cfg, current | new, places, f"{title}\n{summary}")
    new -= current
    conn.executemany(
        "INSERT OR IGNORE INTO article_topics (article_id, topic, source, confidence) VALUES (?, ?, 'rule', 0.8)",
        [(article_id, t) for t in new],
    )
    return new


def refresh_feed_defaults(conn: sqlite3.Connection) -> None:
    """Re-apply each feed's current default topic to its articles (so changing a
    feed's topic also re-labels its old articles). Hand-tagged articles are left alone."""
    manual = "SELECT article_id FROM article_topics WHERE source = 'manual'"
    conn.execute(f"DELETE FROM article_topics WHERE source = 'feed_default' AND article_id NOT IN ({manual})")
    conn.execute(
        f"""INSERT OR IGNORE INTO article_topics (article_id, topic, source)
            SELECT a.id, f.default_topic, 'feed_default' FROM articles a JOIN feeds f ON f.id = a.feed_id
            WHERE f.default_topic IS NOT NULL AND a.id NOT IN ({manual})""")


def set_manual_topics(conn: sqlite3.Connection, article_id: int, topics: list[str]) -> None:
    conn.execute("DELETE FROM article_topics WHERE article_id = ?", (article_id,))
    conn.executemany(
        "INSERT INTO article_topics (article_id, topic, source, confidence) VALUES (?, ?, 'manual', 1.0)",
        [(article_id, t) for t in dict.fromkeys(topics)],
    )
