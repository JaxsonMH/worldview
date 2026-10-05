# Shortcuts. Run `make <name>` from the repo root. See docs/worldview/RUNNING.md.
.PHONY: setup dev test verify-feeds fetch

setup:          ## one-time install of everything (Mac)
	./scripts/worldview/setup-mac.sh

dev:            ## start news service + globe app
	./start.sh

test:           ## run the news service tests
	cd news && uv run pytest -q

verify-feeds:   ## check that every candidate feed URL still works
	cd news && uv run python -m worldview_news.verify_feeds

fetch:          ## fetch all feeds once, right now
	cd news && uv run python -m worldview_news fetch
