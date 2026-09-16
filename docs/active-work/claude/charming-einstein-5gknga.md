---
worktree: C:/dev/magna-carta-worktrees/claude/charming-einstein-5gknga
area: Attorney License Lookup — the state picker becomes the whole register, as the one table
status: building
touches: apps/web/src/lib/tools/attorney-license, apps/web/src/routes/(app)/tools/attorney-license-lookup, apps/web/test/attorney-license.test.ts, docs/user/features/attorney-license-lookup.md, changelog.d
---

The tool's screen stops asking for a state and lists all fifty-one registers as `DataTable.Grid`
rows, each state's name linking out to its register. Confined to the tool's own files plus its user
guide; nothing in `packages/government-links` changes, so the registry itself is untouched.
