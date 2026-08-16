---
worktree: /home/user/magna-carta/.claude/worktrees/assets-next
area: Matter assets 4·3·3 remainder — the firm's own fields on an asset
status: building
touches: packages/custom-fields/, packages/database/src/per-firm-schema.ts, packages/document-assembly/src/custom-field-statements.ts, packages/matter-assets/, apps/worker/src/routes/custom-fields.ts, apps/worker/src/routes/matter-assets.ts, apps/worker/openapi/openapi.json, packages/api-client/src/, packages/data-access/src/pii-registry.ts, docs/user/features/, roadmap.d/, status.d/, changelog.d/, docs/decisions/pending/
---

The one remaining buildable half of slice 4·3·3: `custom_field.target` widens to `matterAsset`, so a
firm puts its own fields on an asset the way it already can on a matter and on a directory entity.
The engine's lifecycle, limits, handle-not-name binding, and value history all apply unchanged — the
change is one member on a vocabulary plus the reads that have to recognise it.

The vocabulary stops being written out in three places. `CUSTOM_FIELD_TARGETS` in
`packages/custom-fields/src/types.ts` is the one home; the drizzle column, the route's request enum,
and the asset scope read all derive from it, and a fitness test pins the drizzle column's
`enumValues` to the constant so a fourth target cannot be added in one place only.

**No migration.** `custom_field.target` is a bare `text NOT NULL` with no CHECK — the drizzle `enum`
option is a TypeScript type and emits no SQL, and the lineage-head snapshot records no enum for the
column. The plan asked for "one additive migration"; the schema says there is nothing to migrate.
Recorded as a decision fragment rather than shipped as an empty migration file.

**The starter schedule template is NOT built and is reported to the owner instead.** There is no
document-automation starter-content mechanism on `main` to put one in, and building one pre-empts an
open decision. Detail in the decision fragment and the pull request.

No `apps/web` change: UI surfaces stay deferred.
