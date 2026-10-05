#!/usr/bin/env bash
# Start everything: the news service (port 8765) and the globe app (port 4173).
# Press Ctrl+C once to stop both.
set -euo pipefail
cd "$(dirname "$0")"

if command -v brew >/dev/null 2>&1 && brew list node@24 >/dev/null 2>&1; then
  export PATH="$(brew --prefix node@24)/bin:$PATH"
fi

if [ ! -f news/data/gazetteer.sqlite3 ]; then
  echo "First run: building the place list (downloads ~20 MB from GeoNames, about a minute)..."
  (cd news && uv run python -m worldview_news gazetteer)
fi

trap 'kill 0' EXIT INT TERM

echo "Starting news service on http://127.0.0.1:8765  (API docs: /docs)"
(cd news && uv run python -m worldview_news serve) &

echo "Starting globe app on http://localhost:4173"
npm run dev &

wait
