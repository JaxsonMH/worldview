# Decisions log

Newest first. Each entry: what we chose, and why.

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
