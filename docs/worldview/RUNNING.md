# Running Worldview

## Start / stop

```
./start.sh        # starts both halves; leave the Terminal window open
```
Press **Ctrl+C** in that window to stop both.

- **Globe: http://localhost:4173** (Worldview's home page)
- **Reader: http://localhost:4173/reader.html** (or the Reader tab)
- Classic God's Eye View interface: http://localhost:4173/index.html
- News service: http://127.0.0.1:8765 (interactive API page: http://127.0.0.1:8765/docs)

The very first start also builds the place list (downloads ~20 MB, about a minute)
and then finds places for every article, so pins appear a minute or two after
the first articles.

The news service checks every feed every 10 minutes while it runs.
Change that with `WORLDVIEW_FETCH_MINUTES=5 ./start.sh`.

## Handy commands (run from the `worldview` folder)

| Command | What it does |
|---|---|
| `make fetch` | Fetch all feeds once, right now, and show how many new articles each gave |
| `make reprocess` | Redo places and topics for every article, after you edit `topics.yaml`, `geoparser.yaml` or `place-aliases.yaml` (your manual topic edits are kept) |
| `make spot-check` | Print 50 random local/Canadian articles with their pins, to check by eye |
| `make verify-feeds` | Check every starter feed URL still works (doesn't save anything) |
| `make test` | Run the automated tests |
| `npm run doctor` | Globe app self-check |

## Updating

```
git pull
npm ci
(cd news && uv sync)
```

## Where your data lives

Everything the news service saves is in one file:
`news/data/worldview.sqlite3`. Back it up by copying it while the app is stopped.
Deleting it starts fresh (feeds are re-imported from `config/worldview/feeds.opml`).

## Common problems

| Symptom | Fix |
|---|---|
| `node: command not found` or "unsupported Node" | Run `./scripts/worldview/setup-mac.sh` again, then open a new Terminal window. |
| "Address already in use" | Worldview is already running in another Terminal window. Close it (Ctrl+C) first. |
| A feed shows errors | Run `make verify-feeds`. If its URL changed, update it in `config/worldview/feeds.opml` (see ADDING-A-FEED.md). |
| Globe is blank/white | Check your internet connection; the map imagery is downloaded live. |
| Reader says "News service offline" | The Python half isn't running. Stop and run `./start.sh` again and read the first error it prints. |
| No pins on anything | The place list is missing: `cd news && uv run python -m worldview_news gazetteer`, then `make reprocess`. |

## Reader keyboard shortcuts

`j` / `k` next / previous article · `s` star · `m` read/unread · `o` open the original.
