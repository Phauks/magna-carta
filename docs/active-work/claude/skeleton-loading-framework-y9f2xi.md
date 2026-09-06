---
worktree: C:/dev/magna-carta-worktrees/claude/skeleton-loading-framework-y9f2xi
area: One loading state, second round — the four-state region, refreshing, the stall, the settle measurement, the sample vocabulary, and two more gates
status: review
touches: packages/design-system (loading-region, loading-fixtures, stories, test/fitness), tooling/lint-one-ui, apps/web/src (every file with a LoadingRegion, app-shell.svelte, diagnostics/breadcrumbs.ts, developer-console/loading-states), docs/specs, docs/decisions/pending, docs/conventions/ui-design.md, roadmap.d/design-system.md, changelog.d/
---

The first round (LoadingRegion, the recipe, the `hand-placed-loading` gate, the migration) is on
`main`. This round makes the region hold the whole state set (`failed`, `empty`, `refreshing`),
state a stall, announce the finish and measure every settle; adds the sample vocabulary every
fixture draws from; adds the `silent-loading` and `fixture-shape` rules; and measures the bone's
contrast. A concurrent stream that writes a loading state passes `failed`/`failure` and
`empty`/`emptyState` to the region rather than branching around it, and draws its fixture words
from `@magna-carta/design-system/loading-fixtures`.
