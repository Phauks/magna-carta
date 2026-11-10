---
category: Added
audience: public
---

**Legal citations.** `@magna-carta/citations` is a pure engine that reads a pasted link (govinfo,
Cornell LII, eCFR, Nevada and California code pages, CourtListener) or a rough citation into fields,
keeps each field's provenance so typed values override what was read, and formats the full, short
and Id. forms in a court format (Uniform System from The Indigo Book; Nevada state courts; the
California Style Manual). The design system gains `FormattedCitation`, and `/legal-citations` is a
new top-level tool gated by `tools:legalCitations`, seeded onto the five default roles.

## Public

**Legal Citations.** Paste a link to a statute, regulation or opinion, or a rough citation such as
"347 us 483", and the details are read for you; anything you type overrides them. You get the full
citation, the short form and the "Id." form in your court's format (Uniform System, Nevada or
California), each ready to copy with its italics.
