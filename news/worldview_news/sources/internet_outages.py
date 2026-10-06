"""Internet outages detected by IODA (Georgia Tech's Internet Outage Detection
and Analysis), by country and by province/state. No key.

IODA raises an alert when connectivity drops ("critical") and another when it
recovers ("normal"); we show places whose latest alert in the last 24 hours is
critical. Country and province points come from our own place list."""

import time

from . import Context, Source, event, iso

URL = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts"
SIGNALS = {"bgp": "routing (BGP)", "ping-slash24": "active probing", "merit-nt": "network telescope", "gtr": "Google traffic"}


def fetch(ctx: Context) -> list[dict]:
    anchors = ctx.anchors() if ctx.anchors else {"countries": {}, "regions": {}}
    region_by_name = {}
    for key, r in anchors.get("regions", {}).items():
        region_by_name[(key.split(".")[0], r["name"].lower())] = r
    now = int(time.time())
    latest: dict = {}
    for entity_type in ("country", "region"):
        data = ctx.get_json(URL, params={"from": now - 86400, "until": now, "entityType": entity_type, "limit": 2000})
        for alert in data.get("data") or []:
            ent = alert["entity"]
            key = (entity_type, ent["code"])
            if key not in latest or alert["time"] >= latest[key]["time"]:
                latest[key] = alert | {"entity_type": entity_type}
    out = []
    for (entity_type, code), alert in latest.items():
        if alert.get("level") != "critical":
            continue
        ent = alert["entity"]
        if entity_type == "country":
            place = anchors.get("countries", {}).get(code)
            name = ent["name"]
        else:
            cc = (ent.get("attrs") or {}).get("country_code")
            place = region_by_name.get((cc, ent["name"].lower()))
            name = f"{ent['name']}, {(ent.get('attrs') or {}).get('country_name', cc)}"
        if not place:
            continue
        drop = 100 - round(100 * alert["value"] / alert["historyValue"]) if alert.get("historyValue") else None
        out.append(event(
            "internet-outages", f"{entity_type}-{code}", f"Internet outage – {name}", place["lat"], place["lon"],
            time=iso(alert["time"]),
            summary=f"Connectivity down{f' about {drop}%' if drop else ''} on {SIGNALS.get(alert['datasource'], alert['datasource'])} "
                    "compared with normal (IODA). The marker is the middle of the "
                    f"{'country' if entity_type == 'country' else 'province/state'}, not an exact spot.",
            severity=3 if entity_type == "country" else 2,
            url=f"https://ioda.inetintel.cc.gatech.edu/{entity_type}/{code}",
            level=entity_type,
        ))
    return out


SOURCE = Source(
    id="internet-outages", name="Internet outages", icon="📵",
    about="Country and province-wide connectivity drops (IODA)",
    attribution="IODA, Internet Intelligence Lab, Georgia Tech",
    homepage="https://ioda.inetintel.cc.gatech.edu/",
    refresh_minutes=15, fetch=fetch,
)
