"""Environment Canada weather alerts (warnings, watches, statements), from the
MSC GeoMet OGC API. No key. Each alert covers an area; we keep the outline and
put a point in its middle."""

from . import Context, Source, event, iso

URL = "https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=500&lang=en"
SEVERITY = {"warning": 3, "watch": 2, "advisory": 2, "statement": 1}


def centre(geometry: dict) -> tuple[float, float] | None:
    """A simple middle point of a polygon/multipolygon (average of its outline)."""
    rings = []
    if geometry["type"] == "Polygon":
        rings = [geometry["coordinates"][0]]
    elif geometry["type"] == "MultiPolygon":
        rings = [poly[0] for poly in geometry["coordinates"]]
    points = [pt for ring in rings for pt in ring]
    if not points:
        return None
    return sum(p[1] for p in points) / len(points), sum(p[0] for p in points) / len(points)


def simplify(geometry: dict, step: int = 4) -> dict:
    """Keep every 4th outline point: plenty for drawing, far smaller to send."""
    def ring(r):
        thin = r[::step]
        return thin + [thin[0]] if thin and thin[0] != thin[-1] else thin
    if geometry["type"] == "Polygon":
        return {"type": "Polygon", "coordinates": [ring(geometry["coordinates"][0])]}
    if geometry["type"] == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": [[ring(p[0])] for p in geometry["coordinates"]]}
    return geometry


def fetch(ctx: Context) -> list[dict]:
    out = []
    seen = set()
    for f in ctx.get_json(URL)["features"]:
        p = f["properties"]
        if not f.get("geometry"):
            continue
        # The same alert is published once per forecast area; one marker per alert and area name.
        key = (p.get("alert_code"), p.get("feature_name_en") or p.get("identifier"))
        if key in seen:
            continue
        seen.add(key)
        mid = centre(f["geometry"])
        if not mid:
            continue
        area = p.get("feature_name_en") or ""
        name = (p.get("alert_name_en") or "alert").capitalize()
        out.append(event(
            "ec-alerts", str(f.get("id") or p.get("identifier")), f"{name}{f' – {area}' if area else ''}", *mid,
            time=iso(p.get("publication_datetime")),
            summary=(p.get("alert_text_en") or "").split("\n\n###")[0],
            severity=SEVERITY.get(p.get("alert_type"), 1),
            url="https://weather.gc.ca/warnings/index_e.html",
            geometry=simplify(f["geometry"]),
            expires=iso(p.get("expiration_datetime")), kind=p.get("alert_type"),
        ))
    return out


SOURCE = Source(
    id="ec-alerts", name="Weather alerts (Canada)", icon="⚠️",
    about="Environment Canada warnings, watches and statements",
    attribution="Environment and Climate Change Canada (MSC GeoMet, Open Government Licence – Canada)",
    homepage="https://weather.gc.ca/warnings/index_e.html",
    refresh_minutes=10, fetch=fetch, worldwide=False,
)
