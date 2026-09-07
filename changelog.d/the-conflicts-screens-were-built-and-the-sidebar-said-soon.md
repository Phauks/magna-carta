---
category: Fixed
audience: public
---

**The conflicts screens were built, and the sidebar said Soon.** The surface under `/conflicts` —
the check runner, the firm's own check history, one check read back with its candidates and their
adjudications, and where a matter stands — has been real Svelte for some time, over an API that
serves every read the read-surface design named. The sidebar destination never noticed: the entry in
`apps/web/src/lib/navigation/destinations.ts` still carried `shipped: false` with `announced: true`,
which is the one combination that renders a row **disabled and without an href**, and the Ctrl+K
palette listed it as `Conflicts Check — soon`. Every one of those screens was reachable only by
typing its address.

Nothing failed on it, and nothing could have: a registry flag disagreeing with the routes beside it
is not a type error, and the flag is the whole mechanism by which the sidebar decides what exists.
`apps/web/test/conflicts-surface.test.ts` now asserts the destination is shipped, has its href, and
carries no Soon treatment, so the surface and the promise cannot come apart again silently.

**A matter's conflicts record moved inside the matter.** Where a matter stood was served at
`/conflicts/matters/{matterId}`, outside the matter shell, and reachable in practice only from the
intake checklist. It is now the matter's own **Conflicts** section, on the strip directly after
Intake — separate from Intake rather than folded into it, because running a check is not one of the
intake procedure's steps, it is the act a step asks about, and the record it writes outlives the
intake that prompted it. The old address survives as a 308 rather than a 404.

The section claims the `conflictsCheck` timeline source, which `sections.ts` had declared as one no
section owned. `packages/calendar/src/sources/all.ts` was already building
`/matters/{id}/conflicts?entry={checkId}` for those rows — the seam was placed and pointed at a
route that did not exist — so a conflicts check on a matter's Activity chronology opened nowhere and
explained itself instead. It now opens the check it names, honouring the deep-link obligation in
`entry-from-url.ts` by going to the check's own record rather than landing the reader on the
standing.

**And the link to the conflicts record stopped vanishing the moment it mattered.** The intake
checklist offered its way through to a step's fact only while `step.record === null`, so ticking
"run the conflicts check" removed the only route from the matter to the check that was run. That is
precisely backwards: "we checked" is a question asked months later, by somebody who was not there
when the box was ticked. The link is now offered whether or not the step is recorded, and says
which of the two it is.

## Public

**Conflicts checking is now in your sidebar, and every matter has a Conflicts tab.**

The conflicts screens were finished but the sidebar still listed Conflicts Check as coming soon, so
unless you knew the web address you could not get to them. The row is live now: running a check,
reading every check your firm has run, and opening any one of them to see what it searched, what it
turned up, and who answered each result.

Each matter also has its own **Conflicts** tab, next to Intake, holding that matter's record — when
it was last checked, anything nobody has answered yet, whether your firm has widened what a check
must cover since, and a way to run another. It replaces a page that lived outside the matter and was
awkward to find; old links still work.

Two smaller things that made the record hard to reach are fixed. A conflicts check on a matter's
activity history now opens the check it refers to, instead of only saying one happened. And the
intake checklist keeps its link to the conflicts record after the step is marked done — it used to
disappear at exactly the point the record became the thing you would want to produce.
