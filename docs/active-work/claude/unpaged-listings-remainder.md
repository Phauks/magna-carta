---
worktree: claude/unpaged-listings-remainder
area: API contract — the last eighteen unpaged list endpoints
status: building
touches:
  - packages/data-access/src/cursor-pagination.ts
  - packages/matters/src/matter-assignment.ts
  - packages/matter-assets/src/valuation-statements.ts
  - apps/api-worker/src/routes/matter-records.ts
  - apps/api-worker/src/routes/matter-assets.ts
  - apps/api-worker/openapi/openapi.json
  - packages/api-client/src
  - tooling/lint-list-pagination/unpaged-baseline.mjs
---

# The last eighteen unpaged list endpoints

Closes the campaign the pagination gate opened at forty-seven. The carried-over list is now empty:
every endpoint is either cursor-paged or recorded under `BOUNDED_BY_CONSTRUCTION` with a claim a
reader can check at a named place.

Two needed real paging and both wanted a sort key the cursor module could not express, so it grew a
three-part keyset — `compositeKeysetClause` and friends beside the existing two-part ones. That also
answers the gap `billing.listDeliveries` names in its own entry, though this change does not spend
it there.

Nothing here changes what any read MEANS. `matters.listAssignments` and
`matterAssets.listValuations` keep their display order exactly; they gained a `nextCursor` and lost
a ceiling.
