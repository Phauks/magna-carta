# claude/fix-pdf-core-annots

**Branch:** `claude/fix-pdf-core-annots` · **Off:** main (ed2723b) · **Owner:** Trevor Goldsmith · **Started:** 2026-08-04

## Scope

Two confidentiality defects in `crates/pdf-core`, both annotation retention.

`split` stripped the catalog's document-level entries but left the kept pages' `/Annots` untouched, so an
annotation naming an excluded page — `/Dest`, `/Popup`, `/Parent`, `/P` — kept that page's dictionary,
content stream, and resources alive through the object-graph walk, and the excluded page shipped inside
the split output. Split now severs a kept page's annotation references into excluded pages (narrow repair
first: drop the out-of-range link and keep the annotation; drop the annotation whole when that is not
enough) and fails closed if any excluded-page object still survives the prune.

Surgical redaction rewrote the content stream only, leaving annotations — where the redacted words can
live a second time, in a note's `/Contents`, a link URI, or an appearance stream. Surgery now removes
every annotation standing over a redaction rectangle plus the markup thread bound to it, and a page whose
annotations cannot be cleared falls back to raster flatten. Flatten additionally blanks the annotation
objects instead of only unlinking `/Annots`, so one referenced from outside the page cannot outlive the
prune.

Page-annotation access (`/Annots` inline or by reference, `/Rect` corner normalisation) moved into one
home, `crates/pdf-core/src/annotations.rs`, rather than being written a fourth time.

## Files I expect to touch

- `crates/pdf-core/src/annotations.rs` — new: shared page-annotation reading/writing and rectangle parsing
- `crates/pdf-core/src/generate.rs` — split: object reachability, annotation pruning, fail-closed gate
- `crates/pdf-core/src/redact.rs` — surgery/flatten annotation purge and the annotation outcome gate
- `crates/pdf-core/src/detect.rs` — annotation helpers moved out; shared `rects_intersect`
- `crates/pdf-core/src/scrub.rs` — reads `/Annots` through the shared helper
- `crates/pdf-core/src/lib.rs` — module declaration
- `docs/specs/pdf-engine-next-steps.md`, `changelog.d/`
