---
branch: claude/catalog-follow-ups
worktree: .claude/worktrees/catalog-follow-ups (remote session)
area: document automation — follow-ups from the catalog slices 2-4 adversarial review
status: building
touches: >
  apps/worker/src/routes/matter-records.ts, apps/worker/src/assemblies/assembly-consumer.ts,
  apps/worker/test/matter-records-routes.test.ts, apps/worker/openapi/openapi.json +
  packages/api-client/src (regenerated), packages/matters/src/{matter-assignment,validation}.ts,
  packages/matters/test/matter-assignment.test.ts (new),
  packages/document-assembly/src/{merge-statements,staffing-bindings}.ts,
  packages/document-assembly/test/{staffing-resolution,staffing-window(new)}.test.ts,
  packages/database/src/per-firm-schema.ts (comments only),
  docs/active-work/claude/catalog-slices-2-4.md (index correction), changelog.d/
---

Follow-ups from the adversarial review of the merged catalog slices 2-4: pin the staffing
assignment validity window to civil dates (inclusive final day) with ordering validated at
composition, make the merge engine's window comparison honor both recorded forms, route the
assembly consumer's estate date-of-death read through the shared schema-name-synced statement,
correct the matter_assignment index comment, and make the staffing ambiguity reason distinguish a
duplicate assignment of one member from genuinely different members. No migrations.
