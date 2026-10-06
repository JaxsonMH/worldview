"""The gazetteer: a local, offline list of place names -> coordinates, built
from GeoNames (free, CC-BY 4.0, https://www.geonames.org).

Build (or rebuild) it with:
    uv run python -m worldview_news.gazetteer

That downloads ~20 MB into news/data/geonames/ and writes news/data/gazetteer.sqlite3:
- every country, every province/state,
- every town worldwide with 1,000+ people (cities1000),
- in BC: also small settlements, islands, bays, parks, mountains, airports.
"""

from __future__ import annotations

import csv
import io
import re
import sqlite3
import sys
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path

import httpx

from . import config
from .feedcheck import USER_AGENT

GEONAMES_URL = "https://download.geonames.org/export/dump/"
FILES = ["cities1000.zip", "admin1CodesASCII.txt", "countryInfo.txt", "CA.zip"]
SRC_DIR = config.DATA_DIR / "geonames"
GAZETTEER_PATH = config.DATA_DIR / "gazetteer.sqlite3"

# Extra BC feature types worth knowing (islands, bays, parks, ...).
# "area" = a natural feature shown at region precision (not a province/state).
BC_FEATURE_CODES = {
    "ISL": "area", "ISLS": "area", "PEN": "area", "AREA": "area", "STRT": "area",
    "SD": "area", "CHN": "area", "BAY": "area", "INLT": "area",
    "PRK": "poi", "AIRP": "poi", "HBR": "poi", "MT": "poi", "PASS": "poi", "RESV": "poi",
}

csv.field_size_limit(sys.maxsize)
_PUNCT = re.compile(r"[.’']")
_SPACES = re.compile(r"[\s\-]+")


def normalize(name: str) -> str:
    """'B.C.' -> 'bc', 'Québec' -> 'quebec', 'the Malahat' -> 'malahat'."""
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    text = _SPACES.sub(" ", _PUNCT.sub("", text.lower())).strip()
    return text.removeprefix("the ")


def _usable_alt(name: str) -> bool:
    # Latin-script names only, and skip all-caps codes like "YYJ" or "LAX".
    return len(name) >= 3 and any(c.islower() for c in name) and name.isascii()


def download(dest: Path = SRC_DIR) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=120, follow_redirects=True) as client:
        for name in FILES:
            target = dest / name
            if target.exists():
                continue
            print(f"Downloading {name} ...")
            resp = client.get(GEONAMES_URL + name)
            resp.raise_for_status()
            target.write_bytes(resp.content)


def _rows(path: Path, inner: str | None = None):
    if inner:
        with zipfile.ZipFile(path) as zf, zf.open(inner) as fh:
            yield from csv.reader(io.TextIOWrapper(fh, "utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE)
    else:
        with open(path, encoding="utf-8") as fh:
            yield from (r for r in csv.reader(fh, delimiter="\t", quoting=csv.QUOTE_NONE) if r and not r[0].startswith("#"))


SCHEMA = """
DROP TABLE IF EXISTS gz_places; DROP TABLE IF EXISTS gz_names;
CREATE TABLE gz_places (
    geonames_id  INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,     -- country | region (province/state) | city | area | poi
    country_code TEXT,
    admin1       TEXT,
    lat REAL NOT NULL, lon REAL NOT NULL,
    population   INTEGER NOT NULL DEFAULT 0
);
-- is_primary = 1 for a place's main name, 0 for alternate spellings/nicknames.
CREATE TABLE gz_names (name TEXT NOT NULL, geonames_id INTEGER NOT NULL, is_primary INTEGER NOT NULL,
                       PRIMARY KEY (name, geonames_id)) WITHOUT ROWID;
"""


def build(src: Path = SRC_DIR, out: Path = GAZETTEER_PATH) -> None:
    places: dict[int, tuple] = {}
    names: dict[tuple[str, int], int] = {}

    def add(gid, name, kind, cc, a1, lat, lon, pop, alts=(), primaries=()):
        places[gid] = (gid, name, kind, cc, a1, float(lat), float(lon), int(pop or 0))
        main = {normalize(n) for n in (name, *primaries) if n}
        for n in {name, *primaries, *alts}:
            if n and (normalize(n) in main or _usable_alt(n)):
                key = normalize(n)
                if key:
                    names[(key, gid)] = max(names.get((key, gid), 0), int(key in main))

    # Towns worldwide (1,000+ people).
    admin_pop: dict[tuple[str, str], list] = defaultdict(list)
    for r in _rows(src / "cities1000.zip", "cities1000.txt"):
        gid, name, ascii_name, alts, lat, lon, cc, a1, pop = int(r[0]), r[1], r[2], r[3], r[4], r[5], r[8], r[10], int(r[14] or 0)
        add(gid, name, "city", cc, a1, lat, lon, pop, alts.split(","), [ascii_name])
        admin_pop[(cc, a1)].append((float(lat), float(lon), pop))

    # BC extras and accurate Canadian province centres.
    ca_admin1_coords = {}
    for r in _rows(src / "CA.zip", "CA.txt"):
        fclass, fcode, a1 = r[6], r[7], r[10]
        if fcode == "ADM1":
            ca_admin1_coords[int(r[0])] = (r[4], r[5])
        elif a1 == "02" and int(r[0]) not in places and (fclass == "P" or fcode in BC_FEATURE_CODES):
            kind = "city" if fclass == "P" else BC_FEATURE_CODES[fcode]
            add(int(r[0]), r[1], kind, "CA", a1, r[4], r[5], r[14], r[3].split(","), [r[2]])

    # Provinces / states. Canada uses real centres; elsewhere the population-weighted
    # centre of its towns is a good-enough anchor for a region-level pin.
    for r in _rows(src / "admin1CodesASCII.txt"):
        code, name, ascii_name, gid = r[0], r[1], r[2], int(r[3])
        cc, a1 = code.split(".", 1)
        towns = admin_pop.get((cc, a1), [])
        total = sum(p for _, _, p in towns)
        if gid in ca_admin1_coords:
            lat, lon = ca_admin1_coords[gid]
        elif total:
            lat = sum(la * p for la, _, p in towns) / total
            lon = sum(lo * p for _, lo, p in towns) / total
        else:
            continue
        # Score regions by a tenth of their population so "New York" means the city.
        add(gid, name, "region", cc, a1, lat, lon, total // 10, (), [ascii_name, *name.split("/")])

    # Countries, anchored at the capital.
    for r in _rows(src / "countryInfo.txt"):
        cc, name, capital, pop, gid = r[0], r[4], r[5], int(r[7] or 0), r[16]
        if not gid:
            continue
        caps = [p for p in places.values() if p[3] == cc and p[2] == "city" and p[1] == capital]
        if not caps:
            continue
        cap = max(caps, key=lambda p: p[7])
        add(int(gid), name, "country", cc, None, cap[5], cap[6], pop)

    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.executescript(SCHEMA)
    db.executemany("INSERT INTO gz_places VALUES (?,?,?,?,?,?,?,?)", places.values())
    db.executemany("INSERT INTO gz_names VALUES (?,?,?)", ((n, g, p) for (n, g), p in names.items()))
    db.commit()
    db.execute("VACUUM")
    db.close()
    tmp.replace(out)
    print(f"Gazetteer: {len(places):,} places, {len(names):,} names -> {out}")


def compute_anchors(path: Path = GAZETTEER_PATH) -> dict:
    """Map points for every country and province/state. A country's point is the
    middle of its towns (averaged on the sphere, so countries across the date
    line work), so "Canada" isn't drawn on Ottawa; provinces use their own point."""
    import math

    if not Path(path).exists():
        return {"countries": {}, "regions": {}}
    gz = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    gz.row_factory = sqlite3.Row
    try:
        sums: dict[str, list[float]] = {}
        for r in gz.execute("SELECT country_code, lat, lon FROM gz_places WHERE kind = 'city'"):
            la, lo = math.radians(r["lat"]), math.radians(r["lon"])
            acc = sums.setdefault(r["country_code"], [0.0, 0.0, 0.0])
            acc[0] += math.cos(la) * math.cos(lo)
            acc[1] += math.cos(la) * math.sin(lo)
            acc[2] += math.sin(la)
        countries = {}
        for r in gz.execute("SELECT country_code, name, lat, lon FROM gz_places WHERE kind = 'country'"):
            x, y, z = sums.get(r["country_code"], (0, 0, 0))
            if x or y or z:
                lat, lon = math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))
            else:
                lat, lon = r["lat"], r["lon"]
            countries[r["country_code"]] = {"name": r["name"], "lat": round(lat, 3), "lon": round(lon, 3)}
        regions = {
            f"{r['country_code']}.{r['admin1']}": {"name": r["name"], "lat": round(r["lat"], 3), "lon": round(r["lon"], 3)}
            for r in gz.execute("SELECT country_code, admin1, name, lat, lon FROM gz_places WHERE kind = 'region'")
        }
    finally:
        gz.close()
    return {"countries": countries, "regions": regions}


if __name__ == "__main__":
    download()
    build()
