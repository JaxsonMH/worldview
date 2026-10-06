"""Live data sources: parsing, caching and the API. No internet needed: every
provider is replaced by a tiny fake answer."""

import json

import httpx
import pytest

from worldview_news.sources import Context, Registry, bc_wildfire, ec_alerts, gdelt, tsunami


def fake_client(routes: dict) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        for prefix, body in routes.items():
            if str(request.url).startswith(prefix):
                if isinstance(body, int):
                    return httpx.Response(body)
                return httpx.Response(200, text=body if isinstance(body, str) else json.dumps(body))
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_bc_wildfire_parsing():
    data = {"features": [{"properties": {"LATITUDE": 50.1, "LONGITUDE": -120.2, "FIRE_NUMBER": "K1", "INCIDENT_NAME": "K1",
                                          "FIRE_STATUS": "Out of Control", "CURRENT_SIZE": 120.5, "FIRE_CAUSE": "Lightning",
                                          "IGNITION_DATE": 1791232800000, "FIRE_OF_NOTE_IND": "Y",
                                          "GEOGRAPHIC_DESCRIPTION": "Near Kamloops"}}]}
    [e] = bc_wildfire.fetch(Context(fake_client({"https://services6": data}), {}))
    assert e["title"] == "Wildfire K1 – Near Kamloops"
    assert e["severity"] == 3 and "120.5 hectares" in e["summary"] and e["time"].startswith("2026-")


def test_ec_alert_centre_and_dedupe():
    poly = {"type": "Polygon", "coordinates": [[[-124, 48], [-123, 48], [-123, 49], [-124, 49], [-124, 48]]]}
    feature = {"id": "a1", "geometry": poly, "properties": {"alert_code": "WDW", "alert_type": "warning",
               "alert_name_en": "wind warning", "feature_name_en": "Greater Victoria", "alert_text_en": "Strong winds."}}
    data = {"features": [feature, feature | {"id": "a2"}]}
    [e] = ec_alerts.fetch(Context(fake_client({"https://api.weather.gc.ca": data}), {}))
    assert e["title"] == "Wind warning – Greater Victoria" and e["severity"] == 3
    assert 48 < e["lat"] < 49 and -124 < e["lon"] < -123 and e["geometry"]["type"] == "Polygon"


def test_gdelt_keeps_notable_events_only():
    row = [""] * 61
    row[0], row[28], row[31], row[32] = "1", "14", "5", "3"
    row[51], row[52], row[56], row[57], row[59], row[60] = "4", "Paris, France", "48.85", "2.35", "20261006200000", "https://example.com/a"
    quiet = list(row)
    quiet[0], quiet[28] = "2", "04"  # a consultation: not kept
    few = list(row)
    few[0], few[31] = "3", "1"  # only one mention: not kept
    events = gdelt.parse([row, quiet, few])
    assert [e["title"] for e in events] == ["Protest reported – Paris, France"]


def test_tsunami_atom():
    atom = """<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#">
      <entry><id>x1</id><title>Off the coast of Oregon</title><updated>2026-10-06T18:39:18Z</updated>
      <geo:lat>44.0</geo:lat><geo:long>-125.0</geo:long>
      <summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><strong>Category:</strong> Warning<br/>Move inland.</div></summary>
      <link href="https://www.tsunami.gov/x"/></entry></feed>"""
    events = tsunami.fetch(Context(fake_client({"https://www.tsunami.gov": atom}), {}))
    assert events[0]["title"] == "Tsunami warning – Off the coast of Oregon" and events[0]["severity"] == 3


def test_registry_caches_and_keeps_last_good_answer(monkeypatch):
    calls = []

    def fetch(ctx):
        calls.append(1)
        if len(calls) > 1:
            raise RuntimeError("provider down")
        return [{"id": "x", "source": "bc-wildfires", "title": "t", "lat": 49, "lon": -123, "severity": 1, "time": None}]

    reg = Registry(keys={}, client=fake_client({}))
    monkeypatch.setattr(reg.sources["bc-wildfires"], "fetch", fetch)
    assert len(reg.get("bc-wildfires")["events"]) == 1
    assert len(reg.get("bc-wildfires")["events"]) == 1 and len(calls) == 1  # cached
    res = reg.get("bc-wildfires", force=True)
    assert res["error"].startswith("RuntimeError") and len(res["events"]) == 1  # last good kept


def test_sources_needing_a_key_say_so():
    reg = Registry(keys={}, client=fake_client({}))
    res = reg.get("air-quality")
    assert res["configured"] is False and "OPENAQ_API_KEY" in res["error"] and res["events"] == []


def test_near_filters_by_distance(monkeypatch):
    reg = Registry(keys={}, client=fake_client({}))
    events = [{"id": "a", "title": "near", "lat": 48.43, "lon": -123.37, "severity": 1, "time": "2026"},
              {"id": "b", "title": "far", "lat": 45.4, "lon": -75.7, "severity": 3, "time": "2026"}]
    monkeypatch.setattr(reg.sources["bc-wildfires"], "fetch", lambda ctx: events)
    [res] = reg.near(48.4, -123.4, 25, ["bc-wildfires"])
    assert [e["title"] for e in res["events"]] == ["near"] and res["total"] == 1
