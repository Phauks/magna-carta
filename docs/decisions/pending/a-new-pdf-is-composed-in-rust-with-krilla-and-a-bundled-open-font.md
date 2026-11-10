---
slug: a-new-pdf-is-composed-in-rust-with-krilla-and-a-bundled-open-font
status: Proposed
area: Documents
date: 2026-11-10
summary: "A new PDF is written by a crate of its own, crates/pdf-compose-core, from a content model (headings, paragraphs, pictures, tables, labelled fields) in two passes: layout to positioned marks, then writing through krilla 0.8, the pure-Rust writer containers/raster already uses. Liberation Sans 2.1.5 (SIL Open Font License 1.1) is bundled and subset into each file. Rejected: extending pdf-core's lopdf overlay code (no font embedding, so accented text and anything outside WinAnsi is lost), hand-rolling a writer on pdf-writer (re-implements subsetting and image embedding krilla already has), and continuing to route every PDF through a Word file and the office container (text cells only, a container round trip per export). The crate has no product caller yet; which screens send pictures, and whether the tabular export moves onto it, are the owner's."
---

**A new PDF is composed by `crates/pdf-compose-core`, through `krilla`, in an embedded open font.**

**Context:** the 2026-11-10 review of the PDF engine found that nothing in it writes a PDF from
content. `crates/pdf-core/src/generate.rs` merges, splits and rotates existing files. The one route to
a new PDF is the tabular export (`packages/document-assembly/src/compose/tabular.ts`), which composes
a Word file from text-only cells (`packages/export-document/src/renderable.ts`) and has the office
container convert it. That is why a generated PDF could only ever hold text.

**Decision.** A separate crate, because `pdf-core` parses untrusted files and a writer shares none of
that code or risk. The content model says what a document holds; `layout` places it as marks on
pages; `render` writes the marks. `krilla` 0.8 does the writing: it subsets and embeds TrueType and
OpenType fonts with a correct text layer, embeds JPEG without re-encoding, and is already in the tree
(`containers/raster`). Line breaking measures with `rustybuzz` at the version `krilla` shapes with.
Pictures are decoded by the `image` crate under explicit limits. No C or C++ enters: `cargo tree -i cc`
is empty for the crate.

**The font.** Liberation Sans, because it is metric-compatible with Arial, covers Latin, Greek and
Cyrillic, and its licence (SIL Open Font License 1.1) allows embedding and bundling. The standard 14
PDF fonts were rejected: they are not embedded, so the reader's machine substitutes them, and their
encoding stops at WinAnsi. A character outside the bundled family is drawn as the missing-glyph box
and reported to the caller; a firm that needs another script supplies its own family.

**Rejected.** Extending the overlay code in `pdf-core` (Bates, watermark): it writes the standard
fonts by name through lopdf and cannot embed one. A hand-rolled writer on `pdf-writer`: it would
re-implement font subsetting and image embedding. Staying on Word-then-convert for everything: it
cannot carry a picture without growing the Word composer, and every export pays a container round
trip.

**Consequences.** The crate is about 2 MB larger than its code because of the font; a WebAssembly
build that receives fonts from its host turns the `bundled-fonts` feature off. The output has no
structure tree, so it is not yet an accessible (tagged) PDF. Right-to-left and mixed-script text are
not supported. **Open for the owner:** which screens send pictures into a generated PDF, and whether
the existing tabular export should be drawn by this crate instead of the office container.
