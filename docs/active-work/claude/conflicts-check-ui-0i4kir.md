---
worktree: C:/dev/magna-carta-worktrees/claude/conflicts-check-ui-0i4kir
area: The conflicts check UI — lighting up the built surface, and giving a matter its own Conflicts section
status: building
touches: apps/web/src/lib/navigation/destinations.ts, apps/web/src/lib/matters/sections.ts, apps/web/src/routes/(app)/matters/[id]/conflicts, apps/web/src/routes/(app)/matters/[id]/intake, apps/web/src/routes/(app)/conflicts, roadmap.d/conflicts.md, status.d, changelog.d
---

The conflicts screens were built and never lit: the sidebar destination still carried `shipped:
false`, so the runner, the check history, one check read back and a matter's standing were all
reachable only by typing the URL. This stream flips that, and gives a matter its own Conflicts
section beside Intake — the owner's call of 2026-09-07, keeping the two separate in the section
strip for the same reason they are separate in the sidebar.

It also fixes the link that vanished: the intake conflicts step offered its way through to the
record only while the step was unrecorded, so the record became unreachable from the matter at
exactly the moment it stopped being a task and became the thing a firm has to produce.

Do not step on `apps/web/src/lib/matters/sections.ts` (a section is added and the `conflictsCheck`
timeline source changes owner) or `apps/web/src/lib/navigation/destinations.ts`.
