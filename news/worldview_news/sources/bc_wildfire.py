"""BC Wildfire Service: wildfires currently burning in British Columbia.
Public ArcGIS layer, no key. Fires marked "Out" are left out."""

from . import Context, Source, event, iso

URL = (
    "https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BCWS_ActiveFires_PublicView/"
    "FeatureServer/0/query?where=FIRE_STATUS%3C%3E%27Out%27&outFields=*&f=geojson&resultRecordCount=2000"
)
STATUS = {"Out of Control": 3, "Being Held": 2, "Under Control": 1}


def fetch(ctx: Context) -> list[dict]:
    out = []
    for f in ctx.get_json(URL)["features"]:
        p = f["properties"]
        lat, lon = p.get("LATITUDE"), p.get("LONGITUDE")
        if lat is None or lon is None:
            continue
        size = p.get("CURRENT_SIZE") or 0
        status = p.get("FIRE_STATUS") or "Active"
        name = p.get("INCIDENT_NAME") or p.get("FIRE_NUMBER")
        where = p.get("GEOGRAPHIC_DESCRIPTION")
        severity = STATUS.get(status, 1) + (1 if p.get("FIRE_OF_NOTE_IND") == "Y" else 0)
        out.append(event(
            "bc-wildfires", str(p.get("FIRE_NUMBER") or p.get("OBJECTID")),
            f"Wildfire {name}{f' – {where}' if where else ''}", lat, lon,
            time=iso(p.get("IGNITION_DATE")),
            summary=f"{status}. {size:,.1f} hectares. Cause: {p.get('FIRE_CAUSE') or 'unknown'}."
                    + (" A wildfire of note." if p.get("FIRE_OF_NOTE_IND") == "Y" else ""),
            severity=min(severity, 3), url=p.get("FIRE_URL"), status=status, hectares=size,
        ))
    return out


SOURCE = Source(
    id="bc-wildfires", name="BC wildfires", icon="🔥",
    about="Active wildfires from the BC Wildfire Service",
    attribution="BC Wildfire Service (Open Government Licence – BC)",
    homepage="https://wildfiresituation.nrs.gov.bc.ca/",
    refresh_minutes=15, fetch=fetch, worldwide=False,
)
