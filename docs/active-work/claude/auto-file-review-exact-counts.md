---
worktree: C:/dev/magna-carta-worktrees/claude/auto-file-review-exact-counts
area: the auto-file review read (email filing)
status: building
touches: packages/data-access/src/email-auto-file-statements.ts, apps/worker/src/routes/auto-file-rules.ts, packages/fixtures/src/load-profile, tooling/lint-list-pagination, changelog.d
---

The review read tallies per-rule activity by walking at most five hundred automatic links and
counting them in application code. Past that the counts understate and a matter whose links all fall
past the cut is absent from the answer entirely. Replaced with a distinct-matter read, the wall
filter, and a grouped count over the visible matters — exact, and with no cap on the link count at
all. The existing argument for why the answer is not PAGED still stands and is kept.
