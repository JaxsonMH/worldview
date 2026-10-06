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

## A brand-new data source

New layers (GDELT, disaster alerts, BC Wildfire…) are Phase 2/3 work: they
need a small piece of code that fetches the data, plus a line in
`layers.json`. Ask Claude; this file will gain a step-by-step recipe once the
first one is built.
