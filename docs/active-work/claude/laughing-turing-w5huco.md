---
worktree: /home/user/magna-carta (remote session)
area: Safe website viewer — the render that never finished — and the Error ID that could not be looked up
status: review
touches: apps/api-worker/src/routes/safe-browse.ts, apps/api-worker/src/contracts/problem-types.ts, apps/api-worker/src/event-dispatch.ts, apps/edit-worker/src/index.ts, packages/safe-browse/src/, packages/telemetry/src/, apps/web/src/lib/tools/safe-browse/
---

The first readable refusal from the rendering service said `http=422 code=6004`, which the service
documents as being unable to finish because of an issue with the site. The capture had been asking
the browser to wait for `networkidle2`, a condition a page holding a socket or a poll never reaches,
so the wait ran to its own timeout and every capture against a live commercial page failed the same
way. It waits for `load` now, and a page that still will not finish gets a second attempt with the
sweep and the full-page shot turned off — a worse screenshot being the answer this tool most needs
to avoid withholding. A failed render is its own answer (`page-render-failed`, 422) rather than
borrowing the capacity 502 or the Error ID that asks support to fix a slow page.

Two Error ID faults found while reading that record. `logOperationFailed` minted its own id, so the
record's `errorId` field named a failure nobody held and the member's own id survived only inside a
message string; it returns the id it mints now. And an Error ID said nothing about when or where it
came from, so it carries 9 base36 milliseconds and a 3-character service code packed INSIDE the
existing 21-character body — widening it would have broken the scrubber's whole-handle exemption
and had the pipeline rewrite Error IDs to `[scrubbed]`.
