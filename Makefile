# Shortcuts. Run `make <name>` from the repo root. See docs/worldview/RUNNING.md.
.PHONY: setup dev test verify-feeds fetch reprocess spot-check health

setup:          ## one-time install of everything (Mac)
	./scripts/worldview/setup-mac.sh

dev:            ## start news service + globe app
	./start.sh

test:           ## run the news service + filter tests
	cd news && uv run pytest -q
	node --test src/worldview/*.test.mjs

verify-feeds:   ## check that every candidate feed URL still works
	cd news && uv run python -m worldview_news.verify_feeds

fetch:          ## fetch all feeds once, right now
	cd news && uv run python -m worldview_news fetch

reprocess:      ## redo places + topics for all articles (after editing config/worldview/*.yaml)
	cd news && uv run python -m worldview_news reprocess

spot-check:     ## print 50 random local/Canadian articles with their pins, to check by eye
	cd news && uv run python -m worldview_news.spotcheck

health:         ## check every feed, live source and the globe app, in plain English
	cd news && uv run python -m worldview_news.health; status=$$?; cd .. && npm run -s doctor; exit $$status
