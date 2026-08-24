---
worktree: claude/matter-screens-handover
area: docs
status: in-review
touches:
  - docs/handover/
  - changelog.d/
---

# The handover document

Owner-directed: a handover a fresh instance can continue from, covering what was learned about UI,
what it takes to get login created, and the brief for the other matter screens.

Written from what is verifiably in the repository rather than from recollection: the ruling ledger
and its harness, `$lib/auth/unbuilt-capabilities.ts` (which already carries the honest inventory of
what the server cannot do), `apps/api-worker/src/auth.ts` for what it can, `docs/deploy-queue.md` for
the two account-side steps that gate anyone signing in to a deployed instance, and
`$lib/matters/sections.ts` for which matter sections are built and which are stubs.
