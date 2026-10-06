"""Earthquakes Canada (Natural Resources Canada): every located earthquake in
and near Canada over the last 7 days, including small ones USGS leaves out.
Standard FDSN text service, no key."""

from datetime import datetime, timedelta, timezone

from . import Context, Source, event, iso

URL = "https://www.earthquakescanada.nrcan.gc.ca/fdsnws/event/1/query"


def fetch(ctx: Context) -> list[dict]:
    start = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    resp = ctx.client.get(URL, params={"starttime": start, "format": "text"})
    resp.raise_for_status()
    out = []
    for line in resp.text.splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) < 8:
            continue
        eid, when, lat, lon, depth, _mtype, mag, place = parts[:8]
        try:
            m = float(mag)
        except ValueError:
            m = 0.0
        place = place.split("/")[0]
        out.append(event(
            "nrcan-quakes", eid, f"M{m:.1f} – {place}", float(lat), float(lon), time=iso(when),
            summary=f"Magnitude {m:.1f}, {depth} km deep.",
            severity=3 if m >= 5 else 2 if m >= 4 else 1 if m >= 3 else 0,
            url=f"https://www.earthquakescanada.nrcan.gc.ca/recent/maps-cartes/index-en.php?tpl_region=canada",
            magnitude=m,
        ))
    return out


SOURCE = Source(
    id="nrcan-quakes", name="Earthquakes Canada (7 days)", icon="🫨",
    about="All located earthquakes in and near Canada, Natural Resources Canada",
    attribution="Earthquakes Canada, Natural Resources Canada (Open Government Licence – Canada)",
    homepage="https://www.earthquakescanada.nrcan.gc.ca/",
    refresh_minutes=10, fetch=fetch, worldwide=False,
)
