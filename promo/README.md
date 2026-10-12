# Downstrike promo

Films real storms on the real Downstrike map and posts them as Instagram Reels. Nothing posts until you say yes.

Every two hours a GitHub Action listens to the live Blitzortung feed, picks the most newsworthy storm on Earth, and films 15 seconds of it in the app. You get a GitHub issue on your phone with the clip, the cover frame, and a caption. Comment `/post` and it goes to Instagram. Comment `/skip` and it's gone.

## How a clip is made

1. **Listen.** Headless Chromium opens `app/?broadcast` (UI hidden, sound off) and collects 12 minutes of strikes, so storms already have their white-to-ember trails.
2. **Pick.** `pick.mjs` scores each live storm: strikes in the last 10 minutes, times how many people live under it (a metro list in `cities.mjs`), with a boost for US and Canadian cities. A place filmed in the last 12 hours is skipped. At most 2 clips a day. On a quiet day it still makes one clip of the biggest storm anywhere.
3. **Film.** The page clock is frozen and stepped one frame at a time, one screenshot per frame. The video is perfectly smooth even on a slow machine. 1080×1920, 30 fps, H.264.
4. **Sound.** The app's own thunder synth, rendered offline. Each clap lands at the moment that strike's sound ring reaches the crosshair, never before its flash. Close strikes crack, far ones roll.
5. **Words.** Claude writes the caption in the house voice from measured facts only, with the Blitzortung credit and "link in bio". No API key means a template does it. If the National Weather Service has a tornado, flash flood, or hurricane warning there, the issue warns you and the caption leads with safety.

The frame credits Blitzortung, CARTO, and OpenStreetMap. Each run uses one feed connection for about 13 minutes and hangs up as soon as it has the clip. No raw strike data is ever published.

## One-time setup

### 1. Push this

The patch adds workflow files, so your GitHub CLI token needs the `workflow` scope once:

```
gh auth refresh -h github.com -s workflow
git push
```

### 2. Make the Instagram account

Make it in your name. Instagram requires account holders to be 13 or older. Suggested handle: `@downstrike.app`.

- Settings → Account type and tools → **Switch to professional account** → **Business**. Category: App Page.
- Bio: "Live lightning map. Real strikes, seconds old. Free, no ads. Made by Leo and Noah." Link: `https://downstrike.app/?ref=instagram`. GoatCounter counts the `ref` as the referrer, so you can see what Instagram sends.

### 3. Connect it to Meta's API (recommended: Facebook login)

This path uploads the video straight from GitHub, and its token never expires.

1. Create a Facebook Page called Downstrike. In the Page's settings, link the Instagram account.
2. At [developers.facebook.com](https://developers.facebook.com/apps), create an app of type **Business** and add the **Instagram** product with **API setup with Facebook login**.
3. In the [Graph API Explorer](https://developers.facebook.com/tools/explorer/), pick your app, generate a **User** token with `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, and `business_management`.
4. In the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/), click **Extend Access Token** to get a long-lived user token.
5. In the Explorer, with that long-lived token, run `GET me/accounts`. Copy the Page's `access_token`. A Page token made from a long-lived user token shows **Expires: Never** in the debugger.
6. Run `GET <page-id>?fields=instagram_business_account`. That `id` is your Instagram user ID.

Your app can stay in development mode. You have a role on it, which is what lets it post to your own account.

**Simpler alternative (Instagram login, no Facebook Page):** in the app, choose **API setup with Instagram login**, add the account, and generate a token. Set the repo variable `IG_API` to `instagram`. Meta then fetches the video from the clip's public GitHub release, and the token lasts 60 days. Add `PROMO_PAT` (below) and the weekly check renews it for you.

### 4. Add secrets in GitHub

Repo → Settings → Secrets and variables → Actions.

| Name | Kind | What |
|---|---|---|
| `IG_USER_ID` | secret | Instagram user ID from step 3 |
| `IG_ACCESS_TOKEN` | secret | Page token (or Instagram token) from step 3 |
| `ANTHROPIC_API_KEY` | secret | Optional. Claude writes captions. About a cent each. |
| `PROMO_PAT` | secret | Optional, Instagram-login mode only. Fine-grained token for this repo with **Secrets: read and write**, so the token check can save the renewed token. |
| `IG_API` | variable | `facebook` (default) or `instagram` |
| `PROMO_ENABLED` | variable | Set to `false` to pause filming |

### 5. Try it

Actions → **promo · film a storm** → Run workflow. Tick **force** to get a clip even if no storm clears the bar, or type a `lat,lon` to film a spot you choose. About 25 minutes later the issue appears.

Make sure GitHub can push to your phone: GitHub app → Settings → Notifications → Participating on. The issue @-mentions you, so it counts as participating.

## Approving on your phone

On the issue:

- `/post` publishes it now.
- `/post anyway` publishes a clip older than 6 hours.
- `/skip` deletes the clip and its release.
- `/caption New text…` replaces the caption. You can also just edit the caption block in the issue.

Only your comments do anything. Anyone else's are ignored.

## Tuning

All in `config.json`.

| Key | Default | Meaning |
|---|---|---|
| `clipSeconds` | 15 | Clip length. Reels that loop do better short. |
| `warmupMinutes` | 12 | How long trails build before filming |
| `minScore` | 600 | Bar a storm must clear. Each run logs every storm's score, so read a few logs and adjust. |
| `maxClipsPerDay` | 2 | Daily cap on clips |
| `cooldownHours`, `cooldownKm` | 12, 250 | Don't film the same place twice in a row |
| `regionBoost` | US 1.6, CA 1.3 | Lean toward your likely audience |
| `ringRadiusPx` | 175 | Size of the 50 km ring on screen. Sets the zoom. |
| `maxPostAgeHours` | 6 | When `/post` starts asking for `anyway` |
| `captionModel` | claude-sonnet-5-5 | Caption model |

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

- `capture.mjs` films a clip. `pick.mjs` and `cities.mjs` choose the storm. `overlay.mjs` is the branded frame. `caption.mjs` writes the words.
- `candidate.mjs` opens the approval issue. `approve.mjs` handles your commands. `publish.mjs` talks to Meta. `token.mjs` is the weekly check.
- `fake-feed.mjs` is a stand-in for the Blitzortung socket for offline runs.

The app side is small. `?broadcast` hides the UI and replays strikes on a fixed delay so a frozen clock can film them. `?at=lat,lon,zoom` opens the map on any spot, which also works as a share link for people: `downstrike.app/?at=29.76,-95.37`.
