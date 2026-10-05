# Adding (or removing) a feed

**Easiest:** in the Reader, click **Manage feeds**, paste the address, pick a
folder and topic, and press **Add feed**. Worldview checks it's a working feed,
adds it, fetches it straight away, and saves it to `feeds.opml`. The same page
turns feeds on/off, imports OPML from another reader, and exports yours.

The rest of this page is the do-it-by-hand way.

Feeds are listed in **`config/worldview/feeds.opml`** — a standard file every
RSS reader understands, so you can also import/export it from other apps.

## 1. Find the feed address

Most news sites have one; try the site's address followed by `/feed`, `/rss`,
or `/rss.xml`, or search "<site name> RSS". Then check it:

```
cd news
uv run python -c "from worldview_news.feedcheck import check_feed, make_client; print(check_feed('PASTE-URL-HERE', make_client()))"
```
`ok=True` means it works.

## 2. Add it to feeds.opml

Copy an existing line inside the right folder and change the name, URL and topic:
```xml
<outline type="rss" text="CHEK News" title="CHEK News"
         xmlUrl="https://www.cheknews.ca/feed/" category="Local" />
```
`category` is the feed's default topic; it must match a name in `config/worldview/topics.yaml`.

## 3. Load it

Just restart Worldview (`./start.sh`) — it re-reads `feeds.opml` every time it
starts. Existing feeds are updated, never duplicated. (To load without
restarting: `cd news && uv run python -m worldview_news import-opml`.)

**Site has no RSS but runs WordPress?** Use its article list instead:
`https://SITE/wp-json/wp/v2/posts` — Worldview recognises these automatically.

## Removing a feed

Set `enabled="false"` on its line and re-run the import. Its old articles stay.
