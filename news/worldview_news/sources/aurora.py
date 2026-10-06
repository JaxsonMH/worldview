"""Aurora (northern and southern lights) forecast for the next ~hour, from
NOAA's Space Weather Prediction Center, plus the current geomagnetic Kp index.
No key. The forecast is a world grid; we keep cells with a 10%+ chance and
thin them to every 2nd degree so the map stays light."""

from . import Context, Source, event, iso

OVATION = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json"
KP = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
MIN_CHANCE = 10


def fetch(ctx: Context) -> list[dict]:
    kp_rows = ctx.get_json(KP)
    last = kp_rows[-1]
    kp = float(last["Kp"] if isinstance(last, dict) else last[1])
    storm = "a geomagnetic storm" if kp >= 5 else "active conditions" if kp >= 4 else "quiet conditions"
    data = ctx.get_json(OVATION)
    when = iso(data.get("Forecast Time"))
    out = []
    for lon, lat, chance in data["coordinates"]:
        if chance < MIN_CHANCE or lon % 2 or lat % 2:
            continue
        lon = lon - 360 if lon > 180 else lon
        out.append(event(
            "aurora", f"{lon}:{lat}", f"Aurora chance {chance}%", lat, lon, time=when,
            summary=f"{chance}% chance of seeing the aurora here around {when} UTC (if it's dark and clear). "
                    f"Planetary Kp index {kp:.1f}: {storm}.",
            severity=3 if chance >= 50 else 2 if chance >= 30 else 1,
            url="https://www.swpc.noaa.gov/products/aurora-30-minute-forecast", chance=chance, kp=kp,
        ))
    return out


SOURCE = Source(
    id="aurora", name="Aurora & space weather", icon="🌌",
    about="Where the northern/southern lights may be visible in the next hour; Kp index",
    attribution="NOAA Space Weather Prediction Center (OVATION model)",
    homepage="https://www.swpc.noaa.gov/",
    refresh_minutes=30, fetch=fetch,
)
