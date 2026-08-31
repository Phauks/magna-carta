---
worktree: C:/dev/magna-carta-worktrees/claude/docket-read-errors-delay-o0la7q
area: transient-fault retries and request-latency work on the session/firm front of every API request
status: review
touches: apps/api-worker/src/session-context.ts, apps/api-worker/src/auth.ts, apps/api-worker/src/chokepoint/ports.ts, apps/api-worker/src/firm-database/firm-database-proxy.ts, apps/web/src/app.html, changelog.d/, docs/decisions/pending/
---

Fixes the intermittent "The Docket Could Not Be Read" Error-ID failures (production logs show Better
Auth's "Failed to get session" APIError striking one request out of a screen's parallel burst) by
retrying the session read and firm-database read RPCs through transient faults, and attacks the
per-request latency at its measured source: the session rides Better Auth's cookie cache for five
minutes at a time and the firm row a per-isolate one-minute cache (pending decision
`a-session-is-believed-for-five-minutes-and-a-firm-row-for-one`), with hover preloading in the web
shell. Touches the chokepoint's session/firm resolution — coordinate before reworking those ports.
