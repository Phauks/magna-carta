---
category: Fixed
audience: public
---

**The Magna Carta block in the editor's About dialog reads as labelled rows, with the build linked to its commit.** The first cut ran its lines together inside the dialog's row class; `buildRows` now yields label, value and an optional `href`, the block renders a heading and one flex row per fact (`.mc-about-row`, `.mc-about-key`), and the stylesheet the edit worker serves lays them out. The commit links to `REPOSITORY_URL/commit/<hash>` in a new tab; a development build has no link.

## Public

**Help › About inside the editor now shows the Magna Carta build as separate lines**, each labelled, and the build number is a link to the change it names.
