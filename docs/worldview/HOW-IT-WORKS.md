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
| ↳ Feed fetcher | `news/worldview_news/fetcher.py` | Every 10 minutes, downloads each feed and saves new articles. Skips duplicates; fixes feeds that claim articles from the future. |
| ↳ Filters | `news/worldview_news/filters.py` | The one "which articles do you want?" description that both the Reader and the Globe use. |
| ↳ REST API | `news/worldview_news/api.py` | The web addresses (`/api/news/...`) the app calls to get articles, feeds, topics and saved searches. |
| ↳ Geoparser | *(next step)* | Finds place names in each article and turns them into map coordinates. |
| ↳ Topic tagger | *(started)* | Each article gets its feed's default topic today; keyword/place rules come next. |
| **Database** | `news/data/worldview.sqlite3` | One file holding feeds, articles, places, topics and saved searches. |
| **Settings** | `config/worldview/` | `feeds.opml` (your feeds), `topics.yaml` (your topics). Edit these, not code. |
| **Our docs** | `docs/worldview/` | These pages. |

Our code is kept in its own folders so improvements from the original God's
Eye View project can still be pulled in without clashes.

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
| `GET /api/news/feeds` | All feeds, with errors and article counts |
| `GET /api/news/feeds.opml` | Download your feeds as OPML |
| `POST /api/news/fetch` | Fetch all feeds now |
| `GET /api/news/topics` | Topic list from topics.yaml |
| `GET/POST/PUT/DELETE /api/news/saved-searches` | Manage saved searches |
| `GET /api/news/health` | Quick "is it working?" summary |

Try them at http://127.0.0.1:8765/docs while the service is running.
