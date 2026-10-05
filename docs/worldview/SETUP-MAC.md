# Setting up your Mac (Phase 0)

You do this once. It takes 10–20 minutes, mostly waiting for downloads.

## The short version

1. Open **Terminal** (press ⌘-Space, type "Terminal", press Return).
2. Get the code (skip if you already have the `worldview` folder):
   ```
   git clone https://github.com/jaxsonmh/worldview.git
   cd worldview
   ```
   If the Mac says git isn't installed, it will offer to install Apple's
   "Command Line Tools" — click **Install**, wait, then run the two lines again.
3. Run the setup script:
   ```
   ./scripts/worldview/setup-mac.sh
   ```
   It may ask for your Mac password (for Homebrew). Typing it shows nothing on
   screen — that's normal.
4. Start everything:
   ```
   ./start.sh
   ```
   Open http://localhost:4173 for the globe. The news API is at
   http://127.0.0.1:8765/docs.

## What the setup script installs, and why

| Step | What it is | Why we need it |
|---|---|---|
| **Homebrew** | The standard "app store" for developer tools on a Mac. Free. | Installs everything below with one command each, and can update them later. |
| **git** | Keeps the full history of the code. | Lets us undo mistakes and pull in improvements from God's Eye View. |
| **Node.js 24** | Runs JavaScript outside the browser. | The globe app (God's Eye View) needs exactly version 24. |
| **uv + Python 3.12** | Python is the language of the news service; uv installs Python and its add-ons quickly and keeps them inside the project folder. | The best free tools for reading feeds and finding place names are in Python. |
| **npm ci** | Downloads the globe app's add-ons into `node_modules/`. | The app won't start without them. |
| **uv sync** | Downloads the news service's add-ons into `news/.venv/`. | Same, for the news side. |

Nothing is installed system-wide except Homebrew and the tools above. Deleting
the `worldview` folder removes everything else.

## Checking it worked

```
npm run doctor     # globe app self-check: should end with "Ready."
make test          # news service tests: should say "passed"
```

## Mac details we still need (for later)

Open  → About This Mac and note the **Chip** (e.g. "Apple M2") and **Memory**
(e.g. "16 GB"). This decides whether the optional local AI helper is worth trying.
