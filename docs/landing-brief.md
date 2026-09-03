# Downstrike landing page — design brief

You're designing a landing page for **Downstrike**, a real-time lightning storm watcher.
Read this whole brief before designing. The product's code lives in this repo
(`~/Claude/lightning`) — study `index.html`, `styles.css`, and `info.html` before
inventing anything; the app itself is the design system.

## The product, in one breath

A free, dark, hyper-local lightning map centered on your home. Strikes from the
Blitzortung.org volunteer radio network appear seconds after they flash, then cool from
white to ember-red as they age. Every strike emits a ring expanding at the real speed of
sound — when the ring crosses your house, that's the moment you hear the rumble. A big
glowing STORM button flies you to the most active storm on Earth. The iOS app adds
official National Weather Service storm-warning push notifications (US) and a
minute-by-minute rain nowcast. No accounts, no tracking beyond a cookieless visit
counter, free forever.

Created by **Leo and Noah Zimmerman** (a father–son project), with help from Claude.
That story is part of the charm — use it, don't bury it.

## Page goal

One page that makes someone say "I want to watch a storm on this." Two calls to action:

1. **Primary — iPhone**: TestFlight join link `https://testflight.apple.com/join/aU1kg1QK`
2. **Secondary — everyone else**: open the web app `https://noah-zim.github.io/downstrike/`

No email capture, no pricing (it's free and must stay free — the lightning data is
licensed non-commercial), no fake testimonials, no invented stats.

## Voice

Kid-friendly, short, precise. Advanced-middle-school reading level with real physics kept
intact. Examples of the house voice (from `info.html` — reuse freely):

- "Nobody points a camera at the sky — the network *hears* every bolt and finds it with a stopwatch."
- "It's GPS in reverse: many receivers timing one flash to find *it*."
- "When a ring crosses your house, that's the exact moment you'd hear the rumble."
- "A storm paints its own trail: white at the front, embers behind."

Nobody wants to read that much — cut until the hierarchy is unmissable.

## Design system (lift exact values from `styles.css`)

- Ground `#0a0c10` · panels `rgba(13,16,22,0.82)` with 1px `rgba(255,213,79,0.14)` borders
- Text `#e8eaf0` · muted `#8a93a5` · amber accent `#ffd54f` (hot: `#ffab00`) · danger `#ff5252`
- Rain/thunder blue accents: `#6ea8fe`, `rgba(180,210,255,…)`
- Radii 10–12px, panel blur, system font stack (`-apple-system, …`), tabular numerals
- Icons: stroke SVGs, 20px grid, stroke-width 1.6, round caps — never emoji as icons
- The bolt logo path (use verbatim):
  `<svg viewBox="0 0 20 20" fill="#ffd54f"><path d="M11.2 2L4.6 11h4.2l-1.4 7L14.4 8.6h-4.1L11.2 2z"/></svg>`
- App icon: glowing bolt over faint distance rings — regenerate any size from
  `~/Claude/downstrike-ios/scripts/make-icon.swift`

The page must feel like the app: dark storm-chaser, amber lightning, generous darkness.
Not a generic SaaS page wearing a dark theme.

## What to showcase (in rough order of magic)

1. **The live map** — strongest possible hero: the real app embedded in an `<iframe>`
   (same-origin, works) or a phone-framed screen capture. The app IS the demo.
2. **Thunder rings** — the speed-of-sound idea is the single most explainable hook.
3. **The STORM button** — "no storm near you? Fly to the biggest one on Earth."
4. **Strike aging** — white → amber → ember color ramp (swatches exist in `info.html`).
5. **Distance-true thunder sound** — close cracks, far rumbles.
6. iOS extras: NWS warning pushes (US-only — say so honestly), next-hour rain strip.

Screenshots: capture from the live site (desktop + 390px) or the iOS simulator. During
active weather the map sells itself; the STORM button guarantees you can capture a live
storm any time.

## Required attributions (small, in the footer)

Lightning data: Blitzortung.org volunteers · Map: © CARTO, © OpenStreetMap contributors ·
Wind: Open-Meteo · Radar: RainViewer · Nowcast:  Weather (link
weatherkit.apple.com/legal-attribution.html) · Warnings: National Weather Service.
Credit line: "Designed and created by Leo and Noah Zimmerman, with help from Claude."

## Technical constraints

- Pure static HTML/CSS/JS, no build step, no frameworks — matches the repo.
- Lives in this repo, deployed via GitHub Pages (`git push` = live in ~1 min).
- The app owns the root URL (`index.html`). Put the landing page at `landing.html`
  first; whether it later swaps to the root (app moves to `/app/`) is Noah's call —
  ask, don't decide.
- Responsive: check 390px before presenting. No fake iOS status bars in mockups.
- GoatCounter analytics snippet may be copied from `index.html` onto the page.

## Don'ts

- Don't imply payment, ads, accounts, or a company — it's two people and a volunteer
  lightning network.
- Don't overpromise alerts ("stay safe in any storm" — no; they're official NWS
  warnings, US-only, and the map is for fun/education, not life-safety).
- Don't restyle the app's palette or invent new brand colors.
- Don't pad with filler sections; a short page that lands one idea beats a long scroll.

## Reference material

- Live app: https://noah-zim.github.io/downstrike/ · info page: `/info.html`
- UI mockup canvas (design history): https://claude.ai/code/artifact/331ffd49-afb1-49b5-b2a2-3749e5b5ef5d
- Repos: `noah-zim/downstrike` (this one, public), `noah-zim/downstrike-ios` (private shell)
