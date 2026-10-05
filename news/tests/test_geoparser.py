"""Geoparser tests. They use the real spaCy model but a tiny hand-made
gazetteer (built below), so they run offline and their answers are stable."""

import zipfile

import pytest

from worldview_news.gazetteer import build
from worldview_news.geoparser import Gazetteer, geoparse, load_nlp

# geonameid, name, ascii, alternates, lat, lon, fclass, fcode, cc, admin1, population
CITIES = [
    (6174041, "Victoria", "Victoria", "", 48.4284, -123.3656, "P", "PPLA", "CA", "02", 91867),
    (4527124, "Victoria", "Victoria", "", 28.8053, -97.0036, "P", "PPL", "US", "TX", 65000),
    (6139715, "Saanich", "Saanich", "", 48.4840, -123.3810, "P", "PPL", "CA", "02", 117735),
    (6085772, "Nanaimo", "Nanaimo", "", 49.1666, -123.9400, "P", "PPL", "CA", "02", 90504),
    (6094817, "Ottawa", "Ottawa", "", 45.4112, -75.6981, "P", "PPLC", "CA", "08", 1017449),
    (2988507, "Paris", "Paris", "", 48.8534, 2.3488, "P", "PPLC", "FR", "11", 2138551),
    (6100969, "Paris", "Paris", "", 43.2000, -80.3833, "P", "PPL", "CA", "08", 14000),
    (4351871, "Carney", "Carney", "", 39.3943, -76.5236, "P", "PPL", "US", "MD", 29941),
    (5379439, "Ontario", "Ontario", "", 34.0633, -117.6509, "P", "PPL", "US", "CA", 180000),
    (524901, "Moscow", "Moskva", "Moskva", 55.7522, 37.6156, "P", "PPLC", "RU", "48", 10381222),
    (4140963, "Washington", "Washington", "", 38.8951, -77.0364, "P", "PPLC", "US", "DC", 689545),
    (5128581, "New York City", "New York City", "New York", 40.7143, -74.0060, "P", "PPL", "US", "NY", 8804190),
]
ADMIN1 = [("CA.02", "British Columbia", 5909050), ("CA.08", "Ontario", 6093943), ("US.TX", "Texas", 4736286),
          ("US.CA", "California", 5332921), ("US.MD", "Maryland", 4361885), ("US.DC", "Washington, D.C.", 4138106),
          ("US.NY", "New York", 5128638), ("RU.48", "Moscow", 524894), ("FR.11", "Ile-de-France", 3012874)]
COUNTRIES = [("CA", "Canada", "Ottawa", 6251999), ("US", "United States", "Washington", 6252001),
             ("FR", "France", "Paris", 3017382), ("RU", "Russia", "Moscow", 2017370)]


@pytest.fixture(scope="module")
def gaz(tmp_path_factory):
    src = tmp_path_factory.mktemp("geonames")
    row = lambda c: "\t".join(map(str, [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], "", c[9], "", "", "", c[10], "", "", "", ""]))
    with zipfile.ZipFile(src / "cities1000.zip", "w") as zf:
        zf.writestr("cities1000.txt", "\n".join(row(c) for c in CITIES) + "\n")
    ca = [(5909050, "British Columbia", "British Columbia", "", 53.99, -125.0, "A", "ADM1", "CA", "02", 0),
          (6093943, "Ontario", "Ontario", "", 49.25, -84.5, "A", "ADM1", "CA", "08", 0),
          (9999001, "Malahat", "Malahat", "", 48.5747, -123.5544, "L", "AREA", "CA", "02", 0)]
    with zipfile.ZipFile(src / "CA.zip", "w") as zf:
        zf.writestr("CA.txt", "\n".join(row(c) for c in ca) + "\n")
    (src / "admin1CodesASCII.txt").write_text("\n".join(f"{c}\t{n}\t{n}\t{g}" for c, n, g in ADMIN1) + "\n")
    (src / "countryInfo.txt").write_text("#header\n" + "\n".join(
        "\t".join([cc, "", "", "", name, cap, "", "1000000", "", "", "", "", "", "", "", "", str(gid), "", ""])
        for cc, name, cap, gid in COUNTRIES) + "\n")
    out = src / "gaz.sqlite3"
    build(src, out)
    return Gazetteer(out)


@pytest.fixture(scope="module")
def nlp():
    return load_nlp("en_core_web_sm")


LOCAL = {"country": "CA", "admin1": "02"}
CANADA = {"country": "CA"}


def shown(found):
    """Only what the app would display (confidence >= 0.6), as (name, country)."""
    return [(f.place.name, f.place.country_code) for f in found if f.confidence >= 0.6]


def test_local_town_spacy_misses_is_found(gaz, nlp):
    found = geoparse("Break the Slate campaign launches against Save our Saanich ahead of election", LOCAL, gaz, nlp)
    assert ("Saanich", "CA") in shown(found)


def test_home_region_breaks_ties(gaz, nlp):
    assert shown(geoparse("Victoria council approves new bike lanes", LOCAL, gaz, nlp)) == [("Victoria", "CA")]


def test_dateline(gaz, nlp):
    found = geoparse("MOSCOW (AP) — Officials announced new measures on Monday.", {}, gaz, nlp)
    assert shown(found)[0] == ("Moscow", "RU")
    assert found[0].place.precision == "city"  # the city, not the Moscow region


def test_politician_surname_is_not_a_town(gaz, nlp):
    text = "Carney suggests trade bloc with the U.S. Prime Minister Mark Carney spoke in Ottawa on Monday."
    assert ("Carney", "US") not in shown(geoparse(text, CANADA, gaz, nlp))


def test_province_beats_same_named_foreign_city(gaz, nlp):
    text = "Ontario premier warns about U.S. tariffs on steel."
    found = shown(geoparse(text, CANADA, gaz, nlp))
    assert ("Ontario", "CA") in found and not any(n == "Ontario" and cc == "US" for n, cc in found)


def test_ambiguous_name_without_context_is_hidden(gaz, nlp):
    # Paris, France vs Paris, Ontario in a Canadian feed: too close to call.
    assert shown(geoparse("Fashion week opens in Paris", CANADA, gaz, nlp)) == []


def test_context_resolves_ambiguity(gaz, nlp):
    assert ("Paris", "FR") in shown(geoparse("Fashion week opens in Paris, France", CANADA, gaz, nlp))


def test_multiple_places_keep_text_order(gaz, nlp):
    found = geoparse("The convoy drove from Nanaimo to Victoria on Saturday.", LOCAL, gaz, nlp)
    assert [f.place.name for f in found if f.confidence >= 0.6][:2] == ["Nanaimo", "Victoria"]
    assert [f.order for f in found] == list(range(len(found)))


def test_alias_abbreviation(gaz, nlp):
    found = geoparse("Wildfire season ends early in B.C. this year", CANADA, gaz, nlp)
    assert ("British Columbia", "CA") in shown(found)


def test_state_hint_prefers_state(gaz, nlp):
    found = geoparse("New York state declares measles emergency", {}, gaz, nlp)
    assert found[0].place.name == "New York" and found[0].place.precision == "region"


def test_street_lookup_is_limited_to_found_city(gaz, nlp):
    calls = []

    def fake_lookup(mention, city):
        calls.append((mention, city.name))
        return None

    geoparse("Crews closed Douglas Street in Victoria after a water main break.", LOCAL, gaz, nlp, fake_lookup)
    assert all(city == "Victoria" for _, city in calls)


def test_name_before_speech_verb_is_a_person(gaz, nlp):
    assert ("Paris", "CA") not in shown(geoparse("Paris says the deal is fair.", CANADA, gaz, nlp))
