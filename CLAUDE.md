# Project Brief — News + OSINT Globe ("Worldview")

Working name: **Worldview** (rename freely). This file is the source of truth for
what we're building and why. Claude Code: read this fully before writing code,
and keep it updated as decisions change.

---

## 1. Who this is for

- Owner: Jaxson. Personal, **non-commercial** use (owner + maybe one friend at home).
- Runs **locally on a Mac** (desktop first; mobile is a "maybe later").
- Owner is **not a developer**. Every component, command, and decision must come
  with a plain-English explanation. Prefer boring, well-documented tools over clever ones.
- **Budget: $0.** Free and open-source tools only; free-tier API keys are fine.
  No paid APIs. No voice control. (Note: a Claude Pro subscription does NOT
  provide API access for the app to call at runtime — it can only be used for
  development via Claude Code. Any AI in the running app must be local/free.)

## 2. What we're building

One app, two main views, sharing one database and one API:

1. **Reader view** — a clean RSS news reader with sorting, filtering (by feed,
   topic, location, date, keyword), and saved searches that are easy to edit later.
2. **Globe view** — a fork of God's Eye View (3D CesiumJS globe) with:
   - A **"My News"** layer: articles pinned where they happened.
   - Toggleable **OSINT layers** (flights, ships, satellites, quakes, fires,
     weather, cameras, conflict, etc.).
   - Later: **cross-links** between news and live layers.

## 3. Foundations (open-source)

| Project | Role | Notes |
|---|---|---|
| `bilawalsidhu/gods-eye-view` | **Base for the globe** | MIT. Vanilla JS + CesiumJS + Vite. Each layer is its own module in `src/data/` / `src/layers/`. Has a server-side key proxy. Node 24.x required. |
| `trevorcapps/osiris` | Parts bin | CesiumJS, 22 feed ingestors, spaCy entity extraction — borrow ingestor ideas + NER approach. |
| `simplifaisoul/osiris` (+forks) | Parts bin | Next.js + MapLibre (different stack — port layers, don't merge). Useful: conflict zones, live news streams, Telegram OSINT. **Do NOT port the recon toolkit** (port scan / vuln scan / WHOIS-on-targets). Main repo title contains what looks like a crypto token address — review any copied code carefully. |

Respect each project's license and each data source's terms (see GEV `DATA_SOURCES.md`).

## 4. Guardrails

- Model **events, places, assets, infrastructure** — never individuals. No
  person search, face recognition, or tracking people. (Same line GEV draws.)
- No active scanning/probing of infrastructure.
- Obey rate limits and usage policies (e.g. Nominatim: max 1 request/second,
  identifying User-Agent, cache results).
- API keys live in `.env` / server-side only, never committed to git.
- Data shown may be delayed or wrong — UI should show source + timestamp.

## 5. Architecture (with plain-English explanations)

```
 ┌──────────────── Mac (localhost) ─────────────────┐
 │                                                   │
 │  News Service (Python)        Globe App (Node)    │
 │  ├─ Feed fetcher   ──┐        ├─ GEV fork (Vite)  │
 │  ├─ Geoparser        ├─> SQLite <── /api/news ────┤
 │  ├─ Topic tagger     │   (one file)               │
 │  └─ REST API ────────┘        └─ Reader view tab  │
 └───────────────────────────────────────────────────┘
```

- **News Service (Python + FastAPI):** a small background program that checks
  your feeds every few minutes, saves new articles, figures out where they
  happened, and tags their topic. Python because the best free language/place
  tools (spaCy, feedparser) live there.
- **SQLite:** the database — just a single file on disk. No server to run.
- **REST API:** a set of URLs the front-end calls to ask for data
  (e.g. "give me Canadian politics from the last 24h as map points").
- **Globe App (Node + Vite):** the God's Eye View fork. Vite is the tool that
  runs the website locally while you develop.
- **Reader view:** a tab in the same web app, using the same API as the globe,
  so filters and saved searches work identically in both views.
- **One command to start everything** (e.g. `./start.sh` or `make dev`) — the owner
  should never need to remember multiple commands.

Design rule: **the reader and the globe are two views of the same filtered query.**
Any filter (topic, place, date, keyword, saved search) is a single object that
both views can consume.

## 6. Data model (initial)

- `feeds` — id, url, title, category/default_topic, folder, enabled, last_fetched, error_count
- `articles` — id, feed_id, guid, url, title, summary, content, author, published_at, fetched_at, read, starred, content_hash (dedupe)
- `places` — id, name, country_code, admin1 (province/state), lat, lon, precision (`country|region|city|street|poi`), geonames_id/osm_id
- `article_places` — article_id, place_id, mention_text, confidence (0–1), order_in_text
- `topics` / `article_topics` — article_id, topic, source (`feed_default|rule|model`), confidence
- `saved_searches` — id, name, query_json, created, updated (editable anytime)

Precision + confidence are stored so the UI can hide weak guesses and we can
tune thresholds later without re-processing.

## 7. Geolocation pipeline (free)

1. If the feed provides GeoRSS / coordinates → use them.
2. Extract place mentions with **spaCy NER** (GPE, LOC, FAC entities).
3. Resolve names → coordinates with the **GeoNames** gazetteer
   (download `cities15000` / `allCountries`, CC-BY, stored locally).
   Disambiguate using: feed's home region, country mentioned in the article,
   population, and other places in the same article.
4. Street / venue mentions (e.g. "Douglas Street", "the Legislature") →
   **Nominatim** (OpenStreetMap), constrained to the city already identified,
   rate-limited and cached.
5. Assign confidence; below threshold → keep the article, drop the pin.
6. **Multi-location stories:** one pin per place, all linked to the article,
   connected by a line in the order mentioned (e.g. parade route / festival sites).
   City-level is the target; street-level is best-effort — if it proves
   unreliable in testing, disable street level via config, not code changes.
7. Articles with no confident location: still shown in Reader; on the globe,
   placed in a per-country "unplaced" bucket if a country is known, otherwise hidden.

Optional later: a **local LLM via Ollama** (free, runs on the Mac) as a second
opinion for ambiguous places and topic tagging. Must stay optional — the app
works without it. Depends on the Mac's RAM.

## 8. Topics

Taxonomy (editable in `config/worldview/topics.yaml`, not hard-coded):
Local (Greater Victoria / Vancouver Island) · Canada (general Canadian news) · BC Politics ·
Canadian Politics · US Politics · World (general international news) · World Politics · Business & Markets · Technology ·
Conflict & Military · Disasters & Environment · Crime & Justice · Sports · Health · Arts & Culture.

Articles can carry several topics. Feeds give a *broad* default (CTV → Canada, BBC → World);
subject topics (crime, sports, health, politics…) come from keyword rules on top,
so "Canada + Crime & Justice" is normal. Politics topics are never a feed default
for general news feeds.

Tagging order: feed default → keyword/place rules (e.g. Canadian article whose
places are all in BC → BC Politics) → optional local model. Users can re-tag manually.

## 9. Reader view requirements

- Unified article list + preview pane; open original link.
- Sort: newest, oldest, source, topic.
- Filter: feed/folder, topic, location (country → province → city, and
  "within X km of a point"), date range, keyword, read/unread, starred, has-location.
- **Saved searches**: save current filters with a name; edit/rename/delete any time;
  pin favorites to a sidebar.
- Feed management: add by URL, import/export OPML, folders, show broken feeds.
- "Show on globe" button on each article (flies globe to its pins).
- Built with the globe in mind: same filter object, same API.

## 10. Globe view requirements

- "My News" layer: clustered pins colored by topic, linked-location lines,
  click → article card, time-window slider (6h / 24h / 7d / custom).
- Layer panel with on/off toggles grouped by category.
- Country click → list of that country's unplaced articles.

## 11. Layer catalog (candidates — verify reliability/terms during build)

Already in GEV: flights, military flights, ships (AISStream, free key),
satellites, earthquakes, fires (NASA FIRMS, free key), traffic, public CCTV
(incl. DriveBC), radio, transit, weather/radar/cyclones, space launches,
datacenters, dams, submarine cables, mapped military installations.

To add (owner's requests + suggestions):
- **Conflict zones / events** — port from Osiris; ACLED (registration, check current non-commercial access terms).
- **Live news streams** — port from Osiris.
- **GDELT** — free, geocoded global news events; also a cross-check for our own geolocation.
- **Disaster alerts** — GDACS, ReliefWeb.
- **Volcanoes** (Smithsonian GVP), **tsunami warnings** (NOAA).
- **Internet outages** — IODA (Georgia Tech), Cloudflare Radar (free token).
- **Air quality** — OpenAQ (free key).
- **Space weather** — NOAA SWPC.
- **Canada/BC local** — Environment Canada weather alerts (MSC GeoMet),
  NRCan earthquakes, BC Wildfire Service, DriveBC events.
- **Resource activity** (no free source publishes reliable *daily site-level extraction*; use proxies and label them as such):
  - Global Fishing Watch — fishing effort, near-real-time (free non-commercial key).
  - VIIRS gas flares — oil/gas activity proxy.
  - Tanker/bulk-carrier AIS around export terminals — shipment proxy.
  - Static context: Global Energy Monitor trackers (mines, plants, pipelines),
    USGS mineral sites, WRI power plants.
  - Country-level monthly production (EIA, JODI) as choropleth, not pins.

## 12. Cross-linking (Phase 3)

- Click a news pin → "what else is here?": quakes, fires, alerts, outages, flights
  within radius R and time window T.
- Click a live event (quake, fire, outage) → related news within R/T.
- Story clustering: multiple sources covering the same event grouped into one pin.
- Saved-search alerts: notify when a new article/event matches.
- Design as a generic "spatial-temporal join" service so any new layer
  automatically participates (layer only needs to expose lat/lon/time).

## 13. Build phases & acceptance checks

**Phase 0 — Setup:** install toolchain (Homebrew, git, Node 24, Python 3.12,
uv/venv), fork/clone GEV, confirm it runs keyless. Explain each step.

**Phase 1 — Reader:** news service, SQLite, starter feeds, geoparser, topics,
reader UI, saved searches.
✔ Feeds fetch on schedule ✔ no duplicates ✔ filters + saved searches work
✔ ≥80% of local/Canadian articles get a correct city-level pin on a spot-check of 50.

**Phase 2 — Globe:** My News layer + ported/added layers + layer panel.
✔ every enabled layer loads or shows a clear "unavailable" state
✔ "Show on globe" round-trip works ✔ automated health check script passes.

**Phase 3 — Cross-linking + scalability:** spatial-temporal join, story clustering,
alerts, data retention (e.g. prune articles > 90 days unless starred).

## 14. Maintainability & documentation (required)

- `docs/worldview/` folder written for a non-developer (kept apart from GEV's own `docs/`):
  - `HOW-IT-WORKS.md` — plain-English tour of every piece.
  - `RUNNING.md` — start/stop/update, common fixes.
  - `ADDING-A-FEED.md`, `ADDING-A-LAYER.md` — step-by-step recipes.
  - `DECISIONS.md` — log of choices and why.
- Config in files (`feeds.opml`, `topics.yaml`, `layers.json`), not in code.
- `make health` (or `./health.sh`) checks every feed and layer and reports in plain English.
- Tests for the geoparser and filter logic.
- Keep upstream GEV changes mergeable: put our code in clearly separate folders.

## 15. Starter feeds (owner has none yet — find current RSS URLs and verify)

- **Local:** Times Colonist, CHEK News, Victoria News / Black Press, CBC British Columbia, Capital Daily
- **Canadian:** CBC News, CTV News, Globe and Mail, National Post, The Canadian Press, iPolitics
- **World:** Reuters, AP, BBC World, Al Jazeera, The Guardian World, NPR
- **Business:** Financial Post, BNN Bloomberg, CNBC
- **Tech:** Ars Technica, The Verge, Hacker News front page
- **Conflict/OSINT:** Institute for the Study of War, Bellingcat, War on the Rocks, Defense News, The War Zone
Present this list to the owner for approval before importing.

## 16. Open items

- Owner's Mac: **MacBook Pro, M3 Pro, 18 GB RAM.** Enough for an optional local LLM
  via Ollama using a small model (~3–8B parameters, 4-bit, ~2–5 GB RAM); keep it optional.
- Owner to sign up for free keys when a layer needs one (walk them through it).
- Arc-based feeds (CTV, CP24, BNN Bloomberg) mislabel times by ~4 h; add per-feed time correction.
- Owner to do their own geo spot-check (`make spot-check`) once running on the Mac.

## 17. Progress (keep updated)

Code layout: `news/` (Python news service), `config/worldview/` (feeds, topics, place settings,
globe layers), `src/worldview/` + `reader.html` + `globe.html` (our pages), `server/worldview/`
(API forwarder + home-page redirect), `docs/worldview/`, `scripts/worldview/`, `start.sh`,
`Makefile`. Everything else is upstream GEV, used as an engine; edited only:
`server/standalone/vite.config.js` (+2 lines), `src/tooling/viteBuild.test.mjs` (plugin order),
`scripts/check-import-directions.mjs` (our page entries).

UI direction (owner, 2026-10-06): clean, modern, data-first, but with character (owner found
the first plain version "soulless"). No GEV "spy" styling or branding in Worldview pages; GEV's
own UI stays reachable as "Classic view" only. Owner wants rich per-location live views.

- **Phase 0:** ✔ repo is the GEV fork ✔ GEV boots keyless on Node 24 (`npm run doctor`)
  ✔ `scripts/worldview/setup-mac.sh` + `docs/worldview/SETUP-MAC.md` written
  ☐ owner runs setup on the Mac and confirms the globe renders.
- **Phase 1:** ✔ SQLite schema ✔ fetcher (scheduled, ETag, dedupe, future-date clamp, GeoRSS)
  ✔ shared filter object + saved-search CRUD API ✔ tests (`make test`)
  ✔ starter feeds approved (34, incl. substitutes + extras) → `config/worldview/feeds.opml`,
  auto-imported on every start ✔ ISW read via WordPress JSON (`wordpress.py`)
  ✔ geoparser (datelines + spaCy + gazetteer matching, GeoNames, Nominatim) — see `docs/worldview/DECISIONS.md`
  ✔ rule-based topic tagger (keywords + place rules, manual override)
  ✔ Reader (`/reader.html`): filters, saved searches, feed management, topic editing
  ✔ `/api/news` proxy in Vite ✔ geo spot-check: 96% city-level on an unseen sample of 50
  ☐ owner verification on the Mac. **Phase 1 is otherwise complete.**
- **Phase 2:** ✔ clean Worldview globe (`globe.html`, home page) on the GEV engine
  ✔ layer panel grouped by subject with live status / "needs a key" / "unavailable"
  ✔ My News layer (topic colours, clusters, country buckets, route line on selection, time window)
  ✔ "Show on globe" ↔ "Open in Reader" round trip ✔ click cards for engine layers
  ✔ zoom-aware grouping (country / province / place) with per-level connections; province/country
  named only as context no longer creates lines (`newsLevels.js`)
  ✔ Live view: cameras (live pictures), weather, news, quakes, aircraft, ships, satellites… for any spot
  ✔ "night atlas" visual refresh, layer search/icons, ticker, day/night shading
  ☐ owner check on the Mac ☐ `make health` ☐ new layers (GDELT, GDACS, BC Wildfire, EC alerts…)
  ☐ custom time window on the globe ☐ key setup inside Worldview (still in Classic view).
