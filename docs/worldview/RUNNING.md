# Running Worldview

## Start / stop

```
./start.sh        # starts both halves; leave the Terminal window open
```
Press **Ctrl+C** in that window to stop both.

- Globe app: http://localhost:4173
- News service: http://127.0.0.1:8765 (interactive API page: http://127.0.0.1:8765/docs)

The news service checks every feed every 10 minutes while it runs.
Change that with `WORLDVIEW_FETCH_MINUTES=5 ./start.sh`.

## Handy commands (run from the `worldview` folder)

| Command | What it does |
|---|---|
| `make fetch` | Fetch all feeds once, right now, and show how many new articles each gave |
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
