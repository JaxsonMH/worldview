"""Volcanoes erupting now (Smithsonian Global Volcanism Program, worldwide)
plus US volcanoes on elevated alert (USGS). No key.

The Smithsonian list of volcanoes (with coordinates) changes rarely, so it's
fetched once and reused; the eruption and alert lists are refreshed."""

import time

from . import Context, Source, event, iso

GVP = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows"
USGS = "https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes"
COLOR_SEVERITY = {"RED": 3, "ORANGE": 2, "YELLOW": 1, "GREEN": 0}
_volcanoes: dict = {"at": 0, "by_number": {}}


def gvp(ctx: Context, layer: str) -> list[dict]:
    params = {"service": "WFS", "version": "2.0.0", "request": "GetFeature",
              "typeName": f"GVP-VOTW:{layer}", "outputFormat": "application/json"}
    return ctx.get_json(GVP, params=params)["features"]


def volcano_list(ctx: Context) -> dict:
    if time.time() - _volcanoes["at"] > 7 * 86400:
        by_number = {}
        for f in gvp(ctx, "Smithsonian_VOTW_Holocene_Volcanoes"):
            p = f["properties"]
            by_number[str(p.get("Volcano_Number"))] = p
        _volcanoes.update(at=time.time(), by_number=by_number)
    return _volcanoes["by_number"]


def fetch(ctx: Context) -> list[dict]:
    out = {}
    for f in gvp(ctx, "E3WebApp_Eruptions1960"):
        p = f["properties"]
        if str(p.get("ContinuingEruption")).lower() != "true":
            continue
        start = p.get("StartDate") or ""
        when = f"{start[:4]}-{start[4:6] or '01'}-{start[6:8] or '01'}" if len(start) >= 4 else None
        out[str(p["VolcanoNumber"])] = event(
            "volcanoes", str(p["VolcanoNumber"]), f"{p['VolcanoName']} – erupting",
            p["LatitudeDecimal"], p["LongitudeDecimal"], time=iso(when),
            summary=f"Continuing eruption since {when or 'unknown'}"
                    + (f", explosivity index {p['ExplosivityIndexMax']}" if p.get("ExplosivityIndexMax") is not None else "")
                    + ". (Smithsonian Global Volcanism Program)",
            severity=2,
            url=f"https://volcano.si.edu/volcano.cfm?vn={p['VolcanoNumber']}",
        )
    try:
        catalogue = volcano_list(ctx)
        for alert in ctx.get_json(USGS):
            v = catalogue.get(str(alert.get("vnum")))
            if not v:
                continue
            colour = (alert.get("color_code") or "").upper()
            title = f"{alert['volcano_name']} – {alert.get('alert_level', '').title()} ({colour.title()})"
            out[str(alert["vnum"])] = event(
                "volcanoes", str(alert["vnum"]), title, v["Latitude"], v["Longitude"],
                time=iso(alert.get("sent_unixtime")),
                summary=f"USGS {alert.get('obs_fullname')}: aviation colour code {colour}, alert level {alert.get('alert_level')}.",
                severity=COLOR_SEVERITY.get(colour, 1), url=alert.get("notice_url"),
            )
    except Exception:  # the USGS part is a bonus; eruptions still show without it
        pass
    return list(out.values())


SOURCE = Source(
    id="volcanoes", name="Volcanoes erupting", icon="🌋",
    about="Continuing eruptions worldwide + US volcano alerts",
    attribution="Smithsonian Institution Global Volcanism Program; USGS Volcano Hazards Program",
    homepage="https://volcano.si.edu/",
    refresh_minutes=60, fetch=fetch,
)
