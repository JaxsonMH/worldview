"""NOAA tsunami bulletins from both US warning centres (Alaska and Pacific).
Atom feeds with coordinates, no key. Most bulletins say "no tsunami threat";
warnings and advisories are marked severe."""

import re
import xml.etree.ElementTree as ET

from . import Context, Source, event, iso

FEEDS = ["https://www.tsunami.gov/events/xml/PAAQAtom.xml", "https://www.tsunami.gov/events/xml/PHEBAtom.xml"]
NS = {"a": "http://www.w3.org/2005/Atom", "geo": "http://www.w3.org/2003/01/geo/wgs84_pos#"}
TAGS = re.compile(r"<[^>]+>")


def fetch(ctx: Context) -> list[dict]:
    out = []
    for url in FEEDS:
        resp = ctx.client.get(url)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        for entry in root.findall("a:entry", NS):
            lat = entry.findtext("geo:lat", namespaces=NS)
            lon = entry.findtext("geo:long", namespaces=NS)
            if not lat or not lon:
                continue
            summary_el = entry.find("a:summary", NS)
            text = TAGS.sub(" ", ET.tostring(summary_el, encoding="unicode")) if summary_el is not None else ""
            text = re.sub(r"\s+", " ", text).strip()
            category = re.search(r"Category:\s*(\w+)", text)
            cat = category.group(1) if category else "Information"
            severity = {"Warning": 3, "Advisory": 2, "Watch": 2, "Threat": 3}.get(cat, 0)
            link = entry.find("a:link", NS)
            out.append(event(
                "tsunami", entry.findtext("a:id", namespaces=NS) or entry.findtext("a:updated", namespaces=NS),
                f"Tsunami {cat.lower()} – {entry.findtext('a:title', namespaces=NS)}", float(lat), float(lon),
                time=iso(entry.findtext("a:updated", namespaces=NS)), summary=text[:600], severity=severity,
                url=link.get("href") if link is not None else "https://www.tsunami.gov/", category=cat,
            ))
    return out


SOURCE = Source(
    id="tsunami", name="Tsunami bulletins", icon="🌊",
    about="NOAA tsunami warnings, advisories and information statements",
    attribution="NOAA/NWS National and Pacific Tsunami Warning Centers",
    homepage="https://www.tsunami.gov/",
    refresh_minutes=5, fetch=fetch,
)
