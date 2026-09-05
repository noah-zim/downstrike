# Downstrike analytics — the "medium" design (post-approval milestone)

Decided 2026-09-05. Build this as the first project after App Store approval.
Constraint that shapes everything: the published App Privacy label declares no
analytics and the app's own copy says "no analytics at all" — this design keeps
both honest by counting **taps, not people**.

## Already flowing (the "small" tier — just read it)

- **Apple App Analytics** (ASC → Analytics): downloads, sessions, active
  devices, retention, crashes. Opt-in users only (~25–35% sample), ~1 day lag.
- **GoatCounter**: website traffic + referrers (the funnel's top half).
- **Supabase `devices` table**: exact count of alert-enabled users.

## The medium design: identity-free counters + ephemeral sessions

**Server** — one new edge function `ping` on the existing Supabase project
(uezzcowcehpgiaqmsvzo), plus one table:

```sql
create table metrics (
  day date not null,
  event text not null,
  count bigint not null default 0,
  primary key (day, event)
);
```

`ping` accepts `{ events: [name, ...] }`, validates names against a short
allowlist, and increments today's counters (upsert). No device ID, no IP
stored, no per-user rows — the server literally cannot say anything about an
individual. Rate-limit by capping increments per request.

**Events (allowlist, keep it short):**
`session_start`, `home_set_location`, `home_set_address`, `storm_button`,
`alerts_on`, `alerts_off`, `radar_on`, `wind_off`, `sound_off`, `info_opened`,
`session_end` (with coarse duration bucket: `s_lt1m`, `s_1_5m`, `s_5_20m`,
`s_gt20m`).

**Ephemeral session detail** — generate a random UUID at app launch, held in
memory only (never localStorage). Batch that session's events and send them
with the UUID so the server can also record session *shapes* (e.g.
`sessions_with_storm_button`) before discarding the UUID. Nothing persists
across launches; there is no way to recognize a returning user — by design.

**Client** — small `src/metrics.js` in the web app: queue events, flush on
`visibilitychange`/`pagehide` via `navigator.sendBeacon`, silent no-op on any
failure. Fire from existing handlers (one line each). Applies to BOTH website
and app (same code, one `source: web|app` dimension).

**Dashboard** — start with a query script (`scripts/metrics.ts`, reuses the
asc-api token pattern against Supabase): daily sessions, feature usage %,
session-length mix, alerts adoption. A private HTML page later only if the
script gets tiresome.

**Honesty updates that ship in the same commit:**
- privacy.html: replace "The iOS app contains no analytics at all" with the
  counting-taps-not-people explanation (anonymous daily counters, no
  identifiers, sessions forgotten at close).
- app/info.html §05: same adjustment.
- App Privacy label: likely no change needed (nothing about a user is
  collected or retained), but re-read Apple's definition at build time and, if
  in doubt, add Usage Data → Product Interaction → not linked → no tracking.

**Effort:** ~half a session. **Cost:** $0 (rides the existing project).

## Explicitly deferred (the "large" tier)

Persistent anonymous IDs + SDK analytics (TelemetryDeck / PostHog) for
retention cohorts and funnels. Only if a concrete product question demands it;
it would change the privacy label and kill the "no analytics" brand claim.
Don't build speculatively.
