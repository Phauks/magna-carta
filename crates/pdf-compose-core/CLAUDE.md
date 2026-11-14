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
- **Density is the document's choice, not a block's.** `compact` narrows the rows of every table and
  field list at once, and a `small` paragraph is the caption style in the flow. A caller that has to
  fit a known amount on a page uses those and the page margins, never a font size of its own.
- **What repeats on every page is added after the flow.** The header and footer lines and the
  `letterhead` band are marks pushed onto each finished page, drawn in the margins, so they never
  move the content; the caller sizes the top margin for the band. The letterhead's picture takes the
  position after the last image block in the list layout and render both read.
- **A card is a pair of marker blocks, not a container.** `CardStart` draws the title in a bar in
  the accent colour (`Mark::Bar`, rounded at the top) and `CardEnd` draws the frame (`Mark::Frame`,
  the one stroked mark), so every block lays out inside a card with the code it already has and
  pictures keep their positions in the image list. Text stands in by `CARD_INSET`; rows run on with
  no gap, their headings unshaded, and a row's rule is drawn only when something follows it
  (`OpenCard::rule_due`), so the last row never doubles the frame. A card that reaches the foot of
  a page is framed there and opened again on the next. `Flow::trailing_gap` is what lets the frame
  close under the last block: `gap` adds to it and `mark` clears it, so push a frame onto the page
  directly.
- **Two pictures share a line by the second asking.** `ImageBlock::beside` sets a picture in the
  second half of the line the image block before it opened (`Flow::image_row`); anything laid out
  between the two, or a page break, and it stands alone. Each is still one image block, so the
  positions in the image list do not change.
- **Under a letterhead the footer is measured from the content**, `Letterhead::FOOTER_HEIGHT`
  below it, as the band above is `Letterhead::HEIGHT`. A caller sets the top and bottom margins to
  those plus one distance from the paper's edge and the bar and the page number land that far in.
- **A grid is asked for by the model, never by the text.** `Field::grid` sets a value's words in
  columns of one width. Layout marks such a cell with a control character that `clean` strips from
  anything a caller supplies.
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
- A second bundled family, Atkinson Hyperlegible Next (SIL Open Font License 1.1,
  `fonts/AtkinsonHyperlegibleNext-LICENSE.txt`, about 0.3 MB), is the application's reading
  typeface. It draws Latin only. A document names its family with `typeface`
  (`FontFamily::bundled_as`); a caller that asks for Atkinson reads `missing_characters` and composes
  again in Liberation Sans when a name is in Greek or Cyrillic.
- `Table.banded` shades the heading row and every second row and drops the rule under each row, for
  a long table read across wide rows. The default keeps the ruled table.

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
