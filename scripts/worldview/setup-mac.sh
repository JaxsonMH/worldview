#!/usr/bin/env bash
# Worldview — one-time setup for a Mac. Safe to run again; it skips what's already there.
# What each step does is explained in docs/worldview/SETUP-MAC.md.
set -euo pipefail
cd "$(dirname "$0")/../.."

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

say "1/7 Homebrew (the Mac's app installer for developer tools)"
if ! command -v brew >/dev/null 2>&1; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$b" ] && eval "$("$b" shellenv)" && break
  done
fi
if ! command -v brew >/dev/null 2>&1; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple-chip Macs keep Homebrew in /opt/homebrew; Intel Macs in /usr/local.
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$b" ] && eval "$("$b" shellenv)" && break
  done
else
  echo "already installed"
fi

say "2/7 git (version history for the code)"
command -v git >/dev/null 2>&1 && echo "already installed" || brew install git

say "3/7 Node.js 24 (runs the globe app)"
# The globe app supports Node 24 or 26. Prefer Homebrew's node@24; fall back to
# its current "node" if node@24 isn't offered any more.
NODE_FORMULA=node@24
brew info node@24 >/dev/null 2>&1 || NODE_FORMULA=node
brew list "$NODE_FORMULA" >/dev/null 2>&1 || brew install "$NODE_FORMULA"
NODE_BIN="$(brew --prefix "$NODE_FORMULA")/bin"
export PATH="$NODE_BIN:$PATH"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
case "$NODE_MAJOR" in
  24|26) echo "Node $(node --version)" ;;
  *) echo "Node $(node --version) isn't supported (need 24 or 26). Please send this message to Claude."; exit 1 ;;
esac

say "4/7 uv + Python 3.12 (runs the news service)"
command -v uv >/dev/null 2>&1 || brew install uv
uv python install 3.12

say "5/7 Make these tools available in every new Terminal window"
# Homebrew and keg-only Node aren't on the PATH by default; add them to ~/.zprofile
# (the file the Mac's Terminal reads when it opens). Each line is added only once.
PROFILE="$HOME/.zprofile"
touch "$PROFILE"
add_line() { grep -qxF "$1" "$PROFILE" || echo "$1" >> "$PROFILE"; }
add_line '# Added by Worldview setup (Homebrew + Node.js)'
add_line "eval \"\$($(command -v brew) shellenv)\""
add_line "export PATH=\"$NODE_BIN:\$PATH\""
echo "updated $PROFILE"

say "6/7 Globe app packages"
npm ci --no-audit --no-fund

say "7/7 News service packages + place list"
(cd news && uv sync && uv run python -m worldview_news gazetteer)

say "Checking the globe app"
npm run -s doctor || true

say "Done! Start everything with:  ./start.sh"
echo "Then open http://localhost:4173 (globe) or http://localhost:4173/reader.html (reader)"
