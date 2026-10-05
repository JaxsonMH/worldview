# Adding (or removing) a feed

Feeds are listed in **`config/worldview/feeds.opml`** — a standard file every
RSS reader understands, so you can also import/export it from other apps.

> Status: the starter list is awaiting approval (see STARTER-FEEDS.md), so
> `feeds.opml` doesn't exist yet. Once approved, these steps apply.

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

```
cd news && uv run python -m worldview_news import-opml
```
Running this again is safe: existing feeds are updated, not duplicated.

## Removing a feed

Set `enabled="false"` on its line and re-run the import. Its old articles stay.
