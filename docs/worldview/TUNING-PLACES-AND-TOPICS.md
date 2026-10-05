# When a pin or topic is wrong

Everything below is a settings file in `config/worldview/`. After any edit, run

```
make reprocess
```

which redoes places and topics for every article (takes well under a minute;
topics you set by hand in the Reader are kept).

## A pin is in the wrong place

Hover the place chip in the Reader preview: it shows the word that was matched
and how confident Worldview was.

| What happened | Fix | File |
|---|---|---|
| A nickname or landmark isn't understood ("the Legislature", "UVic") | Add an alias with its own coordinates, or pointing at a GeoNames id | `place-aliases.yaml` |
| A name keeps meaning the wrong place ("Victoria" → Australia) | Add an alias for the right one; `only_when_home: CA` limits it to Canadian feeds | `place-aliases.yaml` |
| A person or thing becomes a town ("Carney" → Maryland) | Add it to `never_places` | `geoparser.yaml` |
| An everyday word becomes a place ("Hope", "Mission") | Add it to `ignore_words` | `geoparser.yaml` |
| Too many weak guesses shown / good ones hidden | Change `min_confidence` (0.6 by default) | `geoparser.yaml` |
| Street-level pins are unreliable | Set `street_level: false` | `geoparser.yaml` |

GeoNames ids: search https://www.geonames.org, the number is in the page address.

## A topic is wrong

| What happened | Fix | File |
|---|---|---|
| One article | Click **Edit** next to its topics in the Reader | — |
| A whole feed | Change its default topic in **Manage feeds** (or `category=` in `feeds.opml`), then `make reprocess` to re-label its older articles too. | `feeds.opml` |
| A word should (or shouldn't) trigger a topic | Edit that topic's `keywords` | `topics.yaml` |
| A keyword fires on the wrong kind of story | Add `only_with_topics` to that topic (see Canadian Politics) | `topics.yaml` |
| You want a new subject (e.g. Education) | Add a topic with a name, colour and keywords | `topics.yaml` |
| "Local" area is too big/small | Edit the `within_box` rectangle | `topics.yaml` |

Keywords match whole words, ignoring capitals. One in the headline is enough;
in the summary it takes two different ones.

**How topics fit together:** each feed gives a broad topic (CTV → Canada,
BBC → World), and keywords add subjects on top (Crime & Justice,
Sports, Health, World Politics…). So a CTV robbery story shows as *Canada* + *Crime & Justice*,
and a BBC story on Brazil's election as *World* + *World Politics*,
and clicking either topic in the sidebar finds it.
