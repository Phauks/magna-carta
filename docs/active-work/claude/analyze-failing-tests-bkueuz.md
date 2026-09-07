---
worktree: C:/dev/magna-carta-worktrees/claude/analyze-failing-tests-bkueuz
area: Fix the three test failures standing on main (api-worker conformance + database health)
status: review
touches: apps/api-worker/test
---

Repairs the three failures that were pre-existing on `main`, both in test expectations rather than in
shipped behaviour. `uploads.matches` is a read-shaped POST that correctly declares `audited: false`,
but was never added to the non-mutating allow-list the two conformance fitness functions consult, so
it read as an unaudited mutating route; the entry is added to both copies of that list. The
firm-database health test still asserted the two-key shape the row had before it began carrying the
`fault` that explains an unreachable database, and now asserts the fault as well. No source changes,
so nothing here is on another stream's path beyond `apps/api-worker/test`.
