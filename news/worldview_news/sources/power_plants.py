"""Power plants of 100 MW or more worldwide, from the World Resources
Institute's Global Power Plant Database (CC BY 4.0). A fixed list (last
updated by WRI in 2021): background context, not live activity. Downloaded
once a week at most."""

import csv
import io

from . import Context, Source, event

URL = "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv"
MIN_MW = 100


def fetch(ctx: Context) -> list[dict]:
    if ctx.previous:  # the list doesn't change; keep what we have
        return ctx.previous
    resp = ctx.client.get(URL)
    resp.raise_for_status()
    out = []
    for r in csv.DictReader(io.StringIO(resp.text)):
        try:
            mw = float(r["capacity_mw"])
        except ValueError:
            continue
        if mw < MIN_MW:
            continue
        fuel = r["primary_fuel"]
        out.append(event(
            "power-plants", r["gppd_idnr"], f"{r['name']} ({fuel}, {mw:,.0f} MW)", float(r["latitude"]), float(r["longitude"]),
            summary=f"{fuel} power plant in {r['country_long']}, {mw:,.0f} MW"
                    + (f", owner {r['owner']}" if r.get("owner") else "")
                    + (f", built {int(float(r['commissioning_year']))}" if r.get("commissioning_year") else "")
                    + ". Static WRI data (2021).",
            severity=0, url=r.get("url") or "https://datasets.wri.org/dataset/globalpowerplantdatabase",
            fuel=fuel, capacity_mw=mw,
        ))
    return out


SOURCE = Source(
    id="power-plants", name="Power plants (100 MW+)", icon="🏭",
    about="Big power plants by fuel type (World Resources Institute, static 2021)",
    attribution="World Resources Institute, Global Power Plant Database (CC BY 4.0)",
    homepage="https://datasets.wri.org/dataset/globalpowerplantdatabase",
    refresh_minutes=7 * 24 * 60, fetch=fetch, max_events=20000,
)
