---
slug: pdf-generate-primitives
status: Accepted
area: Documents
date: 2026-06-26
summary: Merge / split / rotate / watermark in the pure-Rust PDF engine; merge carries interactive structure; watermark does text and image; all additive, never redaction.
---

The pure-Rust PDF engine gains the remaining slice-4 assembly primitives (Bates numbering
already shipped): **merge**, **split**, **rotate**, and **watermark**. All are pure lopdf
model work or additive overlays — no rendering — and run client-side in WebAssembly so the
document bytes never leave the process.

**Built complete, not lean** (owner's call — avoid revisiting the same module):

- **merge** concatenates the pages of N inputs and **carries interactive structure across**:
  each input's outlines are chained under one merged root; AcroForm `/Fields` are unioned into
  one `/AcroForm` with colliding top-level field names suffixed (`name` → `name_2`), `/DR` and
  `/NeedAppearances` merged; named destinations (name trees + legacy `/Dests`) are merged into a
  flat `/Names` array with colliding names suffixed. Renumbering each input before combining
  makes its destinations and field references valid without remapping.
- **watermark** does **text and image**: text reuses the Bates standard-font machinery (centred,
  rotated, opacity via a shared `/ExtGState`); image embeds a PNG as a Flate-compressed RGB image
  XObject with an `/SMask` for alpha. An RGB or grayscale JPEG embeds verbatim via `/DCTDecode`
  with the matching colorspace (component count read from the JPEG frame header); a CMYK JPEG is
  decoded to RGB and Flate-stored rather than mislabelled. The page's `/Rotate` is pre-compensated
  so the mark appears at the requested angle on rotated pages. An over-large image (or a malformed
  one) is rejected.
- **split** returns one independent document per page range; **rotate** is relative-clockwise and
  composes with a page's existing `/Rotate`. Both flatten inherited `/MediaBox`/`/Resources`/`/Rotate`
  onto the kept pages so they stay correct after the page tree is rebuilt.

**Additive, never redaction.** watermark and rotate draw on top / reorganise pages and remove
nothing; merge/split do not strip hidden content or metadata. The code and docs say so and point
to `redactDocument`/`sanitizeDocument`.

**Reuse over rebuild.** lopdf's merge and rotate recipes; the Bates overlay/resource-merge/font
machinery; surgery's inheritance resolvers; the `image` crate (already a dependency) for the image
watermark — no new dependency, all pure Rust.

**Stated deferrals / known limits:** the inputs' `/Info`/XMP metadata and attachments are not merged
(the combined document gets fresh document info); watermark placement beyond centred and tiled is
not built. When two merged documents share the **same named-destination name** for different targets,
the merged destination *table* is correct (the later one is suffixed) but by-name links/actions
inside the second document still reference the old name and may resolve to the first document's
target — explicit (array) destinations are unaffected; likewise a `/DR` default-resource font-key
collision keeps the first document's font. The Tools UI for these surfaces is deferred to the 0·7
cycle with the rest of the PDF engine's UIs.
