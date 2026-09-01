---
worktree: C:/dev/magna-carta-worktrees/claude/matter-tabs-layout-mockups-odluqz
area: Matter chrome — shrinking the identity block now that the section strip shares its band
status: review
touches: packages/design-system/src/lib/components/masthead, apps/web/src/routes/developer-console/matter-identity, changelog.d
---

A second selection round on the matter header. The section strip landed in its inline-end column, and the band's height is now set by whichever column is taller — so the identity block is what is left to shorten. Six settings are rendered and measured at `/developer-console/matter-identity`.

The shipping change so far is one design-system addition: `Masthead.Root` takes a `density` (`default` / `compact` / `dense`) that steps the title down through the recipe, so a screen never reaches for a type utility on the Title. Nothing under `matters/[id]` has changed shape yet — the chosen setting gets applied and the gallery deleted in the same commit.

Anything touching `packages/design-system/src/lib/components/masthead` should sync first.
