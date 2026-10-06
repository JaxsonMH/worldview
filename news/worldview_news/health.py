"""`make health`: check every part of Worldview and say what's wrong in plain English.

    uv run python -m worldview_news.health

✅ working   ⚠️ works but needs attention (e.g. needs a free key)   ❌ broken
Exits with an error code if anything is ❌, so it can be used in scripts.
"""

from __future__ import annotations

import sys
import time

import httpx

from . import config
from .db import connect, init_db
from .feedcheck import check_feed, make_client
from .gazetteer import GAZETTEER_PATH

OK, WARN, BAD = "✅", "⚠️ ", "❌"


def main() -> int:
    problems = 0
    lines: list[str] = []

    def report(mark: str, text: str) -> None:
        nonlocal problems
        problems += mark == BAD
        lines.append(f"  {mark} {text}")
        print(lines[-1], flush=True)

    print("\nWorldview health check\n")
    print("Basics")
    report(OK if GAZETTEER_PATH.exists() else BAD,
           "Place list (gazetteer) is built" if GAZETTEER_PATH.exists()
           else "Place list missing: run  cd news && uv run python -m worldview_news gazetteer")
    conn = connect(config.DB_PATH)
    init_db(conn)
    n_articles = conn.execute("SELECT count(*) FROM articles").fetchone()[0]
    latest = conn.execute("SELECT max(fetched_at) FROM articles").fetchone()[0]
    report(OK if n_articles else WARN, f"Database has {n_articles:,} articles" + (f", newest fetched {latest}" if latest else ""))
    for name, url in (("News service", f"http://{config.API_HOST}:{config.API_PORT}/api/news/health"),
                      ("Globe app", "http://localhost:4173/globe.html")):
        try:
            ok = httpx.get(url, timeout=5).status_code == 200
        except httpx.HTTPError:
            ok = False
        report(OK if ok else WARN, f"{name} is running" if ok else f"{name} isn't running (start everything with ./start.sh)")

    print("\nNews feeds")
    feeds = conn.execute("SELECT title, url FROM feeds WHERE enabled = 1 ORDER BY title").fetchall()
    with make_client() as client:
        for f in feeds:
            res = check_feed(f["url"], client)
            if res.ok and not res.stale:
                report(OK, f"{f['title']}: {res.items} items")
            elif res.ok:
                report(WARN, f"{f['title']}: works, but nothing new for {res.newest_age_hours / 24:.0f} days")
            else:
                report(BAD, f"{f['title']}: {res.problem}")

    print("\nLive data sources")
    from .sources import Registry

    from .gazetteer import compute_anchors

    places = compute_anchors()
    registry = Registry(config.load_keys(), anchors=lambda: places)
    for sid, source in registry.sources.items():
        if not registry.configured(source):
            report(WARN, f"{source.name}: needs a free key ({', '.join(source.needs_key)}), see docs/worldview/ADDING-A-KEY.md")
            continue
        t = time.time()
        res = registry.get(sid, force=True)
        if res["error"]:
            report(BAD, f"{source.name}: {res['error']}")
        else:
            report(OK, f"{source.name}: {len(res['events']):,} items ({time.time() - t:.1f}s)")

    print("\nGlobe engine layers: run  npm run doctor  (included in make health)\n")
    print(f"{'All good.' if not problems else f'{problems} problem(s) found (marked ❌).'}\n")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
