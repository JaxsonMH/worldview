"""Reader for WordPress sites that have switched RSS off but still publish the
standard public article list at /wp-json/wp/v2/posts (e.g. ISW since 2025).

It turns that list into the same shape feedparser produces, so the rest of the
fetcher treats it like any other feed. A feed uses this reader automatically
when its URL contains "/wp-json/wp/v2/posts".
"""

from __future__ import annotations

import html
import time
from types import SimpleNamespace

MARKER = "/wp-json/wp/v2/posts"
FIELDS = "id,date_gmt,link,title,excerpt"


def is_wordpress_json(url: str) -> bool:
    return MARKER in url


def request_url(url: str) -> str:
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}per_page=20&_fields={FIELDS}"


def parse(posts: list[dict]) -> SimpleNamespace:
    entries = []
    for post in posts:
        entries.append({
            "id": f"wp:{post['id']}",
            "link": post.get("link"),
            "title": html.unescape(post.get("title", {}).get("rendered", "")),
            "summary": post.get("excerpt", {}).get("rendered"),
            "published_parsed": time.strptime(post["date_gmt"], "%Y-%m-%dT%H:%M:%S") if post.get("date_gmt") else None,
        })
    return SimpleNamespace(entries=entries, bozo=False)
