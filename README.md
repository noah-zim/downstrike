# ⚡ Downstrike

A lightning-first, hyper-local storm watcher — named for the meteorologist's term for a
cloud-to-ground bolt. Dark storm-chaser map centered on your
home; real-time strikes flash white and cool to ember-red as they age; thunder rings
expand from each strike at the speed of sound — when a ring crosses your house is when
you hear the rumble. An amber glow on the 50 km ring shows which side the storm is
approaching from.

## Run it

```
python3 serve.py
```

Then open http://localhost:8642 — no build step, no API keys, no accounts.

On first run, type your address; it's geocoded once via OpenStreetMap Nominatim and
stored only in your browser's localStorage. Click the ⌂ button any time to change it.

## What's on screen

- **Strikes** — live from the [Blitzortung.org](https://www.blitzortung.org) community
  network (free for personal use, ~5–15 s latency). Flash on arrival, fade
  white → amber → orange → dark red over 30 minutes.
- **Thunder rings** — expand at 343 m/s from strikes within 60 km of home.
- **Home rings** — dashed circles at 10 / 25 / 50 km, with an approach-glow arc on the
  50 km ring pointing toward recent activity.
- **HUD** — closest strike (rolling 60 min, distance + bearing), strikes/min within
  100 km, live wind at home (Open-Meteo, refreshed every 10 min).
- **WIND** — particle flow of the regional wind field (5×5 Open-Meteo grid, refreshed
  every 30 min).
- **RADAR** — RainViewer precipitation overlay, off by default. Free tiles top out at
  z7, so it's soft when zoomed way in.
- **ALERT** — slider sets the alarm distance (5–50 km). A strike inside it triggers the
  banner and synthesized, distance-modulated thunder (SOUND toggles it and plays a
  preview clap; browsers need one click on the page before audio can play).
- **⚡ STORM** — flies to the most active storm on Earth right now (last 10 min of the
  global feed, gridded into 1° cells), at home-view zoom so the rings read properly.
  Press again to cycle through the top storms; the one on screen is always skipped.
  ⌂ returns home (and opens address settings when you're already home).
- **ⓘ** — opens [info.html](info.html), a full explainer of the data sources, the
  visualization mechanics, and the thunder synthesis.

## Data sources (all free, no keys)

| What | Source |
|---|---|
| Lightning | Blitzortung.org WebSocket (ws1/ws7/ws8, LZW-compressed JSON) |
| Basemap | CARTO dark-matter vector style + OpenStreetMap data |
| Wind | Open-Meteo forecast API |
| Radar | RainViewer public tiles |
| Geocoding | OpenStreetMap Nominatim (once, at setup) |

Note: Blitzortung is community-run — detection quality in North America is good but a
strike can occasionally be missed or placed a km or two off. The feed layer
([src/lightning.js](src/lightning.js)) is isolated, so a commercial source (e.g.
Vaisala) could be swapped in later.

`test-ws.html` is a standalone feed diagnostic — open it if strikes ever stop flowing.

## Credits

Designed and created by **Leo and Noah Zimmerman**, with help from Claude.
