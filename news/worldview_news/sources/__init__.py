"""Live data sources beyond the news feeds: wildfires, weather alerts, road
events, world events, disasters, volcanoes, tsunami warnings, internet
outages, aurora, earthquakes, power plants, air quality.

Every source turns its own format into the same simple "event":

    {id, source, title, summary, lat, lon, time, severity, url, geometry?, extra}

severity: 0 = information, 1 = minor, 2 = moderate, 3 = severe.
geometry: optional GeoJSON (an alert area, a closed road) drawn as well as the point.

Sources are fetched only when something asks for them (a globe layer that's
switched on, the Live view, the health check) and the answer is kept for the
source's refresh time, so the providers aren't asked more often than needed.

To add a source: copy one of the small modules here (bc_wildfire.py is a good
template), then add it to SOURCES below. See docs/worldview/ADDING-A-LAYER.md.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

import httpx

from ..db import haversine_km
from ..feedcheck import USER_AGENT

log = logging.getLogger(__name__)


@dataclass
class Source:
    id: str
    name: str
    icon: str
    about: str
    attribution: str
    homepage: str
    refresh_minutes: int
    fetch: Callable[["Context"], list[dict]]
    needs_key: tuple[str, ...] = ()          # environment variables it needs
    key_help: str = ""                        # where to get the key
    worldwide: bool = True                    # False = one region only (shown in the panel)
    max_events: int = 5000


@dataclass
class Context:
    """What a source's fetch function gets: an HTTP client, its keys, its last result."""
    client: httpx.Client
    keys: dict
    previous: list[dict] = field(default_factory=list)
    anchors: Callable[[], dict] | None = None   # country/province map points (from the gazetteer)

    def get_json(self, url: str, **kwargs):
        resp = self.client.get(url, **kwargs)
        resp.raise_for_status()
        return resp.json()


def event(source: str, id_: str, title: str, lat: float, lon: float, *, time: str | None = None,
          summary: str = "", severity: int = 0, url: str | None = None, geometry: dict | None = None,
          **extra) -> dict:
    return {
        "id": f"{source}:{id_}",
        "source": source,
        "title": title.strip()[:200],
        "summary": (summary or "").strip()[:1200],
        "lat": round(float(lat), 5),
        "lon": round(float(lon), 5),
        "time": time,
        "severity": severity,
        "url": url,
        "geometry": geometry,
        "extra": {k: v for k, v in extra.items() if v not in (None, "")},
    }


def iso(value) -> str | None:
    """Epoch seconds/milliseconds or a date string -> ISO 8601 UTC."""
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 1e11 else value
        return datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    text = str(value).strip()
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00").replace(" ", "T"))
    except ValueError:
        return text
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- registry

def _all_sources() -> list[Source]:
    from . import (air_quality, aurora, bc_wildfire, drivebc, ec_alerts, gdacs, gdelt, internet_outages,
                   nrcan_quakes, power_plants, tsunami, volcanoes)

    return [
        bc_wildfire.SOURCE, ec_alerts.SOURCE, drivebc.SOURCE, nrcan_quakes.SOURCE,
        gdacs.SOURCE, volcanoes.SOURCE, tsunami.SOURCE, gdelt.SOURCE,
        internet_outages.SOURCE, aurora.SOURCE, air_quality.SOURCE, power_plants.SOURCE,
    ]


class Registry:
    """Holds every source's last answer and fetches again when it's stale."""

    def __init__(self, keys: dict, anchors: Callable[[], dict] | None = None, client: httpx.Client | None = None):
        self.sources = {s.id: s for s in _all_sources()}
        self.keys = keys
        self.anchors = anchors
        self.client = client or httpx.Client(
            headers={"User-Agent": USER_AGENT}, timeout=httpx.Timeout(45, connect=15), follow_redirects=True,
        )
        self.state: dict[str, dict] = {}
        self.locks = {sid: threading.Lock() for sid in self.sources}

    def configured(self, source: Source) -> bool:
        return all(self.keys.get(k) for k in source.needs_key)

    def describe(self, source: Source) -> dict:
        st = self.state.get(source.id, {})
        return {
            "id": source.id, "name": source.name, "icon": source.icon, "about": source.about,
            "attribution": source.attribution, "homepage": source.homepage,
            "refresh_minutes": source.refresh_minutes, "worldwide": source.worldwide,
            "needs_key": list(source.needs_key), "key_help": source.key_help,
            "configured": self.configured(source),
            "fetched_at": st.get("fetched_at"), "error": st.get("error"), "count": len(st.get("events", [])),
        }

    def get(self, source_id: str, *, force: bool = False) -> dict:
        """The source's events, fetching them first if they're older than its refresh time."""
        source = self.sources[source_id]
        if not self.configured(source):
            return self.describe(source) | {"events": [], "error": f"Needs a free key ({', '.join(source.needs_key)})"}
        with self.locks[source_id]:
            st = self.state.get(source_id)
            fresh = st and time.time() - st["fetched_ts"] < source.refresh_minutes * 60
            if force or not fresh:
                previous = (st or {}).get("events", [])
                ctx = Context(self.client, self.keys, previous, self.anchors)
                try:
                    events = source.fetch(ctx)[: source.max_events]
                    st = {"events": events, "error": None}
                except Exception as exc:  # keep the last good answer, report the problem
                    log.warning("source %s failed: %s", source_id, exc)
                    st = {"events": previous, "error": f"{type(exc).__name__}: {exc}"[:300]}
                st["fetched_ts"] = time.time()
                st["fetched_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                self.state[source_id] = st
        return self.describe(source) | {"events": st["events"]}

    def near(self, lat: float, lon: float, km: float, source_ids: list[str] | None = None) -> list[dict]:
        """Events from many sources within `km` of a point (fetching stale sources in parallel)."""
        from concurrent.futures import ThreadPoolExecutor

        ids = [i for i in (source_ids or self.sources) if i in self.sources]
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda sid: self.get(sid), ids))
        out = []
        for res in results:
            hits = [e for e in res["events"] if haversine_km(lat, lon, e["lat"], e["lon"]) <= km]
            hits.sort(key=lambda e: (e["severity"] or 0, e["time"] or ""), reverse=True)  # severe, then newest
            out.append({k: res[k] for k in ("id", "name", "icon", "attribution", "fetched_at", "error", "configured")}
                       | {"events": hits[:50], "total": len(hits)})
        return out
