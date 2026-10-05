"""Street / venue lookups with OpenStreetMap Nominatim (free, no key).

Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
at most 1 request per second, identify the app, cache results. We do all three,
and only search inside a small box around a city we already found, so
"Douglas Street" in a Victoria story can't land in Douglas, Isle of Man.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time

import httpx

from .feedcheck import USER_AGENT
from .gazetteer import normalize
from .geoparser import Place

URL = "https://nominatim.openstreetmap.org/search"
BOX_DEG = 0.25  # about 25 km around the city
STREET_CLASSES = {"highway"}


class Nominatim:
    _lock = threading.Lock()
    _last = 0.0

    def __init__(self, conn: sqlite3.Connection, client: httpx.Client | None = None):
        self.conn = conn
        self.client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=20)

    def _cached(self, key: str):
        row = self.conn.execute("SELECT result FROM geocode_cache WHERE query = ?", (key,)).fetchone()
        return (True, json.loads(row[0]) if row[0] else None) if row else (False, None)

    def _get(self, params: dict) -> list:
        with Nominatim._lock:
            wait = 1.1 - (time.monotonic() - Nominatim._last)
            if wait > 0:
                time.sleep(wait)
            try:
                resp = self.client.get(URL, params=params)
                resp.raise_for_status()
                return resp.json()
            finally:
                Nominatim._last = time.monotonic()

    def lookup(self, mention: str, city: Place) -> Place | None:
        key = f"{normalize(mention)}|{city.geonames_id or city.name}"
        hit, cached = self._cached(key)
        if hit:
            return Place(**cached) if cached else None
        params = {
            "q": f"{mention}, {city.name}", "format": "jsonv2", "limit": 1, "bounded": 1,
            "viewbox": f"{city.lon - BOX_DEG},{city.lat + BOX_DEG},{city.lon + BOX_DEG},{city.lat - BOX_DEG}",
        }
        if city.country_code:
            params["countrycodes"] = city.country_code.lower()
        try:
            results = self._get(params)
        except (httpx.HTTPError, ValueError):
            return None  # don't cache failures; try again next time
        place = None
        if results:
            r = results[0]
            place = Place(
                name=r.get("name") or mention, precision="street" if r.get("category") in STREET_CLASSES else "poi",
                lat=float(r["lat"]), lon=float(r["lon"]), country_code=city.country_code, admin1=city.admin1,
                osm_id=f"{r.get('osm_type')}/{r.get('osm_id')}",
            )
        self.conn.execute(
            "INSERT OR REPLACE INTO geocode_cache (query, result, fetched_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
            (key, json.dumps(place.__dict__) if place else None),
        )
        return place
