# Starter feeds

Checked 2026-10-05 by actually downloading each one
(`make verify-feeds`; the list itself is `config/worldview/feed-candidates.yaml`).
**Approved 2026-10-05** (substitutes and extras included). General news feeds use the broad *Canada* topic; see DECISIONS.md. The live list is `config/worldview/feeds.opml`.

"Paywall" = headlines and summaries come through fine, but opening the full
article may need a subscription.

## Local (Greater Victoria / Vancouver Island)
| Feed | Status | Notes |
|---|---|---|
| Times Colonist — Local News | ✅ | Paywall (metered). Used the Local News feed: the main feed includes election pages dated weeks ahead. |
| CHEK News | ✅ | |
| Victoria News (Black Press) | ✅ | |
| CBC British Columbia | ✅ | |
| Capital Daily | ✅ | Posts every few days. |
| *Global News BC* | ➕ suggested | Extra BC coverage for the BC Politics topic. |
| *The Tyee* | ➕ suggested | Independent BC politics/policy. |

## Canada
| Feed | Status | Notes |
|---|---|---|
| CBC News — Top Stories | ✅ | |
| CBC News — Politics | ✅ | Overlaps Top Stories; duplicates are stored once. |
| CTV News | ✅ | Feed times are off by ~4 h (we correct the newest; see DECISIONS.md). |
| Globe and Mail — Canada | ✅ | Paywall. |
| Globe and Mail — Politics | ✅ | Paywall. |
| National Post — Canada | ✅ | Partial paywall. |
| The Canadian Press | ✅ | CP's own new site (thecanadianpressnews.ca). Rate-limits fast repeat requests; every 10 min is fine. |
| iPolitics | ✅ | Paywall. |

## World
| Feed | Status | Notes |
|---|---|---|
| Reuters | ❌ none | Reuters closed its public RSS in 2020. |
| AP News | ❌ none | No official RSS; site blocks feed requests. (GDELT in Phase 2 covers wire stories on the globe.) |
| *DW (Deutsche Welle) World* | 🔁 substitute | Wire-style international coverage. |
| *France 24* | 🔁 substitute | |
| *CBC World* | 🔁 substitute | Canadian angle on world news. |
| BBC World | ✅ | |
| Al Jazeera | ✅ | |
| The Guardian — World | ✅ | |
| NPR — World | ✅ | Chose World (1004) over the general News feed (mostly US domestic). |
| *NPR — Politics* | ➕ suggested | Fills the US Politics topic, which had no source. |

## Business
| Feed | Status | Notes |
|---|---|---|
| Financial Post | ✅ | Partial paywall. |
| BNN Bloomberg | ✅ | Same ~4 h time quirk as CTV. |
| CNBC — Top News | ✅ | CNBC's published feed address now returns "forbidden"; this is the server it redirects to. |

## Tech
| Feed | Status | Notes |
|---|---|---|
| Ars Technica | ✅ | |
| The Verge | ✅ | |
| Hacker News — front page | ✅ | Official feed. Links go to the story; HN discussion is a separate link. |

## Conflict / OSINT
| Feed | Status | Notes |
|---|---|---|
| Institute for the Study of War | ✅ via reader | Their 2025 redesign switched RSS off; we read their public WordPress article list instead (`news/worldview_news/wordpress.py`). |
| Bellingcat | ✅ | Posts every few days. |
| War on the Rocks | ✅ | |
| Defense News | ✅ | |
| The War Zone | ✅ | |

**Totals:** 25 of your 28 outlets work (27 feeds, since CBC and the Globe each get two). Reuters and AP have no feed → 3 substitutes offered. ISW needs a small custom reader. Plus 3 suggested extras. All approved = **34 feeds**.
