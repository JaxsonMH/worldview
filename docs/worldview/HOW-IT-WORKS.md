# How Worldview works

```
 ┌──────────────── Mac (localhost) ─────────────────┐
 │  News Service (Python)        Globe App (Node)    │
 │  ├─ Feed fetcher   ──┐        ├─ GEV fork (Vite)  │
 │  ├─ Geoparser        ├─> SQLite <── /api/news ────┤
 │  ├─ Topic tagger     │   (one file)               │
 │  └─ REST API ────────┘        └─ Reader view tab  │
 └───────────────────────────────────────────────────┘
```

## The pieces, and where they live

| Piece | Folder | What it does |
|---|---|---|
| **Globe app** | everything outside `news/` (the God's Eye View fork) | The 3D globe and its live layers (flights, ships, quakes…). |
| **News service** | `news/` | A small Python program that runs in the background. |
| ↳ Feed fetcher | `news/worldview_news/fetcher.py` | Every 10 minutes, downloads each feed and saves new articles. Skips duplicates; fixes feeds that claim articles from the future. ISW (no RSS) is read by `wordpress.py`. |
| ↳ Geoparser | `news/worldview_news/geoparser.py` | Finds where each article happened (see below). |
| ↳ Place list | `news/worldview_news/gazetteer.py` → `news/data/gazetteer.sqlite3` | ~189,000 places from GeoNames, kept offline. Built once on first start. |
| ↳ Street lookups | `news/worldview_news/nominatim.py` | Streets/venues via OpenStreetMap, 1 per second, remembered forever. |
| ↳ Topic tagger | `news/worldview_news/topics.py` | Feed default → keyword rules → place rules → your manual edits. |
| ↳ Filters | `news/worldview_news/filters.py` | The one "which articles do you want?" description that both the Reader and the Globe use. |
| ↳ REST API | `news/worldview_news/api.py` | The web addresses (`/api/news/...`) the app calls. |
| **Reader** | `reader.html`, `src/worldview/` | The news reader page: http://localhost:4173/reader.html |
| ↳ Shared filter | `src/worldview/newsFilter.js` | The browser's copy of the filter rules; also keeps the filter in the page address. |
| ↳ Forwarder | `server/worldview/newsProxy.js` | Passes `/api/news` from the globe app's server to the news service, so the browser talks to one address. |
| **Database** | `news/data/worldview.sqlite3` | One file holding feeds, articles, places, topics and saved searches. |
| **Settings** | `config/worldview/` | `feeds.opml` (feeds), `topics.yaml` (topics + rules), `geoparser.yaml` and `place-aliases.yaml` (place finding). Edit these, not code. |
| **Our docs** | `docs/worldview/` | These pages. |

Our code is kept in its own folders so improvements from the original God's
Eye View project can still be pulled in without clashes.

## How an article gets its pins

1. **Find names.** Three detectors, combined:
   - *Datelines* such as "VICTORIA —" or "WASHINGTON (AP) —" at the start of a story.
   - *spaCy*, a free language model that marks place names in sentences.
   - *Place-list matching*: capitalised phrases checked directly against the place
     list. This catches local names spaCy misses (Saanich, Sooke, 100 Mile House),
     but only accepts nicknames from `place-aliases.yaml`, countries,
     provinces/states, towns in the feed's home region and very big cities, so
     ordinary words don't turn into places.
2. **Pick the right place** when a name fits several ("Victoria", "Paris"). Each
   candidate is scored: bigger places score higher; places in a country or
   province the article names score higher; places in the feed's home region
   (BC for Local feeds, Canada for Canada feeds) score a little higher; places
   near the article's other places score higher.
3. **Confidence** (0–1) says how clear-cut that was. Below 0.6 the place is kept
   but not shown. A name next to a politician's full name ("Mark Carney") or
   followed by "says" is treated as a person, not a town.
4. **Streets and venues** ("Douglas Street") are looked up in OpenStreetMap, but
   only inside the city already found.
5. Several places → several pins, in the order the story mentions them.

When a pin is wrong, see [TUNING-PLACES-AND-TOPICS.md](TUNING-PLACES-AND-TOPICS.md).

## A filter, in plain terms

A filter is a small description like "BC Politics from the last 24 hours within
50 km of Victoria". It's stored as text (JSON), so a **saved search** is just a
named filter you can rename or edit any time. The Reader shows the matching
articles as a list; the Globe shows the same articles as pins.

## The API in one table

| Address | Does |
|---|---|
| `POST /api/news/articles/search` | Send a filter, get matching articles (+ their places and topics) |
| `PATCH /api/news/articles/{id}` | Mark read / starred |
| `PUT /api/news/articles/{id}/topics` | Re-tag by hand |
| `POST /api/news/articles/mark-read` | Mark everything matching a filter as read |
| `GET /api/news/facets` | Unread counts and the country/province/city lists |
| `GET /api/news/places/search?q=` | Look up a place by name |
| `GET /api/news/feeds` | All feeds, with errors and article counts |
| `POST /api/news/feeds` | Add a feed (checked first) |
| `POST /api/news/feeds/import` | Import an OPML file |
| `GET /api/news/feeds.opml` | Download your feeds as OPML |
| `POST /api/news/fetch` | Fetch all feeds now |
| `GET /api/news/topics` | Topic list from topics.yaml |
| `GET/POST/PUT/DELETE /api/news/saved-searches` | Manage saved searches |
| `GET /api/news/health` | Quick "is it working?" summary |

Try them at http://127.0.0.1:8765/docs while the service is running.
