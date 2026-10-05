"""Command line for the news service.

    uv run python -m worldview_news init-db        create the database file
    uv run python -m worldview_news import-opml    load config/worldview/feeds.opml
    uv run python -m worldview_news fetch          fetch every feed once, then find places + topics
    uv run python -m worldview_news process        find places + topics for articles not done yet
    uv run python -m worldview_news reprocess      redo places + rule topics for every article
                                                   (after editing topics.yaml, geoparser.yaml
                                                   or place-aliases.yaml; manual topics are kept)
    uv run python -m worldview_news gazetteer      download GeoNames and build the place list
    uv run python -m worldview_news serve          run the API + fetch on a schedule
"""

from __future__ import annotations

import argparse
import logging

from . import config
from .db import connect, init_db


def main() -> None:
    parser = argparse.ArgumentParser(prog="worldview_news")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    imp = sub.add_parser("import-opml")
    imp.add_argument("path", nargs="?", default=str(config.FEEDS_OPML))
    sub.add_parser("fetch")
    sub.add_parser("process")
    sub.add_parser("reprocess")
    sub.add_parser("gazetteer")
    sub.add_parser("serve")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.cmd == "serve":
        import uvicorn

        from .api import create_app

        uvicorn.run(create_app(), host=config.API_HOST, port=config.API_PORT)
        return

    conn = connect(config.DB_PATH)
    init_db(conn)
    if args.cmd == "init-db":
        print(f"Database ready at {config.DB_PATH}")
    elif args.cmd == "import-opml":
        from .opml import import_feeds, read_opml

        added, updated = import_feeds(conn, read_opml(args.path))
        print(f"Feeds: {added} added, {updated} updated")
    elif args.cmd == "gazetteer":
        from .gazetteer import build, download

        download()
        build()
    if args.cmd == "fetch":
        from .fetcher import fetch_all

        for title, new in fetch_all(conn).items():
            print(f"{new:4d} new  {title}")
    if args.cmd == "reprocess":
        conn.execute("DELETE FROM article_topics WHERE source = 'rule'")
        conn.execute("UPDATE articles SET geo_done_at = NULL")
        conn.commit()
    if args.cmd in ("fetch", "process", "reprocess"):
        from .geoparser import geoparse_pending

        total = 0
        while n := geoparse_pending(conn, limit=200):
            total += n
            print(f"Found places and topics for {total} articles...")


if __name__ == "__main__":
    main()
