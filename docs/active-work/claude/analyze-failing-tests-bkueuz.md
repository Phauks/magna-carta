---
worktree: C:/dev/magna-carta-worktrees/claude/analyze-failing-tests-bkueuz
area: The last of the three test failures that were standing on main (api-worker conformance mirror)
status: review
touches: apps/api-worker/test
---

Closes the remaining red test from the sweep of `main`. Two of the three were fixed on `main` while
this branch was being written — the `uploads.matches` entry in the conformance register, and the
firm-database health row learning to assert its `fault` — and this branch takes `main`'s version of
both. What was left is the second copy of the non-mutating allow-list, the one the end-to-end suite
applies to the live-served document, which never received the entry the register got. Test files
only; no source is touched, so nothing here is on another stream's path.
