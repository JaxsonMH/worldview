# Setting up your Mac (Phase 0)

You do this once. It takes 10–20 minutes, mostly waiting for downloads.

## The short version

1. Open **Terminal** (press ⌘-Space, type "Terminal", press Return).
2. Install Apple's developer basics (includes git). Paste this, press Return,
   and click **Install** in the window that pops up (about 5–10 minutes):
   ```
   xcode-select --install
   ```
   If it says "already installed", that's fine; carry on.
3. Download Worldview into your home folder and go into it:
   ```
   cd ~
   git clone -b claude/claude-md-feed-setup-0qpu2i https://github.com/jaxsonmh/worldview.git
   cd worldview
   ```
4. Run the setup script (10–20 minutes, mostly downloads):
   ```
   ./scripts/worldview/setup-mac.sh
   ```
   - It asks for your **Mac login password** once (for Homebrew). Typing it
     shows nothing on screen; that's normal. Press Return after.
   - It may say "Press RETURN/ENTER to continue" — press Return.
   - It ends with **"Done!"**. If it stops with red error text instead,
     copy the last 20 lines and send them to Claude.
5. Start everything:
   ```
   ./start.sh
   ```
   Leave that window open. Open **http://localhost:4173/reader.html** in your
   browser for the Reader, or **http://localhost:4173** for the globe.
   The first start builds the place list and fetches all feeds, so give it a
   couple of minutes before articles and pins appear.
6. To stop: click the Terminal window and press **Ctrl+C**.
   Next time, just open Terminal and run `cd ~/worldview && ./start.sh`.

## What the setup script installs, and why

| Step | What it is | Why we need it |
|---|---|---|
| **Homebrew** | The standard "app store" for developer tools on a Mac. Free. | Installs everything below with one command each, and can update them later. |
| **git** | Keeps the full history of the code. | Lets us undo mistakes and pull in improvements from God's Eye View. |
| **Node.js 24** | Runs JavaScript outside the browser. | The globe app (God's Eye View) needs exactly version 24. |
| **uv + Python 3.12** | Python is the language of the news service; uv installs Python and its add-ons quickly and keeps them inside the project folder. | The best free tools for reading feeds and finding place names are in Python. |
| **npm ci** | Downloads the globe app's add-ons into `node_modules/`. | The app won't start without them. |
| **uv sync** | Downloads the news service's add-ons into `news/.venv/`. | Same, for the news side. |
| **Place list** | Downloads ~20 MB of place names from GeoNames into `news/data/`. | Lets Worldview put articles on the map without any online service. |
| **~/.zprofile** | Adds two lines to the settings file Terminal reads when it opens. | So new Terminal windows can find Homebrew and Node. |

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
