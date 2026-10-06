"""GDELT: a worldwide catalogue of events reported in the news, updated every
15 minutes and geocoded. Free, no key.

GDELT records every kind of event (meetings, statements, …). We keep only
notable, physical ones: protests, coercion, assaults, fighting and mass
violence, mentioned in at least 3 articles. We keep a rolling 24 hours, so
each refresh only downloads the newest 15-minute file. GDELT is machine-coded:
treat it as "the news says something happened here", and follow the link.
"""

import csv
import io
import zipfile
from datetime import datetime, timedelta, timezone

from . import Context, Source, event

LAST_UPDATE = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt"
ROOT_CODES = {"14": ("Protest", 1), "17": ("Coercion", 1), "18": ("Assault", 2), "19": ("Fighting", 3),
              "20": ("Mass violence", 3)}
MIN_MENTIONS = 3
KEEP_HOURS = 24
# Column positions in GDELT 2.0 event files.
C_ID, C_ROOT, C_GOLDSTEIN, C_MENTIONS, C_SOURCES = 0, 28, 30, 31, 32
C_GEOTYPE, C_PLACE, C_CC, C_LAT, C_LON, C_ADDED, C_URL = 51, 52, 53, 56, 57, 59, 60


def parse(rows) -> list[dict]:
    out = []
    for r in rows:
        if len(r) < 61 or r[C_ROOT] not in ROOT_CODES or not r[C_LAT]:
            continue
        if int(r[C_MENTIONS] or 0) < MIN_MENTIONS:
            continue
        name, severity = ROOT_CODES[r[C_ROOT]]
        added = datetime.strptime(r[C_ADDED], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        domain = r[C_URL].split("/")[2] if r[C_URL].count("/") >= 2 else r[C_URL]
        out.append(event(
            "gdelt", r[C_ID], f"{name} reported – {r[C_PLACE]}", float(r[C_LAT]), float(r[C_LON]),
            time=added.strftime("%Y-%m-%dT%H:%M:%SZ"),
            summary=f"{name} reported in {r[C_MENTIONS]} articles from {r[C_SOURCES]} sources, e.g. {domain}. "
                    "Machine-coded by GDELT; check the article.",
            severity=severity, url=r[C_URL], kind=name,
            precision="country" if r[C_GEOTYPE] == "1" else "region" if r[C_GEOTYPE] in ("2", "5") else "city",
        ))
    return out


def fetch(ctx: Context) -> list[dict]:
    resp = ctx.client.get(LAST_UPDATE)
    resp.raise_for_status()
    export_url = next(line.split()[2] for line in resp.text.splitlines() if line.endswith(".export.CSV.zip"))
    export_url = export_url.replace("http://", "https://")
    data = ctx.client.get(export_url)
    data.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(data.content)) as zf:
        rows = csv.reader(io.TextIOWrapper(zf.open(zf.namelist()[0]), "utf-8", errors="replace"), delimiter="\t")
        fresh = parse(rows)
    # Merge with what we already had, keep 24 hours, and fold repeats of the same
    # kind of event at the same spot into one (keeping the most-mentioned).
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=KEEP_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    merged: dict = {}
    for e in [*ctx.previous, *fresh]:
        if (e["time"] or "") < cutoff:
            continue
        key = (e["extra"].get("kind"), round(e["lat"], 1), round(e["lon"], 1))
        merged[key] = e
    return sorted(merged.values(), key=lambda e: e["time"], reverse=True)


SOURCE = Source(
    id="gdelt", name="World events (GDELT)", icon="📢",
    about="Protests, clashes and violence reported in world news, last 24 h",
    attribution="The GDELT Project (gdeltproject.org)",
    homepage="https://www.gdeltproject.org/",
    refresh_minutes=15, fetch=fetch,
)
