---
worktree: C:/dev/magna-carta-worktrees/claude/matter-tabs-layout-mockups-odluqz
area: Matter chrome — candidate layouts that move the section navigation into the header's empty right side
status: review
touches: apps/web/src/lib/matters, apps/web/src/routes/developer-console/matter-chrome, changelog.d
---

A selection round, not a build. The matter chrome spends two rows before any content: the masthead,
whose right half is empty apart from the overflow control, and then a full-width section strip on its
own row. This stream renders four candidate arrangements that spend one row instead, plus today's
chrome for comparison, as a dev-only gallery at `/developer-console/matter-chrome`.

Nothing under `matters/[id]` changes shape yet. The one shipping-code edit is the extraction of the
strip's overflow measurement into `$lib/matters/section-overflow.svelte.ts`, so the candidates and
the live nav fold their tabs by the same rule rather than by two copies of it. When the owner picks
a candidate, its arrangement is folded back into `matter-header.svelte` / `matter-section-nav.svelte`
and the gallery's candidate components are deleted in the same commit.
