---
branch: claude/matter-assets-slice-1
worktree: .claude/worktrees/agent-af662b6c1a84056d4
area: Matter assets — the register core (the asset row, the class spine, the per-firm type catalog, interests, the append-only valuation history, document links, protected identifiers)
status: review
touches: packages/matter-assets, packages/database/src/per-firm-schema.ts, packages/database/src/protected-columns.ts, packages/database/drizzle/per-firm, packages/data-access/src/pii-registry.ts, packages/data-access/src/protected-field-registry.ts, packages/identifiers, packages/access-control/src/registry.ts, packages/telemetry/src, apps/worker/src/routes/matter-assets.ts, apps/worker/src/app.ts, apps/worker/src/per-firm-migrations.ts, apps/worker/src/contracts/problem-types.ts, apps/worker/test, apps/worker/openapi/openapi.json, packages/api-client, changelog.d, status.d, roadmap.d/core-domain.md, docs/user
---

Builds the matter-attached asset register's first slice: the `matter_asset` row anchored `NOT NULL`
to one matter, the closed ten-value class spine with the per-firm `matter_asset_type` catalog under
it, the real-property and financial-account attribute tables, the append-only `matter_asset_valuation`
history with its as-of resolution, interests held by Directory entities, many-to-many document links
over already-ingested File Manager files, and the protected `matter_asset_identifier` row whose full
value is readable only through the existing `readProtected` chokepoint.

Migration tag `20260806T020000_matter-assets` assumes journal head idx 36
(`20260806T000000_case-calendar`) with a catalog stream possibly taking `20260806T010000` at idx 37;
this stream retags to the next dense idx if it is second to merge. It also touches the permission
inventories (`packages/access-control/src/registry.ts`, the role-seed migration,
`packages/database/test/node-sqlite.test.ts`, and the worker's `me` / `auth-provisioning-e2e` role
expectations) for `matterAssets:read` and `matterAssets:manage`, plus the OpenAPI snapshot and the
typed client — whichever stream lands second regenerates those two.
