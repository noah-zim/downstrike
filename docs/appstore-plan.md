# Downstrike — App Store launch: audit + minimum plan

Written 2026-09-05. Two parts: (1) the pre-submission audit, (2) the minimum
necessary path to a live App Store listing, including risks we haven't dealt
with yet. Repos: `~/Claude/lightning` (web, public) and `~/Claude/downstrike-ios`
(shell, private). Current state: build 7 on TestFlight incl. public link;
landing page + `downstrike.app` domain live; app content bundled from
`lightning/app/`.

---

## Part 1 — The audit

### A. Licensing & data-source audit (existential — do first)

| Check | What to verify | Status guess |
|---|---|---|
| Blitzortung terms | Free app, no ads/IAP anywhere in listing or code; alerts NEVER sourced from Blitzortung (NWS only); listing copy avoids "warning system" framing for the map | Believed clean — verify listing copy when written |
| CARTO/OSM attribution | Attribution control visible in the shipped app bundle (not clipped by safe-area/controls) | Verify on device |
| Apple Weather attribution | Mark + legal link adjacent to nowcast; renders in app | Verify |
| Open-Meteo (CC-BY) & RainViewer | Named on info page in the bundle | Verify |
| Nominatim policy | One-time geocode OK; requests from the app's custom scheme may send no Referer/UA identifying us — add `email=` param to search/reverse calls (small fix) | Small fix |
| "Downstrike" name | Quick trademark/App Store search for conflicts (ASC accepted the name, which clears Apple's uniqueness check only) | 15 min |

### B. Privacy audit

1. **Privacy policy URL is required and doesn't exist yet.** Create
   `downstrike.app/privacy.html` from info.html §05 + the alerts paragraph +
   contact email. *Blocking; ~30 min.*
2. **App Privacy labels**: enumerate every network destination in the app
   bundle (Blitzortung WS, CARTO, Open-Meteo, RainViewer, Nominatim, Supabase
   register, WeatherKit) and map to labels. Expected declaration: Coarse
   Location + Device ID (push token), both **App Functionality, Not Linked to
   Identity, No Tracking**. Confirm GoatCounter is truly absent from the bundle
   (sync-web strips it — re-verify) so no Analytics label is needed.
3. **Deletion gap**: turning alerts OFF sets `enabled=false` but leaves the
   token+location row in Supabase. For an honest policy, make disable **delete**
   the row (tiny change in `register/index.ts` + shell). *Small fix, do it.*
4. Kids: 4+ rating, but NOT the Kids Category (avoids extra rules). No ads, no
   tracking — nothing else triggered.

### C. App Review readiness

- **Guideline 4.2 (repackaged website)** — the main rejection risk. Mitigations
  to state in Review Notes: native push (NWS), WeatherKit nowcast, CoreLocation,
  fully bundled/offline-launching content, notification handling. Backup plan if
  rejected: add a native settings screen + widget, resubmit or appeal.
- **Reviewer experience**: they review from an office with no storm. Review
  Notes must lead with: "Tap the big glowing bolt — it flies to the most active
  storm on Earth right now; works under clear skies." Test every
  permission-denied path (location denied → address search; notifications
  denied → app fully works) — reviewers deny things.
- **Safety framing**: add one line to info + listing: for education/fun, not a
  substitute for official emergency guidance. Alerts relay official NWS
  warnings, US only — say so in the description.
- Export compliance already answered in Info.plist ✓. No background modes ✓.
  Push is optional ✓. No beta/demo wording in the listing.

### D. Code audit (both repos + server)

Run as parallel review passes (the `/code-review` skill on each repo, plus
targeted checks):

1. **Web app (`lightning/app/`)** — priority on the newest, least-tested code:
   the landing/`/app/` restructure and `?storm` embed mode; then: fetch error
   handling, WS reconnect backoff (cap it — don't hammer Blitzortung servers),
   strike-array/canvas performance on older phones, localStorage try/catch,
   timer/listener leaks, dead code from the Option B refactor (old `.ctl`
   styles, unused imports).
2. **iOS shell**: `BundleSchemeHandler` — **reject paths containing `..`**
   (path-traversal hygiene; content is local but fix it anyway); location
   callback lifecycle; bridge message validation; WeatherKit failure paths;
   register call has no retry (acceptable — next foreground re-registers; just
   confirm).
3. **Server (`supabase/functions/`)**: `register` is public and unauthenticated
   — acceptable for v1 but add a cheap guard (cap devices query with a LIMIT,
   validate more strictly); confirm `notified` dedup + dead-token cleanup logic;
   confirm secrets appear nowhere client-side (`grep` the built bundle).
4. **Secrets scan**: `.env` never committed in either repo's history; no keys in
   the public repo, workflows, or the web bundle.
5. **Accessibility quick pass**: aria-labels on icon buttons, contrast of muted
   text — cheap wins, not blockers.

### E. Device test matrix (one simulator session + real phones)

Fresh install → setup (address AND location paths) · permission-denied paths ·
alerts on/off → Supabase row appears/deletes · background → foreground
re-registration · sheet/HUD/toasts · STORM tour · radar/wind toggles · info
page links open in Safari · iPhone SE-width layout · a real push via
`push-test` on each phone.

---

## Part 2 — Risks & costs we haven't fully dealt with

| Risk | Reality | Plan |
|---|---|---|
| **Supabase free-tier pause** kills alerts silently | pg_cron traffic may not count as "activity"; keep-alive workflow is still shelved (gh token lacks `workflow` scope) | **Minimum-plan item**: Noah runs `gh auth refresh -h github.com -s workflow` once; restore `docs/keepalive.yml.example` → pings every 15 min AND fails visibly if the watcher dies (our only monitoring) |
| Open-Meteo free tier (≈10K calls/day) | First thing to break with popularity (~100+ concurrent users): wind readout/particles start failing | Degrades gracefully already; post-launch: lengthen refresh intervals via a web update. Accept for launch |
| CARTO free basemaps at scale | Fair-use; could be throttled if the app takes off | Drop-in fallback known (OpenFreeMap, ~1-line style swap + attribution). Accept for launch |
| Blitzortung WS protocol change or server strain | Has changed before; bundled app needs a store update to fix | Accept; we can ship fast. Be a good citizen: verify reconnect backoff in audit. `test-ws.html` remains the diagnostic |
| Bundled-web release friction | Web fixes reach app users only via App Store updates (~1-day review each) | Accept for v1; note as future work (remote content or update-check) |
| Junk registrations (public register endpoint) | Junk rows → wasted NWS queries; dead tokens self-clean via APNs 410 | LIMIT cap + validation in audit; revisit only if abused |
| Costs | Apple $99/yr (paid) · Supabase $0 · APNs $0 · NWS $0 · Pages/domain (already owned) | **$0 marginal at launch**; first real cost would be Supabase Pro (~$25/mo) or Open-Meteo paid — both only with real traction |
| Crash/quality visibility | No crash SDK (deliberately — privacy) | Xcode Organizer / ASC crash reports are enough for v1 |
| Old lingering test data | Simulator canary device row registered at DC | Leave (useful canary) or delete during audit |

---

## Part 3 — Minimum necessary launch plan (sequenced)

**Session 1 — fixes + audit (most of it automatable):**
1. Small fixes from above: privacy.html · disable-deletes-row · `..` guard in
   scheme handler · Nominatim `email=` param · safety line on info page.
2. Run the code-review passes (web / shell / server) + secrets scan; fix what's
   real, skip nits.
3. Device test matrix in simulator; push-test on Noah's phone.
4. Noah (2 min): `gh auth refresh -h github.com -s workflow`; then restore the
   keep-alive/monitor workflow.

**Session 2 — store metadata + submission:**
5. Screenshots: 6.9" and 6.5" simulator sets — storm-active via STORM button
   (the map sells itself), one shot each of alerts sheet + nowcast.
6. Listing (house voice, kid-friendly): name **Downstrike**, subtitle (e.g.
   "Live lightning, real thunder"), description, keywords, category **Weather**,
   age 4+, support URL + marketing URL = downstrike.app, privacy policy URL.
   Most of this is settable via the ASC API; screenshots may be a manual upload.
7. App Privacy questionnaire in ASC (labels per audit B2). Age rating
   questionnaire.
8. Ship build 8 (with audit fixes) via ship.sh → select build in the version →
   **Submit for Review** with the reviewer notes from C.
9. Review turnaround: typically 1–3 days. If 4.2 rejection: respond with the
   native-feature list; escalate to the native-settings/widget backup plan only
   if actually needed.

**Deliberately NOT in the minimum plan** (fine later): iPad layout, widgets,
localization, App Store search ads, remote web-content updates, rating prompts,
Android anything.

**Noah-only steps** (everything else is scriptable from a session): the
`gh auth refresh` above; final "Submit for Review" click if we prefer a human on
the trigger; answering the ASC privacy questionnaire confirmation if the API
path balks.
