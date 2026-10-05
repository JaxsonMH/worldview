"""Where things live on disk. Override any of these with environment variables."""

from __future__ import annotations

import os
from pathlib import Path

NEWS_DIR = Path(__file__).resolve().parent.parent  # .../worldview/news
REPO_ROOT = NEWS_DIR.parent
CONFIG_DIR = Path(os.environ.get("WORLDVIEW_CONFIG_DIR", REPO_ROOT / "config" / "worldview"))
DATA_DIR = Path(os.environ.get("WORLDVIEW_DATA_DIR", NEWS_DIR / "data"))
DB_PATH = Path(os.environ.get("WORLDVIEW_DB", DATA_DIR / "worldview.sqlite3"))

FEEDS_OPML = CONFIG_DIR / "feeds.opml"
TOPICS_YAML = CONFIG_DIR / "topics.yaml"

# How often the background fetcher checks every feed.
FETCH_INTERVAL_MINUTES = int(os.environ.get("WORLDVIEW_FETCH_MINUTES", "10"))
API_HOST = os.environ.get("WORLDVIEW_API_HOST", "127.0.0.1")
API_PORT = int(os.environ.get("WORLDVIEW_API_PORT", "8765"))
