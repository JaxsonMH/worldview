#!/usr/bin/env bash
# Worldview — one-time setup for a Mac. Safe to run again; it skips what's already there.
# What each step does is explained in docs/worldview/SETUP-MAC.md.
set -euo pipefail
cd "$(dirname "$0")/../.."

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

say "1/6 Homebrew (the Mac's app installer for developer tools)"
if ! command -v brew >/dev/null 2>&1; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon Macs keep Homebrew in /opt/homebrew; Intel Macs in /usr/local.
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
else
  echo "already installed"
fi

say "2/6 git (version history for the code)"
command -v git >/dev/null 2>&1 && echo "already installed" || brew install git

say "3/6 Node.js 24 (runs the globe app)"
brew list node@24 >/dev/null 2>&1 || brew install node@24
NODE24="$(brew --prefix node@24)/bin"
export PATH="$NODE24:$PATH"
node --version

say "4/6 uv + Python 3.12 (runs the news service)"
command -v uv >/dev/null 2>&1 || brew install uv
uv python install 3.12

say "5/6 Globe app packages"
npm ci --no-audit --no-fund

say "6/6 News service packages + place list"
(cd news && uv sync && uv run python -m worldview_news gazetteer)

say "Done. Start everything with:  ./start.sh"
if ! grep -q 'node@24' "$HOME/.zprofile" 2>/dev/null; then
  echo
  echo "Tip: to make Node 24 the default in new Terminal windows, run once:"
  echo "  echo 'export PATH=\"$NODE24:\$PATH\"' >> ~/.zprofile"
fi
