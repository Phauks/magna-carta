# pdf-compose-core (crates/pdf-compose-core) — CLAUDE.md

**Purpose.** Makes a new PDF from content: a title, headings, paragraphs with bold and italic,
pictures, tables whose heading row repeats on every page, labelled fields, rules, spacing and page
breaks, with a header and footer line on each page and an optional accent colour for the title,
headings and rules. [`pdf-core`](../pdf-core) works on PDFs that
already exist; this crate is the only place a PDF is written from nothing. Native `rlib`, and a
WebAssembly module shipped through [`@magna-carta/pdf-compose`](../../packages/pdf-compose/CLAUDE.md).
The sign Worker composes the Certificate of Completion with it.

## Key files / entry points

- `src/lib.rs` — `compose(&ComposedDocument, &FontFamily)`, `ComposeOutput`, `ComposeError`.
- `src/model.rs` — the content model. It says what a document holds and nothing about where it goes.
- `src/layout.rs` — the model in, pages of positioned marks out. Every placement decision is here.
- `src/render.rs` — marks in, PDF bytes out, through `krilla`. It decides nothing.
- `src/images.rs` — reads a picture's size before layout; decodes, turns and scales it after.
- `src/fonts.rs` — the four faces and the measurer layout breaks lines with.
- `src/wire.rs` — the JSON form of the model, for a caller that is not Rust: `compose_json`.
- `src/wasm.rs` — the WebAssembly edge, `composeDocument`. One function; it only converts.
- `tests/compose.rs` — composes documents and reads them back with `pdf-core`.

## Local conventions

- **Layout and writing stay apart.** A new block type is a variant in `model.rs`, a method on `Flow`
  in `layout.rs` that emits existing `Mark`s, and nothing in `render.rs` unless it needs a new kind of
  mark. That is what lets a footer say "Page 3 of 12" before the first page is written, and what makes
  a layout bug findable without parsing a PDF.
- **Coordinates are points from the top-left corner, y downward**, in the model, in layout and in
  `krilla`. `pdf-core` reports positions from the bottom-left; only the tests cross that line.
- **Measure with the face you draw with.** `Measurer` shapes with `rustybuzz` at the version `krilla`
  shapes with, and a finished line is measured as the merged runs it is drawn as. A width taken from a
  character count or a different shaper drifts off the right margin.
- **A field added to the model is added in three places:** `model.rs`, `wire.rs`, and the types in
  `packages/pdf-compose/src/index.ts`. The JSON form refuses unknown fields, so a miss fails a test.
- **Colour is one accent, chosen by the document.** A mark is drawn in an `Ink`: a gray, or the
  accent with a gray to fall back on. Layout never names a colour, so a document with no accent
  holds none and one layout serves both.
- **The output is deterministic.** No clock is read: the creation time is the caller's
  `ComposedDocument::created`. The same model and fonts give the same bytes, and a test holds that.

## Invariants that apply here

- **Memory-safe dependencies only** (golden rule 14). `cargo tree -p pdf-compose-core -i cc` prints
  nothing; run it again before adding a dependency.
- **No document content in an error.** `ComposeError` carries at most an image's position, so a
  message built from one is safe to log.
- **Untrusted pictures.** An image is whatever a user uploaded. It is decoded under `image::Limits`
  (20,000 pixels a side; 512 MiB natively, 64 MiB in a WebAssembly build), one at a time, and a file past a limit is an error naming its
  position, never a truncated picture.
- **Nothing is dropped silently.** A table row taller than a page is split between its lines. A
  character the family has no glyph for is drawn as the font's missing-glyph box and listed in
  `ComposeOutput::missing_characters`, so a caller can refuse the document or supply another family.

## Dependencies & contracts

- `krilla` 0.8 writes the file: font subsetting and embedding, image embedding, metadata.
  [`containers/raster`](../../containers/raster) uses the same writer for image-to-PDF.
- The bundled family is Liberation Sans 2.1.5 under the SIL Open Font License 1.1
  (`fonts/LICENSE.txt`), metric-compatible with Arial, covering Latin, Greek and Cyrillic. The
  `bundled-fonts` feature compiles it in (about 1.6 MB); a caller with its own fonts turns it off and
  passes `FontFamily::new`.

## Gotchas

- **A JPEG stays a JPEG; everything else is embedded without loss.** A JPEG that needs no turning and
  no scaling is embedded byte for byte. A large PNG photograph therefore makes a large file; that is
  the trade for never putting compression artefacts around the text of a screenshot.
- **A phone photograph is stored sideways** with an orientation tag. `images::probe` and
  `images::embed` both honour it; a new code path that reads dimensions must too, or the picture is
  laid out upright and drawn on its side.
- **The document is not tagged.** There is no structure tree, so a screen reader gets the text in
  drawing order without headings or table structure. `krilla` can write one; nothing here does yet.
- **One script per run of text.** `krilla`'s `draw_text` does no bidirectional reordering and no font
  fallback. Right-to-left text and mixed scripts need glyph-level drawing.
