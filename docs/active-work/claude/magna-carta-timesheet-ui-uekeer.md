---
worktree: C:/dev/magna-carta-worktrees/claude/magna-carta-timesheet-ui-uekeer
area: The time surfaces — the Time Sheet, the matter Time tab, and the chrome the four financial ledgers share with them
status: building
touches: apps/web/src/lib/time, apps/web/src/lib/costs, apps/web/src/lib/billing, apps/web/src/lib/records, apps/web/src/lib/components, apps/web/src/routes/(app)/matters/[id], packages/design-system/src/lib/components/data-table, changelog.d/, status.d/
---

The owner's review round on the time surfaces. The first pass is chrome the four financial ledgers
(Time, Fees, Costs, Billing) hold in common — the pane toggles, the pane frame, the empty state and
the page height — so the corrections land in one shared component rather than four times. The second
is the time surfaces' own: the served listing carries the entry number, both dates and both people,
the resolved rate, the UTBMS codes, the internal memo, the attachment count and an event history,
and the screens still render those as gaps.

A concurrent stream editing `packages/design-system/src/lib/components/data-table` should know this
one touches the grid's placeholder row (the empty state's frame) and nothing else in that directory.
