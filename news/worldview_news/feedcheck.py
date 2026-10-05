"""Check whether a feed URL works: does it load, is it a real feed, is it fresh?

Used by `verify_feeds` (one-off check of candidate feeds) and later by the
health check. Never stores anything; it only reads.
"""

from __future__ import annotations

import calendar
import time
from dataclasses import dataclass

import feedparser
import httpx

from . import wordpress

# Keep this free of URLs: CBC silently drops requests whose User-Agent contains one.
USER_AGENT = "Worldview/0.1 (personal non-commercial news reader)"
STALE_AFTER_DAYS = 7


@dataclass
class FeedCheck:
    url: str
    ok: bool
    status: int | None = None
    final_url: str | None = None
    title: str | None = None
    items: int = 0
    newest_age_hours: float | None = None
    has_summaries: bool = False
    problem: str | None = None

    @property
    def stale(self) -> bool:
        return self.newest_age_hours is not None and self.newest_age_hours > STALE_AFTER_DAYS * 24


def check_feed(url: str, client: httpx.Client) -> FeedCheck:
    try:
        wp = wordpress.is_wordpress_json(url)
        resp = client.get(wordpress.request_url(url) if wp else url)
    except httpx.HTTPError as exc:
        return FeedCheck(url, ok=False, problem=f"could not connect ({type(exc).__name__})")
    result = FeedCheck(url, ok=False, status=resp.status_code, final_url=str(resp.url))
    if resp.status_code >= 400:
        result.problem = f"HTTP {resp.status_code}"
        return result
    try:
        parsed = wordpress.parse(resp.json()) if wp else feedparser.parse(resp.content)
    except (ValueError, KeyError, TypeError):
        result.problem = "not a WordPress article list"
        return result
    entries = parsed.entries
    if not entries:
        result.problem = "not a feed (or empty)"
        return result
    result.title = None if wp else parsed.feed.get("title")
    result.items = len(entries)
    result.has_summaries = any(e.get("summary") for e in entries)
    stamps = [e.get("published_parsed") or e.get("updated_parsed") for e in entries]
    stamps = [calendar.timegm(s) for s in stamps if s]
    if stamps:
        result.newest_age_hours = (time.time() - max(stamps)) / 3600
    result.ok = True
    if result.stale:
        result.problem = f"newest item is {result.newest_age_hours / 24:.0f} days old"
    return result


def make_client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"},
        follow_redirects=True,
        timeout=20,
    )
