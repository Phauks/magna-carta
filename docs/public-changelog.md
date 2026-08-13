# Product changelog

What changed in Magna Carta, written for the people who use it. Entries are dated rather than
versioned: the product ships continuously and no release has been cut, so a date is the honest unit.

This file is **assembled, never hand-edited on a branch.** Its entries come from the `## Public`
blocks of `audience: public` fragments in [`changelog.d/`](../changelog.d/), folded in on `main` by
`vp run changelog-build` — the same one pass that folds the developer half of those fragments into
[`CHANGELOG.md`](../CHANGELOG.md). Two audiences, two sets of sentences, one source and one review.

Curation happens here, in this file, at publish time: the folded entries are the raw material, and
a dated section may be edited on `main` into the thematic roll-up a reader actually wants rather
than one bullet per merge. What is never done here is authoring a change that has no fragment
behind it.

Categories: **Added · Changed · Deprecated · Removed · Fixed · Security.**
