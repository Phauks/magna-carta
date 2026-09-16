---
category: Added
audience: internal
---

**A developer-console gallery of three candidate headers for the document editor, for the owner to choose between.**

The direction is to take the app's rail and top bar off the editor screen and replace both with one band that carries what each of them was carrying. Which band that is, is not obvious: the rail and the bar between them hold a way home, a way back to the matter's files, search, the build chip, notifications, the Time Sheet handle, two transfer registers and the profile menu, and a header thin enough to be worth the change cannot hold all of it.

So the three candidates are rendered rather than described, at `/developer-console/document-editor-headers`, from the shipping components and over a stand-in document canvas at a fixed frame height — the band's cost in canvas is the visible difference between them. **Continuous chrome** seats the document in the app's own ink bar and gives nothing up. **Document masthead** keeps the header the document already has and folds what survives of the app into its action row. **Path bar** makes the path itself the header, every rung from the docket to the document on one row. Each renders four states — editing, saving, read-only, and an editor that has lost its connection — each measured, so a band that grows when the document turns read-only is a number rather than a squint.

Nothing about the editor changed. The real edit route, the app shell and `ScreenHeader` are untouched, and the only file outside the new directory is the fixtures registry that makes the surface findable. Two limits are stated on the page itself rather than left to be discovered: the save readout is driven by a prop, because the editor does not report its save state to the host at all yet, so what is under review is a shape and not behaviour; and the product's one back control has no register for an ink band, which is a design-system gap the first variant would have to close.
