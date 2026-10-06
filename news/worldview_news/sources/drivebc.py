"""DriveBC road events (closures, incidents, construction) from BC's Open511
API. No key."""

from . import Context, Source, event, iso

URL = "https://api.open511.gov.bc.ca/events?format=json&status=ACTIVE&limit=500"
SEVERITY = {"MAJOR": 3, "MODERATE": 2, "MINOR": 1, "UNKNOWN": 0}
TYPE_NAMES = {"INCIDENT": "Incident", "CONSTRUCTION": "Construction", "SPECIAL_EVENT": "Special event",
              "WEATHER_CONDITION": "Road conditions", "ROAD_CONDITION": "Road conditions"}


def first_point(geography: dict) -> tuple[float, float] | None:
    coords = geography.get("coordinates")
    t = geography.get("type")
    if t == "Point":
        return coords[1], coords[0]
    if t == "LineString" and coords:
        mid = coords[len(coords) // 2]
        return mid[1], mid[0]
    if t == "MultiLineString" and coords and coords[0]:
        mid = coords[0][len(coords[0]) // 2]
        return mid[1], mid[0]
    return None


def fetch(ctx: Context) -> list[dict]:
    out = []
    for e in ctx.get_json(URL).get("events", []):
        geo = e.get("geography") or {}
        point = first_point(geo)
        if not point:
            continue
        road = (e.get("roads") or [{}])[0].get("name", "")
        kind = TYPE_NAMES.get(e.get("event_type"), (e.get("event_type") or "Event").title())
        is_closure = "CLOSED" in str(e.get("+ivr_message", "")).upper() or any(
            r.get("state") == "CLOSED" for r in e.get("roads") or [])
        out.append(event(
            "drivebc", e["id"].split("/")[-1], f"{'Road closed' if is_closure else kind}{f' – {road}' if road else ''}", *point,
            time=iso(e.get("updated") or e.get("created")),
            summary=e.get("description", ""),
            severity=3 if is_closure else SEVERITY.get(e.get("severity"), 1),
            url="https://www.drivebc.ca/",
            geometry=geo if geo.get("type") in ("LineString", "MultiLineString") else None,
            kind=kind,
        ))
    return out


SOURCE = Source(
    id="drivebc", name="BC road events", icon="🚧",
    about="DriveBC closures, incidents and construction",
    attribution="DriveBC / BC Ministry of Transportation (Open511, Open Government Licence – BC)",
    homepage="https://www.drivebc.ca/",
    refresh_minutes=5, fetch=fetch, worldwide=False,
)
