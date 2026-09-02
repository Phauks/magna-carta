---
category: Fixed
audience: internal
---

**Four tests that were red on `main` are green again, and two of them found real gaps.** All four had passed through unseen because the gate ran nothing on `main` for a month, and each is a seam between two branches that merged in quick succession.

- When the column controls moved into each header's right-click menu, the trailing-pinned column's held pin did not come with them: the grid model already refused to toggle a `pinnedEnd` column, but the menu offered "Pin Status" as if it could, and the Time Sheet story still clicked a Columns button that no longer existed. The menu now shows a trailing-pinned column as pinned and disabled, titled "always keeps its place at the trailing edge", and the story asserts that through the header menu.
- The masthead's "Compact density" story rendered two page banners for comparison, which axe rejects; the comparison masthead now sits inside a labelled section, where a header is that section's header rather than a second banner.
- The conformance suite's committed operation list still named the four notes operations the edit-and-delete model replaced; it names the four that replaced them.
- The export-snapshot write on a member's shelf (`recordExportSnapshot`) put its object into the firm bucket with no dimensions, which the R2 dimension scan exists to catch: an object nothing can scope. It now carries the new firm-scoped class `export-snapshot` (`@magna-carta/object-dimensions`), on the same footing as `download-bundle`, since its figures may span matters and the shelf is the member's.

One more collision of the same day is recorded rather than fixed here: the matter-status window (#473) composes its own `Dialog.Content`, which the one-shell lint (#466) rejects. It stands as an allowance in `tooling/lint-one-ui/registry.json`, on the reading that it is a record window's shape, and the migration is owed to the stream that owns the screen.
