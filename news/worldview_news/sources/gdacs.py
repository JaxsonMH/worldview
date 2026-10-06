"""GDACS (Global Disaster Alert and Coordination System, UN + European
Commission): earthquakes, cyclones, floods, volcanoes, droughts and wildfires
worldwide, rated green / orange / red by expected impact. No key."""

from . import Context, Source, event, iso

URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP"
LEVEL = {"Green": 1, "Orange": 2, "Red": 3}
TYPES = {"EQ": "Earthquake", "TC": "Tropical cyclone", "FL": "Flood", "VO": "Volcano", "DR": "Drought",
         "WF": "Wildfire", "TS": "Tsunami"}


def fetch(ctx: Context) -> list[dict]:
    out = []
    for f in ctx.get_json(URL).get("features", []):
        p = f["properties"]
        if str(p.get("iscurrent", "true")).lower() != "true" or f["geometry"]["type"] != "Point":
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        kind = TYPES.get(p.get("eventtype"), p.get("eventtype"))
        level = p.get("alertlevel") or "Green"
        sev = (p.get("severitydata") or {}).get("severitytext", "").strip()
        out.append(event(
            "gdacs", f"{p.get('eventtype')}{p.get('eventid')}", p.get("name") or f"{kind} in {p.get('country')}", lat, lon,
            time=iso(p.get("fromdate")),
            summary=f"{level} alert. {sev}. {p.get('htmldescription') or ''}".replace(" . ", " "),
            severity=LEVEL.get(level, 1), url=(p.get("url") or {}).get("report"),
            kind=kind, country=p.get("country"),
        ))
    return out


SOURCE = Source(
    id="gdacs", name="Disaster alerts (GDACS)", icon="🆘",
    about="UN/EC alerts for quakes, cyclones, floods, volcanoes, droughts, wildfires",
    attribution="GDACS – Global Disaster Alert and Coordination System",
    homepage="https://www.gdacs.org/",
    refresh_minutes=15, fetch=fetch,
)
