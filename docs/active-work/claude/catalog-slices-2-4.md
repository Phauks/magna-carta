---
branch: claude/catalog-slices-2-4
worktree: .claude/worktrees/catalog-slices-2-4 (remote session)
area: document automation — merge-field catalog slices 2-4 (staffing, court/case, estate & capacity)
status: building
touches: >
  packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/ (idx 45-47, tags
  20260807T040000/T041000/T042000), apps/worker/src/per-firm-migrations.ts,
  packages/identifiers/src/registry.ts, packages/data-access/src/pii-registry.ts,
  packages/matters/src/matter-assignment.ts (new), packages/directory/src/{types,identifiers,party,statements}.ts,
  packages/document-assembly/src/{catalog/*,merge-statements,resolve,directory-role-bindings,protected-bindings,staffing-bindings(new),court-bindings(new),estate-bindings(new),types}.ts,
  packages/document-assembly/test/*, packages/merge-field-catalog-contract/src/types.ts,
  apps/worker/src/routes/{matter-staffing,member-profiles,matter-court-case,matter-estate}.ts (new),
  apps/worker/src/routes/directory.ts (party capacity), apps/worker/src/app.ts,
  apps/worker/openapi/openapi.json + packages/api-client/src (regenerated),
  packages/fixtures (documentAutomation profile + baseline), docs/user/ (template author guide),
  status.d/2-6-document-automation.md, changelog.d/, docs/decisions/pending/
---

Building merge-field catalog slices 2·6·8 (matter staffing + member subjects + protected bar
number), 2·6·9 (court-case record, court/case subjects, caption fixture), and 2·6·10 (estate
record, estate subject, capacity + capacityLine). H1-H6 ratified by the owner, so the platform
tables are unblocked. Slice 2·6·5 + the name value type are on main (PR #146); 2·6·6 (address value
type, multi-line renderings) and 2·6·7 (party subjects at scale) are NOT built — facets needing the
structured address type or multi-line emission (member/court address, signatureBlock) are
deliberately deferred to those slices and noted in the PR.

Migrations: idx 45 = 20260807T040000_matter-staffing, idx 46 = 20260807T041000_matter-court-case,
idx 47 = 20260807T042000_matter-estate-and-capacity. Snapshot refreshed to idx 47 in the same
commit.
