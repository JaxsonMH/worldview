#!/usr/bin/env bash
# Start everything: the news service (port 8765) and the globe app (port 4173).
# Press Ctrl+C once to stop both.
set -euo pipefail
cd "$(dirname "$0")"

# Find Homebrew and Node even if this Terminal window hasn't loaded them.
if ! command -v brew >/dev/null 2>&1; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$b" ] && eval "$("$b" shellenv)" && break
  done
fi
if command -v brew >/dev/null 2>&1 && brew list node@24 >/dev/null 2>&1; then
  export PATH="$(brew --prefix node@24)/bin:$PATH"
fi
for tool in uv npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Can't find '$tool'. Run the one-time setup first:  ./scripts/worldview/setup-mac.sh"
    exit 1
  fi
done

if [ ! -f news/data/gazetteer.sqlite3 ]; then
  echo "First run: building the place list (downloads ~20 MB from GeoNames, about a minute)..."
  (cd news && uv run python -m worldview_news gazetteer)
fi

trap 'kill 0' EXIT INT TERM

echo "Starting news service on http://127.0.0.1:8765  (API docs: /docs)"
(cd news && uv run python -m worldview_news serve) &

echo "Starting Worldview: globe at http://localhost:4173 , reader at http://localhost:4173/reader.html"
echo "(Ctrl+C to stop)"
npm run dev &

wait
