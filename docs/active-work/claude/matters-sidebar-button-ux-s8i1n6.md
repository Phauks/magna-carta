---
worktree: C:/dev/magna-carta-worktrees/claude/matters-sidebar-button-ux-s8i1n6
area: Where the pane toggle lives — a developer-console review surface for every candidate home of the show/hide-a-pane control on the four ledgers and on Files
status: designing
touches: apps/web/src/routes/developer-console/pane-toggle-placements, apps/web/src/lib/developer/dev-fixtures.ts, packages/design-system/src/lib/components/button
---

The four financial ledgers each draw a row above their table whose only occupant, most of the time,
is the details-pane toggle. This stream does not move it yet — it builds the surface the choice gets
made on: `/developer-console/pane-toggle-placements`, every candidate placement rendered from the
shipping components over one fixture, at one fixed height so what each costs the table is visible.
Files is covered too, because it carries two of these toggles and is the only screen that lets a
reader close its own folder tree. The one shipping change so far is a new `icon-sm` Button size, for
a glyph control that has to ride inside a band already sized to the small control scale.

Once the owner picks, the follow-up edits `apps/web/src/lib/{time,billing,costs}/*-ledger.svelte`,
`bill-register.svelte`, the file-manager toolbar and footer, and the design-corrections ledger. A
concurrent stream touching a ledger's action row or the file-manager toolbar will collide there.
