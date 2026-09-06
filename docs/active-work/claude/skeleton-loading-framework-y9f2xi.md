---
worktree: C:/dev/magna-carta-worktrees/claude/skeleton-loading-framework-y9f2xi
area: One loading state — LoadingRegion, the mc-loading recipe, the hand-placed-loading gate, and the migration of every loading state in apps/web
status: review
touches: packages/design-system (loading-region, skeleton export, data-table-grid, folder-tree, components.css, stories), tooling/lint-one-ui, apps/web/src (44 files with a loading state, developer-console/loading-states, dev-fixtures.ts), docs/specs, docs/decisions/pending, docs/conventions/ui-design.md, roadmap.d/design-system.md, changelog.d/
---

Builds the owner's 2026-09-05 ruling: every loading state runs through `LoadingRegion`, which
renders the real markup over a fixture and greys its leaves with CSS. The `./skeleton` export is
gone and `lint:one-ui` fails any hand-placed loading state. A concurrent stream that adds a loading
state to a screen wraps it in `<LoadingRegion loading label>` with a `fixture` snippet where the
markup cannot render on null data, and must not import `@magna-carta/design-system/skeleton`, write
`aria-busy`, or show a loader glyph. `DataTable.Grid`'s count prop is now `placeholderCount`.
