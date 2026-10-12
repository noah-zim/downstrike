# Downstrike promo

Films real storms on the real Downstrike map and posts them on X.

Every two hours a GitHub Action listens to the live Blitzortung feed, picks the most newsworthy storm on Earth, films 15 seconds of it in the app, and posts it to the Downstrike X account. It stops and asks you first when people under the storm may be in danger.

## How a clip is made

1. **Listen.** Headless Chromium opens `app/?broadcast` (UI hidden, sound off) and collects 12 minutes of strikes, so storms already have their white-to-ember trails.
2. **Pick.** `pick.mjs` scores each live storm: strikes in the last 10 minutes, times how many people live under it (`cities.mjs`), with a boost for US and Canadian cities. A place filmed in the last 12 hours is skipped. At most 2 clips a day. On a quiet day it still makes one clip of the biggest storm anywhere.
3. **Film.** The page clock is frozen and stepped one frame at a time, one screenshot per frame, so the video is smooth on any machine. 1080×1920, 30 fps, H.264.
4. **Sound.** The app's own thunder synth, rendered offline. Each clap lands when that strike's sound ring reaches the crosshair, never before its flash.
5. **Words.** Claude writes the post from measured facts only, with the Blitzortung credit and "link in bio". Without an Anthropic key a template does it. Every post fits in 280 characters and carries no links or domain names: X charges $0.20 for a post with a link and $0.015 without one.
6. **Post or ask.** `deliver.mjs` posts to X straight away, unless the National Weather Service has warnings out at the storm, posting fails, or auto-posting is off. Then it opens an issue on this repo that @-mentions you, with the clip, the cover frame and the text.

The video credits Blitzortung, CARTO and OpenStreetMap. Each run holds one feed connection for about 13 minutes and hangs up once it has the clip. No raw strike data is published.

## Setup

Add four repo secrets (Settings → Secrets and variables → Actions) from the X developer console, for the Downstrike X account. These are the same kind of keys most X bots use.

| Secret | Where it is in the X developer console |
|---|---|
| `X_API_KEY` | Keys and tokens → Consumer keys → API Key |
| `X_API_SECRET` | the API Key Secret next to it |
| `X_ACCESS_TOKEN` | Authentication tokens → Access Token, generated while signed in as the Downstrike account, with **Read and write** permission |
| `X_ACCESS_SECRET` | the Access Token Secret next to it |

Optional:

| Name | Kind | What |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret | Claude writes the posts instead of the template. About a cent each. |
| `PROMO_AUTOPOST` | variable | `false` sends every clip to you for approval first |
| `PROMO_ENABLED` | variable | `false` pauses filming entirely |

The X app needs pay-per-use credits loaded. Two posts a day costs about a dollar a month.

If the access token was made before the app had write permission, regenerate it. Old tokens keep their old read-only permission.

## When it asks you first

The issue shows the clip, the cover and the text. Reply on the issue:

- `/post` posts it on X now.
- `/post anyway` posts a clip older than 6 hours.
- `/skip` deletes the clip and its release.
- `/caption New text…` replaces the text. You can also edit the text block in the issue.

Only your comments do anything. Each issue can post at most once.

## Tuning

All in `config.json`.

| Key | Default | Meaning |
|---|---|---|
| `clipSeconds` | 15 | Clip length |
| `warmupMinutes` | 12 | How long trails build before filming |
| `minScore` | 600 | Bar a storm must clear. Each run logs every storm's score. |
| `maxClipsPerDay` | 2 | Daily cap |
| `cooldownHours`, `cooldownKm` | 12, 250 | Don't film the same place twice in a row |
| `regionBoost` | US 1.6, CA 1.3 | Lean toward your likely audience |
| `ringRadiusPx` | 175 | Size of the 50 km ring on screen; sets the zoom |
| `maxPostAgeHours` | 6 | When `/post` starts asking for `anyway` |
| `captionModel` | claude-sonnet-5-5 | Model for the post text |

## Run it yourself

```
cd promo
npm ci && npx playwright install chromium     # plus ffmpeg and the Inter font
node capture.mjs --out out                    # live feed, best storm
node capture.mjs --out out --at 29.76,-95.37  # a spot you choose
node capture.mjs --out out --fake-feed --warmup 0.5 --seconds 4   # offline test
npm test
```

## Files

- `capture.mjs` films a clip. `pick.mjs` and `cities.mjs` choose the storm. `overlay.mjs` is the branded frame. `sound.mjs` picks the thunder. `caption.mjs` writes the words.
- `deliver.mjs` posts or asks. `x.mjs` talks to X. `candidate.mjs` opens the approval issue, `issue.mjs` formats it, `approve.mjs` handles your replies.
- `fake-feed.mjs` stands in for the Blitzortung socket on offline runs.

The app side is small. `?broadcast` hides the UI and replays strikes on a fixed delay so a frozen clock can film them. `?at=lat,lon,zoom` opens the map on any spot and works as a share link.
