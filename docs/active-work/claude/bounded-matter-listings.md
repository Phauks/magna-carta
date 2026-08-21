---
worktree: C:/dev/magna-carta-worktrees/claude/bounded-matter-listings
area: the costs and time listings and the two screens over them, plus a shrink-only gate on unpaged list endpoints
status: building
touches: apps/worker/src/routes/costs.ts, apps/worker/src/routes/time-entries.ts, apps/web/src/lib/matters, apps/web/src/routes/(app)/matters/[id], tooling/, changelog.d
---

The cost and time listings read a matter's whole record with no LIMIT, against a pagination module
that documents itself as universal. Both now page over the platform's existing cursor, and their
screens gain a control that fetches the next page rather than a dead end.

An audit of the emitted contract found 47 array-returning GET endpoints with no `nextCursor`, of
which these two are the pair with screens. The rest are recorded as a shrink-only baseline so the
count cannot grow while the campaign works through them; nothing here claims the other 45 are safe.
