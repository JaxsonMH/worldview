"""Command line for the news service.

    uv run python -m worldview_news init-db        create the database file
    uv run python -m worldview_news import-opml    load config/worldview/feeds.opml
    uv run python -m worldview_news fetch          fetch every feed once, print counts
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
    elif args.cmd == "fetch":
        from .fetcher import fetch_all

        for title, new in fetch_all(conn).items():
            print(f"{new:4d} new  {title}")


if __name__ == "__main__":
    main()
