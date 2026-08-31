---
worktree: C:/dev/magna-carta-worktrees/claude/docket-read-errors-delay-o0la7q
area: transient-fault retries on the session and firm-database reads; hover preloading in the web shell
status: review
touches: apps/api-worker/src/session-context.ts, apps/api-worker/src/firm-database/firm-database-proxy.ts, apps/web/src/app.html, changelog.d/
---

Fixes the intermittent "The Docket Could Not Be Read" Error-ID failures (production logs show Better
Auth's "Failed to get session" APIError striking one request out of a screen's parallel burst) by
retrying the session read and firm-database read RPCs through transient faults, and shortens the
click-to-matter delay by enabling SvelteKit hover preloading in the app shell. Touches nothing
domain-specific; the one shared file is `app.html`.
