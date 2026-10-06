"""Air quality: the latest fine-particle (PM2.5) readings from OpenAQ's
worldwide network of monitors. Needs a free OpenAQ key (OPENAQ_API_KEY).

Colours follow the US AQI bands for PM2.5 (µg/m³): ≤12 good, ≤35 moderate,
≤55 unhealthy for sensitive groups, above that unhealthy."""

from . import Context, Source, event, iso

URL = "https://api.openaq.org/v3/parameters/2/latest"  # parameter 2 = PM2.5


def fetch(ctx: Context) -> list[dict]:
    headers = {"X-API-Key": ctx.keys["OPENAQ_API_KEY"]}
    out = []
    for page in range(1, 6):
        data = ctx.get_json(URL, params={"limit": 1000, "page": page}, headers=headers)
        rows = data.get("results") or []
        for r in rows:
            coords = r.get("coordinates") or {}
            value = r.get("value")
            if value is None or value < 0 or coords.get("latitude") is None:
                continue
            band = "good" if value <= 12 else "moderate" if value <= 35 else "unhealthy for sensitive groups" if value <= 55 else "unhealthy"
            out.append(event(
                "air-quality", str(r.get("locationsId") or r.get("sensorsId")), f"PM2.5 {value:.0f} µg/m³ – {band}",
                coords["latitude"], coords["longitude"],
                time=iso((r.get("datetime") or {}).get("utc")),
                summary=f"Fine particles (PM2.5): {value:.1f} µg/m³, {band}.",
                severity=0 if value <= 12 else 1 if value <= 35 else 2 if value <= 55 else 3,
                url=f"https://explore.openaq.org/locations/{r.get('locationsId')}", pm25=value,
            ))
        if len(rows) < 1000:
            break
    return out


SOURCE = Source(
    id="air-quality", name="Air quality (PM2.5)", icon="😷",
    about="Latest fine-particle readings from OpenAQ monitors",
    attribution="OpenAQ (data from government and research monitors)",
    homepage="https://openaq.org/",
    refresh_minutes=60, fetch=fetch, needs_key=("OPENAQ_API_KEY",),
    key_help="https://explore.openaq.org/register (free account → API key)",
)
