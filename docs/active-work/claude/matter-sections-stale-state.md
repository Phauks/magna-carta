---
worktree: C:/dev/magna-carta-worktrees/claude/matter-sections-stale-state
area: the matter Costs, Time and Parties sections, and the scoped gate's formatter split
status: review
touches: apps/web/src/routes/(app)/matters/[id], tooling/check-scoped, changelog.d
---

Two fixes the Calendar slice exposed in its neighbours. The three older matter sections keep the
previous matter's list and failure on screen while the next read runs, so a failure is attributed to
the wrong matter; each now discards the old answer first, except that Parties discards on a change of
matter only, since its reload after a sever is the same matter's list being read again.

Second, `pnpm check:scoped` could not pass a change set of nothing but `.svelte` files, which is the
shape of every screen-only change. The formatter has no Svelte parser and `vp check` refuses when
every path it is handed is one it cannot format. The step construction is split and pinned by a test.
