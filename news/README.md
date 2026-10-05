# Worldview news service

Python program that fetches feeds, stores articles in SQLite, and serves `/api/news`.
Plain-English tour: [docs/worldview/HOW-IT-WORKS.md](../docs/worldview/HOW-IT-WORKS.md).

```
uv sync                                   # install packages
uv run pytest -q                          # tests
uv run python -m worldview_news serve     # API on http://127.0.0.1:8765 + scheduled fetching
uv run python -m worldview_news fetch     # fetch once
uv run python -m worldview_news.verify_feeds   # check candidate feed URLs
```
