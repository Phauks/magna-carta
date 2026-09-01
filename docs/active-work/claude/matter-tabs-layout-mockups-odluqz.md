---
worktree: C:/dev/magna-carta-worktrees/claude/matter-tabs-layout-mockups-odluqz
area: Matter chrome — shrinking the identity block now that the section strip shares its band
status: building
touches: packages/design-system/src/lib/components/masthead, apps/web/src/routes/developer-console/matter-identity, changelog.d
---

The second selection round is decided. The identity block folds to two rows, the title takes the Masthead recipe's new `compact` density, and the overflow control moved onto the section strip's row — which is the change that got the band under the floor its other column was holding. 111px to 76px. The gallery has been deleted.

`Masthead.Root` takes a `density` (`default` / `compact`), stepping the title through the recipe so a screen never reaches for a type utility on the Title.

Anything touching `packages/design-system/src/lib/components/masthead` should sync first.
