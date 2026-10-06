# Adding, hiding or re-ordering globe layers

The globe's layer panel is set by **`config/worldview/layers.json`**. Edit it
with TextEdit (keep the quotes and commas exactly as they are), save, and
reload the globe page.

```json
{ "id": "earthquakes", "name": "Earthquakes (24h)", "about": "USGS, magnitude 2.5+" }
```

- **Hide a layer:** delete its line (mind the comma on the line before).
- **Rename it or move it to another group:** change `name`, or cut and paste
  the line into another group's `layers` list.
- **Start switched on:** add `"on": true`. (Once you've used the globe, it
  remembers your own on/off choices instead.)
- **Needs a key:** add `"needsKey": "Service name"` so the panel says so.

## Layers the engine has that we don't show

`id`s available from the globe engine but left out on purpose:

| id | Why it's left out |
|---|---|
| `alpr-cameras` | Licence-plate reader cameras: too close to tracking people (CLAUDE.md guardrails). |
| `military-awareness` | Background helper for the classic interface, not a map layer. |
| `local-adsb` | Needs a USB radio receiver plugged into the Mac. |
| `directions` | Route planner tied to the classic interface. |
| `bhote-koshi-2026`, `bhote-koshi-locator` | A one-off demo event. |

The **Classic view** (link at the bottom of the panel) still has all of them.

## Worldview's own sources (BC wildfires, alerts, GDELT…)

Some layers come from the news service rather than the globe engine. Their
lines in `layers.json` look like

```json
{ "id": "src:bc_wildfire", "source": "bc_wildfire", "style": "icon" }
```

and can be hidden, moved or switched on by default exactly like the others.
`style` is `icon` (emoji marker coloured by severity), `dots` (small dots,
used for power plants) or `aurora`.

## A brand-new data source (recipe)

1. Copy a small existing one, e.g. `news/worldview_news/sources/tsunami.py`,
   to a new file in the same folder. Change `id`, `name`, `icon`, `about`,
   `attribution`, `homepage` and how often it refreshes (`refresh_minutes`).
2. In its `fetch` function, download the data and turn each item into an
   event with `event(id=…, title=…, lat=…, lon=…, time=…, severity=0–3, url=…)`.
   Severity: 0 information, 1 minor, 2 moderate, 3 severe.
3. If the service needs a key, set `needs_key="SOME_KEY_NAME"` and
   `key_help` (see ADDING-A-KEY.md); it's read from `.env`.
4. Add the module name to the list in `sources/__init__.py` (`_all_sources`).
5. Add a line to `config/worldview/layers.json` as above.
6. Restart (`./start.sh`), then run `make health`: the new source should
   show ✅ with a count.

Rules that always apply: only events, places and infrastructure, never
people; respect each service's terms and rate limits; always keep the
source's name and a link (the card shows them).
