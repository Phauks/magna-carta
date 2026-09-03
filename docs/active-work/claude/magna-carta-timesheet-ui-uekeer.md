---
worktree: C:/dev/magna-carta-worktrees/claude/magna-carta-timesheet-ui-uekeer
area: The Time Sheet and the Time tab — chrome, the record window's fields, the money columns, and undoing a void
status: building
touches: packages/timekeeping, packages/design-system/src/lib/components/data-table, packages/design-system/src/lib/styles/recipes/modal-frame.css, packages/design-system/src/lib/components/date-picker, apps/api-worker/src/routes/time-entries.ts, apps/api-worker/openapi/openapi.json, packages/api-client, apps/web/src/lib/time, apps/web/src/lib/costs, apps/web/src/lib/records, docs/conventions/time-tab-rulings.md, docs/conventions/design-corrections.md, changelog.d/
---

The standing stream on the time surfaces, working the owner's rounds.

Landed: the chrome round (one sidebar-toggle vocabulary shared with the file manager, the four
ledgers filling the remaining height, an empty state that centres in the frame), the fields the
listing was already serving and the screens were still calling unbuilt, and the refile.

This round (R11 in the ledger): `(None)` on every code field instead of a paragraph apologising for
a firm that does not code its time; the internal memo under the description with its badge gone; a
settable rate on a draft — and, found beside it, the money columns not being re-derived when the
duration or an override changed; time entered in hours, units or a span between two clock times,
with the firm's real increment served rather than assumed; documents attached before the entry
exists; undoing a void, refused for an entry whose value became a cost; one word for that act
everywhere; and the cost window brought into the time window's shape.

Two changes are at the base and reach every surface: a modal at full screen squares its corners
(`modal-frame.css`), and a table's totals strip is held at the bottom of its frame (the shared
data-table). Both are pinned by browser measurement in the design-system stories rather than by eye
— the totals row's placement in particular went through three wrong mechanisms before the browser
said which one table layout actually honours.

Touches `apps/api-worker/openapi/openapi.json` and `packages/api-client`, which other streams also
declare, and the shared `data-table` and `modal-frame` recipes.
