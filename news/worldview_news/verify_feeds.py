"""Check every feed in a list file and print a plain-English report.

Run:  uv run python -m worldview_news.verify_feeds [../config/worldview/feed-candidates.yaml]

Each entry needs `name` and `url` (or `urls`, a list of alternatives to try in
order). Entries without a URL are listed as "no feed".
"""

from __future__ import annotations

import sys

import yaml

from .feedcheck import check_feed, make_client


def main(path: str) -> int:
    with open(path) as fh:
        candidates = yaml.safe_load(fh)
    failures = 0
    with make_client() as client:
        for cand in candidates:
            urls = cand.get("urls") or ([cand["url"]] if cand.get("url") else [])
            if not urls or cand.get("status") == "adapter":
                print(f"SKIP\t{cand['name']}\t{cand.get('note', 'no RSS feed')}")
                continue
            attempts = []
            for url in urls:
                res = check_feed(url, client)
                attempts.append(res)
                if res.ok and not res.stale:
                    break
            chosen = next((a for a in reversed(attempts) if a.ok), None)
            if chosen:
                age = f"{chosen.newest_age_hours:.1f}h ago" if chosen.newest_age_hours is not None else "no dates"
                flag = "STALE" if chosen.stale else "OK"
                print(f"{flag}\t{cand['name']}\t{chosen.items} items, newest {age}\t{chosen.url}")
            else:
                failures += 1
                why = "; ".join(f"{a.url} -> {a.problem}" for a in attempts)
                print(f"FAIL\t{cand['name']}\t{why}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "../config/worldview/feed-candidates.yaml"))
