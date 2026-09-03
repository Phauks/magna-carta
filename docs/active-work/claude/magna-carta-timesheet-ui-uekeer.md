---
worktree: C:/dev/magna-carta-worktrees/claude/magna-carta-timesheet-ui-uekeer
area: The Time Sheet and the Time tab — chrome, the served-but-unrendered fields, and refiling onto another matter
status: building
touches: packages/timekeeping, apps/api-worker/src/routes/time-entries.ts, apps/api-worker/test/conformance.test.ts, apps/api-worker/openapi/openapi.json, apps/web/src/lib/time, apps/web/src/lib/records, docs/conventions/time-tab-rulings.md, changelog.d/
---

The standing stream on the time surfaces. Landed so far: the chrome round the owner called (one
sidebar-toggle vocabulary shared with the file manager, the four ledgers filling the remaining
height, an empty state that centres in the frame rather than in the scrollable row), the fields the
listing was already serving and the screens were still calling unbuilt, and the refile —
`POST /time-entries/{id}/refile`, which keeps the record and re-resolves the rate and the rounding
against the destination, reached from the Matter cell on the sheet and from the record window.

In flight now: the conformance suite's not-vacuous operation list, which the refile route's
`timeEntries.refile` was added to the contract without. That list is what stops every positive
assertion in the file from passing over an empty document, so it fails until a new operation is
named in it — the step `apps/api-worker/CLAUDE.md` calls for in the same commit as a new route, and
the one this stream missed.

Touches `apps/api-worker/openapi/openapi.json`, which another stream also declares.
