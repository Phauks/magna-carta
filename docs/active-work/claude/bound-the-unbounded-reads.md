---
worktree: C:/dev/magna-carta-worktrees/claude/bound-the-unbounded-reads
area: the four reads traced out of the unpaged-listing baseline that carry no bound at all
status: building
touches: packages/directory/src/search.ts, packages/file-manager/src/queries.ts, packages/custom-fields/src/reads.ts, apps/worker/src/routes, tooling/lint-list-pagination, changelog.d
---

First batch off the shrink-only baseline. Forty-five endpoints were traced to the statement behind
them: twenty-two already carry a limit and want only a cursor, and four carry no bound of any kind.
Those four are fixed here, each with the answer its shape actually calls for rather than one applied
uniformly — a paged version list, a paged value history, a capped search that reports its own cap,
and a folder tree that is refused rather than truncated because half a tree is not a tree.
