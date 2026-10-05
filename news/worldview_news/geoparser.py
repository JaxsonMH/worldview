"""Work out where an article happened (CLAUDE.md section 7).

Steps for each article:
1. If the feed gave coordinates (GeoRSS), the fetcher already stored them.
2. Find place names three ways:
   - a dateline at the start ("VICTORIA —", "WASHINGTON (AP) —"),
   - spaCy, a language model that marks place names in sentences,
   - matching capitalised phrases against our place list, which catches
     local names spaCy misses (Saanich, Sooke, 100 Mile House). This
     only accepts nicknames from place-aliases.yaml, countries, provinces
     and states, towns in the feed's home region, and very big cities.
3. Each name is looked up in place-aliases.yaml, then the GeoNames gazetteer.
   When a name fits several places ("Victoria", "Georgia"), each is scored:
     - bigger places score higher,
     - places in a country/province the article mentions score higher,
     - places in the feed's home region score a little higher,
     - places near the article's other places score higher.
   Confidence (0-1) reflects how clear-cut the winner was and whether the
   article backs it up.
4. Street / venue names go to OpenStreetMap Nominatim, limited to the city
   already found (see nominatim.py). Optional via geoparser.yaml.
5. Everything is stored with its confidence; the app hides weak guesses.
"""
from __future__ import annotations

import html
import logging
import math
import re
import sqlite3
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

from . import config
from .db import haversine_km
from .gazetteer import GAZETTEER_PATH, normalize

log = logging.getLogger(__name__)

TAG_RE = re.compile(r"<[^>]+>")
MAX_TEXT = 2500
KIND_TO_PRECISION = {"country": "country", "region": "region", "city": "city", "area": "region", "poi": "poi"}
NEARBY_KM = 300


@dataclass
class Place:
    name: str
    precision: str
    lat: float
    lon: float
    country_code: str | None = None
    admin1: str | None = None
    geonames_id: int | None = None
    osm_id: str | None = None
    population: int = 0
    kind: str = ""  # gazetteer kind: country | region (province/state) | city | area | poi

    @property
    def is_admin(self) -> bool:
        return self.kind in ("country", "region")


@dataclass
class Found:
    place: Place
    mention: str
    confidence: float
    order: int


@dataclass
class Mention:
    text: str
    start: int           # character offset; also the "order in text"
    source: str          # dateline | ner | scan | facility
    in_org: bool = False
    state_hint: bool = False  # written "New York state": prefer the state over the city


@dataclass
class Context:
    """What we know about where the story is, before looking at each name.
    `countries` / `admin1s` map each to the (normalised) names that pointed to
    it, so a name never counts as evidence for itself, even if repeated."""
    home_country: str | None = None
    home_admin1: str | None = None
    countries: dict[str, set[str]] = field(default_factory=dict)
    admin1s: dict[tuple[str, str], set[str]] = field(default_factory=dict)

    def names_country(self, cc, exclude: str | None = None) -> bool:
        return bool(self.countries.get(cc, set()) - {exclude})

    def names_admin1(self, key, exclude: str | None = None) -> bool:
        return bool(self.admin1s.get(key, set()) - {exclude})


def clean_text(*parts: str | None) -> str:
    text = " \n".join(html.unescape(TAG_RE.sub(" ", p)) for p in parts if p)
    return re.sub(r"[ \t]+", " ", text).strip()[:MAX_TEXT]


def load_settings(path: Path | None = None) -> dict:
    with open(path or config.CONFIG_DIR / "geoparser.yaml") as fh:
        return yaml.safe_load(fh)


@lru_cache(maxsize=2)
def load_nlp(model: str):
    import spacy

    # Only the parts needed to find names: faster and lighter.
    return spacy.load(model, disable=["lemmatizer", "attribute_ruler", "tagger", "parser"])


class Gazetteer:
    def __init__(self, path: Path = GAZETTEER_PATH, aliases_path: Path | None = None):
        if not Path(path).exists():
            raise FileNotFoundError(f"{path} is missing - run: uv run python -m worldview_news.gazetteer")
        self.db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.aliases: dict[str, list[dict]] = {}
        aliases_path = aliases_path or config.CONFIG_DIR / "place-aliases.yaml"
        if Path(aliases_path).exists():
            with open(aliases_path) as fh:
                for alias in yaml.safe_load(fh).get("aliases", []):
                    for n in alias["names"]:
                        self.aliases.setdefault(normalize(str(n)), []).append(alias)

    def by_id(self, gid: int) -> Place | None:
        r = self.db.execute("SELECT * FROM gz_places WHERE geonames_id = ?", (gid,)).fetchone()
        return self._place(r) if r else None

    @lru_cache(maxsize=20000)
    def candidates(self, name: str) -> list[tuple[Place, bool]]:
        """All places called `name`, each with whether that is its main name."""
        rows = self.db.execute(
            "SELECT p.*, n.is_primary FROM gz_names n JOIN gz_places p USING (geonames_id) WHERE n.name = ?",
            (normalize(name),),
        ).fetchall()
        return [(self._place(r), bool(r["is_primary"])) for r in rows]

    def alias(self, name: str, ctx: Context) -> Place | None:
        for a in self.aliases.get(normalize(name), []):
            home = a.get("only_when_home")
            if home:
                cc, _, a1 = str(home).partition(".")
                if ctx.home_country != cc or (a1 and ctx.home_admin1 != a1):
                    continue
            if "lat" in a:
                precision = a.get("precision", "poi")
                return Place(a.get("name", a["names"][0]), precision, a["lat"], a["lon"],
                             a.get("country_code"), a.get("admin1"), a.get("geonames_id"),
                             kind="area" if precision == "region" else precision)
            place = self.by_id(a["geonames_id"])
            if place:
                return place
        return None

    @staticmethod
    def _place(r: sqlite3.Row) -> Place:
        return Place(r["name"], KIND_TO_PRECISION[r["kind"]], r["lat"], r["lon"], r["country_code"],
                     r["admin1"], r["geonames_id"], population=r["population"], kind=r["kind"])


def score(p: Place, ctx: Context, at: str | None = None) -> tuple[float, bool]:
    """Return (score, whether the article or feed backs this place up).
    `at` is the normalised name being scored (excluded as evidence)."""
    s = min(math.log10(p.population + 1) / 7, 1.0)
    supported = False
    if ctx.names_country(p.country_code, at):
        s += 0.6
        supported = True
    elif p.country_code and p.country_code == ctx.home_country:
        s += 0.3
        supported = True
    if p.admin1 and ctx.names_admin1((p.country_code, p.admin1), at):
        s += 0.5
        supported = True
    elif p.admin1 and p.country_code == ctx.home_country and p.admin1 == ctx.home_admin1:
        s += 0.3
        supported = True
    if p.kind == "country":
        s += 0.5
    elif p.kind == "region":
        s += 0.4  # "Ontario" means the province, not Ontario, California
    return s, supported


def resolve(gaz: Gazetteer, mention: str, ctx: Context, anchors: list[Place] = (),
            at: str | None = None, prefer_region: bool = False) -> tuple[Place, float] | None:
    """Pick the most likely place for a name. `anchors` are confident places
    found elsewhere in the same article (not from this mention)."""
    place = None if prefer_region else gaz.alias(mention, ctx)
    if place:
        return place, 0.9
    cands = gaz.candidates(mention)
    if not cands:
        return None
    scored = []
    if prefer_region and any(c.kind == "region" for c, _ in cands):
        cands = [(c, p) for c, p in cands if c.kind == "region"]
    elif any(c.kind == "city" and c.population >= 1_000_000 and p for c, p in cands):
        # Moscow, Madrid, Havana: the big city, not the province named after it.
        cands = [(c, p) for c, p in cands if c.kind != "region"]
    for c, primary in cands:
        s, supported = score(c, ctx, at)
        if any(a.geonames_id != c.geonames_id and haversine_km(c.lat, c.lon, a.lat, a.lon) < NEARBY_KM for a in anchors):
            s += 0.4
            supported = True
        scored.append((s, supported, primary, c))
    scored.sort(key=lambda t: t[0], reverse=True)
    best_s, supported, primary, best = scored[0]
    margin = best_s - scored[1][0] if len(scored) > 1 else 1.0
    big = best.population >= 100_000 or best.is_admin
    conf = 0.3 + 0.25 * min(margin / 0.6, 1.0) + (0.3 if supported else 0.15 if big else 0.0)
    if not primary and not supported:
        conf -= 0.15  # matched only an alternate spelling, with nothing backing it up
    return best, round(min(max(conf, 0.0), 1.0), 2)


def build_context(gaz: Gazetteer, mentions: list[Mention], home: dict) -> Context:
    ctx = Context(home.get("country"), home.get("admin1"))
    # Countries and provinces/states the article names outright.
    for m in mentions:
        place = gaz.alias(m.text, ctx)
        if place:
            top = [place]
        else:
            top = [c for c, primary in gaz.candidates(m.text) if primary and c.is_admin]
        if len(top) == 1 and top[0].is_admin:
            ctx.countries.setdefault(top[0].country_code, set()).add(normalize(m.text))
            if top[0].kind == "region":
                ctx.admin1s.setdefault((top[0].country_code, top[0].admin1), set()).add(normalize(m.text))
    return ctx


DATELINE_RE = re.compile(r"^\s*([A-Z][A-Z.'\u2019 -]{2,40}?)(?:,\s*([A-Z][A-Za-z. ]{1,30}?))?\s*(?:\([A-Za-z ]+\)\s*)?(?:—|–|--|-)\s")
# "Bolton says ..." - a lone name followed by a speech verb is a person.
SPEECH_RE = re.compile(r"\s+(?:says|said|told|tells|announced|announces|suggests|suggested|warns|warned|argues|argued|"
                       r"writes|wrote|adds|added|insists|insisted|claims|claimed|thinks|believes|admits|admitted)\b")
CAPS_SEQ_RE = re.compile(r"(?:\b(?:\d+|[A-Z][\w\u0300-\u036f\u2019'.-]*)(?:\s+(?:of|de|du|la|le|sur|upon)\s+|\s+)?)+")


def dateline_mentions(text: str) -> list[Mention]:
    out = []
    for line_start in [0, *[m.end() for m in re.finditer(r"\n", text)]]:
        m = DATELINE_RE.match(text, line_start)
        if m and m.group(1).strip().isupper():
            out.append(Mention(m.group(1).strip().title(), m.start(1), "dateline"))
            if m.group(2):
                out.append(Mention(m.group(2).strip(), m.start(2), "dateline"))
    return out


def ner_mentions(doc) -> tuple[list[Mention], list[tuple[int, int, str]]]:
    mentions, spans = [], []
    for ent in doc.ents:
        spans.append((ent.start_char, ent.end_char, ent.label_))
        if ent.label_ in ("GPE", "LOC", "FAC"):
            name = re.sub(r"[\u2019']s$", "", ent.text.strip(" .,"))
            if len(name) >= 3 or name.isupper():
                mentions.append(Mention(name, ent.start_char, "facility" if ent.label_ == "FAC" else "ner"))
    return mentions, spans


def scan_mentions(text: str, gaz: Gazetteer, ctx: Context, ent_spans, ignore: set[str]) -> list[Mention]:
    """Match capitalised phrases against the place list (see module docstring)."""
    out = []
    for seq in CAPS_SEQ_RE.finditer(text):
        words = [(w.group(), seq.start() + w.start()) for w in re.finditer(r"\S+", seq.group())]
        words = [(w.strip(",;:()\"\u201c\u201d"), i) for w, i in words]
        i = 0
        while i < len(words):
            hit = None
            for j in range(min(len(words), i + 5), i, -1):
                phrase = " ".join(w for w, _ in words[i:j]).strip(" .")
                possessive = bool(re.search(r"[\u2019']s$", phrase))
                phrase = re.sub(r"[\u2019']s$", "", phrase)
                if not phrase or phrase in ignore or (len(phrase) < 3 and not phrase.isupper()):
                    continue
                whole = j - i == len(words) or possessive
                if acceptable_scan_hit(phrase, gaz, ctx, single=(j - i == 1), whole=whole):
                    hit = (phrase, words[i][1], j)
                    break
            if hit and " " not in hit[0] and SPEECH_RE.match(text, hit[1] + len(hit[0])) \
                    and not gaz.alias(hit[0], ctx) \
                    and not any(c.is_admin for c, primary in gaz.candidates(hit[0]) if primary):
                hit = None
                i += 1
                continue
            if hit:
                start = hit[1]
                end = start + len(hit[0])
                # Inside a full person name ("Sidney Crosby"). One-word "people" are often
                # mislabelled places, so they don't block a match.
                person = any(s <= start and end <= e and is_person(label, text[s:e]) and " " in text[s:e].strip()
                             for s, e, label in ent_spans)
                if not person:
                    in_org = any(s <= start and end <= e and label == "ORG" for s, e, label in ent_spans)
                    out.append(Mention(hit[0], start, "scan", in_org))
                i = hit[2]
            else:
                i += 1
    return out


def acceptable_scan_hit(phrase: str, gaz: Gazetteer, ctx: Context, single: bool, whole: bool) -> bool:
    if gaz.alias(phrase, ctx):
        # Short all-caps nicknames (BC, US) must be written exactly that way.
        return not (len(phrase) <= 3 and not phrase.replace(".", "").isupper()) or "." in phrase
    for c, primary in gaz.candidates(phrase):
        if not primary:
            continue
        if c.is_admin:
            # A lone word that starts a longer name ("Central Bank") is not a place.
            if whole or not single:
                return True
        elif ctx.home_admin1 and c.country_code == ctx.home_country and c.admin1 == ctx.home_admin1:
            if c.population >= 1000 or not single:
                return True
        elif ctx.home_country and c.country_code == ctx.home_country and c.population >= 20_000:
            return True
        elif c.population >= 500_000:
            return True
    return False


def is_person(label: str, span_text: str) -> bool:
    # spaCy sometimes calls "Nanaimo RCMP" a person; an all-caps acronym means an organisation.
    return label == "PERSON" and not any(len(w) >= 2 and w.isupper() for w in span_text.split())


def person_names(ent_spans, text: str) -> set[str]:
    """Surnames of multi-word person names in the article ("Mark Carney" ->
    "carney"), so a bare "Carney says" isn't mistaken for a town."""
    words = set()
    for start, end, label in ent_spans:
        parts = text[start:end].split()
        if len(parts) >= 2 and is_person(label, text[start:end]):
            words.add(normalize(parts[-1]))
    return words


def geoparse(text: str, home: dict, gaz: Gazetteer, nlp, street_lookup=None,
             ignore: set[str] = frozenset(), never: set[str] = frozenset()) -> list[Found]:
    """Return the places an article mentions, in order, each with a confidence."""
    doc = nlp(text)
    ner, spans = ner_mentions(doc)
    base_ctx = Context(home.get("country"), home.get("admin1"))
    mentions = dateline_mentions(text) + ner + scan_mentions(text, gaz, base_ctx, spans, ignore)
    people = person_names(spans, text)
    never_norm = {normalize(n) for n in never}
    kept = []
    for m in mentions:
        key = normalize(m.text)
        if key in never_norm:
            continue
        if " " not in key and key in people and not gaz.alias(m.text, base_ctx) \
                and not any(c.is_admin for c, primary in gaz.candidates(m.text) if primary):
            continue
        m.state_hint = bool(re.match(r"\s+state\b", text[m.start + len(m.text):m.start + len(m.text) + 7]))
        kept.append(m)
    mentions = sorted(kept, key=lambda m: m.start)
    ctx = build_context(gaz, mentions, home)

    by_mention: dict[int, Found] = {}  # one place per mention position
    anchors: list[tuple[int, Place]] = []
    facilities: list[Mention] = []
    # Two rounds: the second can use places found in the first as "nearby" hints.
    for round_ in (1, 2):
        for m in mentions:
            if m.source == "facility" and not gaz.alias(m.text, ctx):
                if round_ == 1:
                    facilities.append(m)
                continue
            others = [p for o, p in anchors if o != m.start] if round_ == 2 else []
            hit = resolve(gaz, m.text, ctx, others, at=normalize(m.text), prefer_region=m.state_hint)
            if not hit:
                continue
            place, conf = hit
            if m.source == "dateline":
                conf = min(conf + 0.15, 1.0)
            elif m.in_org:
                conf -= 0.1
            conf = round(conf, 2)
            if round_ == 1 and conf >= 0.6 and place.kind != "country":
                anchors.append((m.start, place))
            prev = by_mention.get(m.start)
            if prev is None or conf > prev.confidence:
                by_mention[m.start] = Found(place, m.text, conf, m.start)
    # The same place mentioned twice -> one entry, earliest position, best confidence.
    # Two entries with the same name within 25 km (duplicate gazetteer rows) also merge.
    merged: list[Found] = []
    for f in sorted(by_mention.values(), key=lambda f: f.order):
        twin = next((g for g in merged if same_place(g.place, f.place)), None)
        if twin:
            twin.confidence = max(twin.confidence, f.confidence)
        else:
            merged.append(f)
    result = merged
    if street_lookup and facilities:
        cities = [f.place for f in result if f.place.precision == "city" and f.confidence >= 0.6]
        if cities:
            for m in facilities:
                hit = street_lookup(m.text, cities[0])
                if hit:
                    result.append(Found(hit, m.text, 0.7, m.start))
            result.sort(key=lambda f: f.order)
    for i, f in enumerate(result):
        f.order = i
    return result


def same_place(a: Place, b: Place) -> bool:
    if a.geonames_id and a.geonames_id == b.geonames_id:
        return True
    if a.osm_id and a.osm_id == b.osm_id:
        return True
    return normalize(a.name) == normalize(b.name) and haversine_km(a.lat, a.lon, b.lat, b.lon) < 25


def upsert_place(conn: sqlite3.Connection, p: Place) -> int:
    if p.geonames_id:
        row = conn.execute("SELECT id FROM places WHERE geonames_id = ?", (p.geonames_id,)).fetchone()
    elif p.osm_id:
        row = conn.execute("SELECT id FROM places WHERE osm_id = ?", (p.osm_id,)).fetchone()
    else:
        row = conn.execute("SELECT id FROM places WHERE name = ? AND lat = ? AND lon = ? AND geonames_id IS NULL AND osm_id IS NULL",
                           (p.name, p.lat, p.lon)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO places (name, country_code, admin1, lat, lon, precision, geonames_id, osm_id) VALUES (?,?,?,?,?,?,?,?)",
        (p.name, p.country_code, p.admin1, p.lat, p.lon, p.precision, p.geonames_id, p.osm_id),
    )
    return cur.lastrowid


def geoparse_pending(conn: sqlite3.Connection, limit: int = 500) -> int:
    """Find places in, then rule-tag, articles not processed yet. Returns how many were done."""
    from .topics import apply_rules, load_config

    settings = load_settings()
    topic_cfg = load_config()
    rows = conn.execute(
        """SELECT a.id, a.title, a.summary, a.content, f.folder FROM articles a JOIN feeds f ON f.id = a.feed_id
           WHERE a.geo_done_at IS NULL ORDER BY a.published_at DESC LIMIT ?""", (limit,)
    ).fetchall()
    if not rows:
        return 0
    gaz = Gazetteer()
    nlp = load_nlp(settings.get("spacy_model", "en_core_web_sm"))
    street = None
    if settings.get("street_level"):
        from .nominatim import Nominatim

        street = Nominatim(conn).lookup
    homes = settings.get("home_regions") or {}
    ignore = set(settings.get("ignore_words") or [])
    never = set(settings.get("never_places") or [])
    for r in rows:
        try:
            text = clean_text(r["title"], r["summary"], (r["content"] or "")[:1500])
            found = geoparse(text, homes.get(r["folder"]) or {}, gaz, nlp, street, ignore, never)
            conn.execute("DELETE FROM article_places WHERE article_id = ?", (r["id"],))
            for f in found:
                conn.execute(
                    "INSERT OR IGNORE INTO article_places (article_id, place_id, mention_text, confidence, order_in_text) VALUES (?,?,?,?,?)",
                    (r["id"], upsert_place(conn, f.place), f.mention, f.confidence, f.order),
                )
            apply_rules(conn, r["id"], r["title"], clean_text(r["summary"]), topic_cfg)
        except Exception:  # one odd article must never stall the queue
            conn.rollback()
            log.exception("could not process article %s", r["id"])
        conn.execute("UPDATE articles SET geo_done_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", (r["id"],))
        conn.commit()
    return len(rows)
