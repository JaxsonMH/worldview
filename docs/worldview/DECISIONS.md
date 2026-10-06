# Decisions log

Newest first. Each entry: what we chose, and why.

## 2026-10-06 — Zoom levels, Live view, a globe with more character

- **Bug (owner):** stories naming a town *and* its province ("Victoria, B.C.")
  drew a line from the town to the middle of BC, so lines converged on
  province centres. **Fix:** a province is treated as context and dropped when
  the story names a place inside it; a country likewise
  (`src/worldview/newsLevels.js`, tested). The database still stores both, so
  Reader location filters are unaffected.
- **Zoom-aware grouping** (owner's idea): far out, stories group by
  **country**; mid-zoom by **province/state**; close in by **place**
  (thresholds 6,000 km / 700 km camera height). "Auto" follows the zoom,
  or the level can be pinned. Clicking a marker draws glowing lines to the
  other places its stories mention *at that level*, so a BC–Ontario story
  connects BC and Ontario at province level and Victoria and Ottawa at place
  level. Replaces Cesium's pixel clustering, which grouped things that merely
  looked close.
- Country markers use the **middle of the country's towns** (spherical
  average), not the capital, so "Canada" isn't drawn on Ottawa
  (`/api/news/anchors`).
- **Markers** are drawn on a canvas: a ring split by the topic mix of the
  stories, with the count inside. (Not Cesium text labels, which GEV's tests
  forbid.)
- **Live view** (owner: "all camera and real-world data for a location"):
  right-click anywhere, use the 📡 button, search a place, or click "Live
  view here" on a story. It uses GEV's tool catalog (`src/tools`): the same
  read-only queries GEV built for assistants, each with an area. Shows live
  traffic-camera pictures (DriveBC etc.), weather, nearby news, quakes,
  fires, aircraft, ships, satellites, transit and traffic, refreshed every
  minute, each with its source and time. Unavailable sections say why
  (needs a key / not covered here). This is the first piece of the Phase 3
  "what else is here?" idea.
- **Look:** the globe page uses a dark "night atlas" theme (globe and data
  are the bright things), glass panels over a full-screen globe, Space
  Grotesk headings, an emoji icon per layer, day/night shading on the Earth,
  a scrolling headline ticker, and a stats strip. The Reader keeps its
  lighter, reading-first look.
- **Panel:** layer search, chips for layers that are on (× to switch off),
  collapsible panel.
- News API page limit raised to 3,000 (the globe loads up to 1,500 stories).

## 2026-10-06 — A clean Worldview globe instead of restyling God's Eye View

- Owner wanted a modern, simple, data-first globe without GEV's "spy"
  styling or branding. Rather than restyle GEV's ~20 interface stylesheets
  (which would conflict with every upstream update), we built **our own
  page, `globe.html`**, that uses GEV only as an *engine*: its globe, base
  maps and data layers (via `src/standalone/scene.js`, `catalog.js` and
  `data/lifecycle.js`), with none of its interface.
- **`/` now opens the Worldview globe.** GEV's interface remains at
  `/index.html` ("Classic view" link) for tools not yet brought across:
  CCTV viewer, radio player, key setup, scenes/director.
- **Layer list in `config/worldview/layers.json`** (JSON rather than YAML so
  the browser can read it without extra code). Left out on purpose:
  licence-plate-reader cameras (guardrails), a one-off Nepal demo, and
  helpers that only make sense in the classic UI.
- **My News**: pins coloured by the article's *subject* topic (falling back
  to its broad topic), grouped into numbered clusters when crowded, grey dots
  for stories placed only at country level. A story's places are joined by
  a numbered line **only when it's selected**; drawing every multi-place
  story at once was an unreadable tangle.
- **Clicks**: My News items open an article card; any other engine item
  shows a generic card of its readable properties. Because some engine
  layers draw their symbols separately from their data, a click that hits
  nothing picks the nearest item within 14 px (skipping the far side of
  the Earth).
- No on-globe text labels for our items: GEV's tests forbid Cesium labels
  (blurry, slow); the card lists places instead. Cluster counts are the
  one exception, drawn by Cesium's clustering itself.
- Upstream files touched: `scripts/check-import-directions.mjs` (+3 lines,
  treat `src/worldview/*/main.js` as page entries like `src/main.js`) and
  `server/worldview/newsProxy.js` (ours) now also redirects `/`.
- Single-article API now returns places and topics (via a new `ids` filter).

## 2026-10-05 — World topic

- Same treatment as Canada: new broad **World** topic is the default for Al
  Jazeera, BBC World, CBC World, DW, France 24, NPR World and The Guardian
  World. **World Politics** now comes from keywords (election, protests,
  diplomats, sanctions, NATO, EU, …) and only counts on World articles.
- **US Politics keywords tightened**: bare "Senate" and "Supreme Court" also
  mean Canada's, so only "U.S. Senate", "Congress", "White House",
  "Republicans", etc. count.
- **Short all-caps keywords must be in capitals** (UN, EU, MP, NHL), so the
  French "un" isn't World Politics.
- Added keywords exposed by the review (Premier League, floods, plague,
  FBI/arrests, military/army/navy). Dropped bare "war" ("trade war").
- Result on 1,077 live articles: of 153 World-feed stories, 101 now also
  carry a subject topic (World Politics 57, plus crime, health, sports,
  conflict); 52 are general "World" news (science, culture, odd stories).

## 2026-10-05 — Canada topic and subject topics

- Owner asked for a general **Canada** topic, and for crime, sports and other
  subjects to have their own topics. Added: Canada, Crime & Justice, Sports,
  Health, Arts & Culture.
- **Feeds give a broad topic; keywords add the subject.** CBC Top Stories,
  CTV, Globe and Mail (Canada), National Post, Canadian Press and Global News
  BC now default to Canada (they were Canadian Politics / BC Politics, which
  mislabelled crime and sports). CBC Politics, Globe Politics and iPolitics
  keep Canadian Politics; The Tyee keeps BC Politics.
- **Canadian Politics keywords only count on Canadian articles**
  (`only_with_topics` in topics.yaml); otherwise "election" tagged stories
  about Pakistan and Israel.
- **`make reprocess` now also re-applies feed default topics**, so changing a
  feed's topic re-labels its old articles too (hand-tagged ones are kept).
- Checked on 1,077 live articles: Crime & Justice 88, Health 28, Sports 19,
  Arts & Culture 11, Canadian Politics (by keyword) 48, with headlines read
  by eye. Remaining oddities are rare (e.g. a fighter-jet story tagged
  Sports); tune keywords in topics.yaml.

## 2026-10-05 — Geoparser, topics, Reader

- **Place list = GeoNames `cities1000` (towns of 1,000+ people worldwide) +
  all provinces/states/countries + BC's small places and features**, stored
  offline in `news/data/gazetteer.sqlite3` (22 MB, built in ~10 s). The full
  `allCountries` file (400 MB) wasn't worth it.
- **Three ways of spotting names, not one.** spaCy alone missed Saanich,
  Sooke, Kamloops and "WASHINGTON (AP)", and labelled the same word
  differently in different sentences. Adding datelines and direct
  place-list matching fixed that; the list matching is limited to nicknames,
  countries/provinces, home-region towns and big cities, so ordinary words
  don't become places.
- **spaCy small model (`en_core_web_sm`).** The medium model was no better on
  our misses (both mislabel local names); small is faster and lighter.
  Switchable in `geoparser.yaml`.
- **Confidence comes from "how clear-cut" + "does the article back it up".**
  A place never counts as evidence for itself (a bug that put "West Coast"
  in New Zealand). Million-plus cities beat provinces of the same name
  (Moscow, Madrid); otherwise a named province beats a same-named town
  (Ontario, not Ontario, California).
- **People aren't places:** a single word that's the surname of a full
  person name in the story, or is followed by "says/said/…", is skipped.
  Names containing an acronym ("Nanaimo RCMP") aren't treated as people.
- **Spot-check (Phase 1 target ≥ 80% correct city-level pins).** Three
  samples of 50 Local + Canada articles, checked by hand against title and
  summary. Samples 1–2 were used to find and fix problems. **Sample 3 was
  unseen when scored: 24 of 25 articles naming a town got the right pin
  (96%), with 2 wrong extra pins in 50 articles.** Both wrong pins and the
  one miss were then fixed by general rules (not article-specific hacks)
  and re-checked against all three samples. Re-run any time: `make spot-check`.
  Caveat: graded by Claude, not the owner; worth an owner spot-check.
- **Nominatim is only asked about streets/venues inside a city already found**
  (25 km box), 1 request/second, every answer cached in the database.
- **BC Politics place rule also needs a political keyword.** General news
  feeds (CTV, CBC Top Stories, Globe Canada, CP) default to "Canadian
  Politics", so "Canadian Politics + all places in BC" was tagging BC crime
  and business stories as BC Politics.
- **Reader is its own page (`/reader.html`)** next to the globe, not inside
  GEV's `index.html`, so upstream GEV changes stay easy to merge. A "Reader /
  Globe" tab bar links them. It's plain JavaScript (no framework), like GEV.
- **`/api/news` reaches the news service through a small forwarder** in the
  globe app's dev server (`server/worldview/newsProxy.js`), because GEV's
  security policy only lets the page talk to its own server. This was the
  one upstream file we edited (`server/standalone/vite.config.js`, +2 lines),
  plus the upstream test that checks that plugin order.
- **One kind of location filter at a time** in the Reader: choosing "Near…"
  clears country/province/city and vice versa (combining them was a common
  way to get zero results).
- **Feed changes made in the Reader are written back to `feeds.opml`**, so the
  file stays the single source of truth.

## 2026-10-05 — Starter feeds approved

- Owner approved all 34 feeds, including DW / France 24 / CBC World in place of
  Reuters and AP, plus Global News BC, The Tyee and NPR Politics.
- **ISW** is read through its public WordPress article list. The reader is one
  small file (`wordpress.py`) and is used automatically for any feed URL
  containing `/wp-json/wp/v2/posts`, so it can serve other WordPress sites
  too. It needed no new settings or database changes.
- **`feeds.opml` is re-read on every start**, so editing that one file is all it
  takes to add, rename or disable a feed.

## 2026-10-05 — Phase 0/1 groundwork

- **This repo is the God's Eye View fork.** It already contained GEV (MIT), so
  Phase 0 "fork/clone GEV" was done; we add our code in separate folders
  (`news/`, `config/worldview/`, `docs/worldview/`, `scripts/worldview/`) to keep
  upstream changes mergeable.
- **GEV runs keyless.** Checked with Node 24.21: `npm run doctor` reports Esri
  imagery + keyless terrain, anonymous OpenSky flights, public quakes/launches;
  ships (AISStream), fires (FIRMS), voice (OpenAI) stay off until keys are added.
  Voice is out of scope (no paid APIs).
- **Our docs live in `docs/worldview/`**, not loose in `docs/`, because `docs/`
  already holds ~20 upstream GEV pages; mixing them would be confusing.
- **Python service uses uv** (installs Python 3.12 and packages into the project
  folder) and **FastAPI** (small, well documented, gives a free interactive API page).
- **Dedupe by cleaned-up article link**, not by feed+guid, so the same story in
  two feeds (e.g. CBC Top Stories and CBC Politics) is stored once. Tracking
  junk like `utm_source` is removed first. Items without a link fall back to feed+guid.
- **Future-dated items are clamped to "first seen".** Times Colonist publishes
  scheduled pages dated ~2 weeks ahead; CTV, CP24 and BNN Bloomberg (all on the
  "Arc" publishing system) write the UTC clock time but label it Eastern
  (−04:00), so items look ~4 h in the future.
  *Known gap:* clamping fixes the newest Arc items but older ones are still ~4 h
  late. A per-feed time correction is a planned follow-up.
- **User-Agent has no URL in it.** CBC silently drops requests whose User-Agent
  contains a link (tested: plain "Worldview/0.1 (...)" works, anything with
  "https://" times out). We identify honestly as "Worldview/0.1"; we do **not**
  pretend to be a web browser to get around blocks (AP and CNBC's old address
  return 403 to everyone, so they're dropped/replaced instead).
- **Keyword search uses simple LIKE matching** (every word must appear in the
  title or summary). Good enough for thousands of articles; can switch to
  SQLite full-text search later without changing the API.
- **Weak place guesses are hidden, not deleted.** Places below confidence 0.6
  are ignored by filters and pins by default (`min_confidence` in the filter),
  so the threshold can be tuned later without re-processing.
- **Feeds are not imported until the owner approves the list** (STARTER-FEEDS.md).
