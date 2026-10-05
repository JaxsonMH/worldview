"""Print a random sample of Local + Canada articles with the places found, to
check by eye (CLAUDE.md Phase 1 target: >= 80% get a correct city-level pin).

    uv run python -m worldview_news.spotcheck            # 50 articles
    uv run python -m worldview_news.spotcheck 30 7       # 30 articles, sample number 7

For each article, judge: is the shown pin right? Is a town named in the text missing?
"""

from __future__ import annotations

import random
import re
import sys

from . import config
from .db import connect

MIN_CONFIDENCE = 0.6


def main(n: int = 50, seed: int = 1) -> None:
    conn = connect(config.DB_PATH)
    ids = [r[0] for r in conn.execute(
        "SELECT a.id FROM articles a JOIN feeds f ON f.id = a.feed_id WHERE f.folder IN ('Local', 'Canada')")]
    for i, article_id in enumerate(random.Random(seed).sample(ids, min(n, len(ids))), 1):
        a = conn.execute("SELECT a.title, a.summary, f.title AS feed FROM articles a JOIN feeds f ON f.id = a.feed_id "
                         "WHERE a.id = ?", (article_id,)).fetchone()
        places = conn.execute(
            """SELECT p.name, p.admin1, p.country_code, p.precision, ap.confidence FROM article_places ap
               JOIN places p ON p.id = ap.place_id WHERE ap.article_id = ? AND ap.confidence >= ?
               ORDER BY ap.order_in_text""", (article_id, MIN_CONFIDENCE)).fetchall()
        summary = re.sub(r"<[^>]+>", " ", a["summary"] or "")
        summary = re.sub(r"\s+", " ", summary).strip()[:200]
        print(f"#{i} [{a['feed']}] {a['title']}\n    {summary}")
        pins = "; ".join(f"{p['name']} ({', '.join(x for x in (p['admin1'], p['country_code']) if x)}) "
                         f"{p['precision']} {p['confidence']:.2f}" for p in places)
        print(f"    PINS: {pins or '(none)'}\n")


if __name__ == "__main__":
    main(*(int(x) for x in sys.argv[1:3]))
