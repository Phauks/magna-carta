---
branch: claude/case-calendar-design
worktree: C:/dev/magna-carta-worktrees/claude/case-calendar-design
area: Case calendar and matter timeline — design only (the backend event model, the deadline model, and the read API a calendar or timeline user interface consumes)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Design-only stream answering the owner's 2026-08-05 ask for "a calendar that allows users to see
what events have transpired in the litigation as well as in the events of the case." It writes two
specs, one decision fragment, and one changelog fragment, and touches nothing in `packages/` or
`apps/`. **No product code in this stream.**

What it settles: whether transpired events are read in place from the subsystems that already record
them or projected into one table; the first-class litigation-event and deadline models that exist
nowhere today; the time and time-zone model a hearing needs; and the bounded, keyset-paginated read
API. What it does not touch: court e-filing integration, rule-based deadline computation,
notification scheduling, external calendar synchronization, and the user interface.

**Overlap to watch.** The design names two schema additions a concurrent stream could collide with:
a `time_zone` column on `location` (the seam `timeZoneForLocation` in
`packages/document-assembly/src/resolve.ts` already reserves), and two indexes on shipped tables
(`audit_log`, `conflicts_check`). Nothing here writes them — they are named in the implementation
plan for the build slice that lands later.
