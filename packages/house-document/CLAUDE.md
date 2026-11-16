# @magna-carta/house-document (packages/house-document) — CLAUDE.md

**Purpose.** How a document Magna Carta generates looks, and the pieces one is built from: the
margins, accent, typeface, letterhead and page number, and builders for cards, fields, tables,
notes, pictures and long tables that run over pages. A package that prints a record describes its
sections with these and names no colour, margin, typeface or paper size of its own. The first
document on it is the Certificate of Completion (`packages/signing/src/certificate-sheet.ts`).

## Key files / entry points

- `src/index.ts` — `houseDocument`, `housePictures`, the builders (`card`, `noteLine`,
  `instantFields`, `groupedCode`, `pictureWidth`, `pageHeading`, `pageList`), what a report and an
  exhibit list add (`figures`, `styledTable`, `coverSheet`, `signatureLines`), paging (`tablePages`,
  `pagedTable`, `contentSize`) and `composeReadable`.
- `src/brand-lockup.ts` — the lockup as a PNG, the first picture of every house document.
- `test/house-document.test.ts` — every builder as a value.

## Local conventions

- **Plain data, no engine.** The result of `houseDocument` is a document
  [`@magna-carta/pdf-compose`](../pdf-compose/CLAUDE.md) accepts as it stands. This package never
  imports the composer, so a Worker or a page that only lays a document out does not load 5 MB of
  WebAssembly, and a layout is tested with `toEqual`.
- **A look is changed here, once.** A document that wants a different margin, colour or frame is
  asking for a change to the house, made in this package for every document, or for a setting on
  `houseDocument`. It does not override a value in its own package.
- **A new kind of block is a composer feature first.** Drawing lives in
  [`crates/pdf-compose-core`](../../crates/pdf-compose-core/CLAUDE.md); a builder here only
  arranges blocks the composer already has.
- **No domain packages.** It depends on nothing in the workspace. A document's wording, its data
  and what it chooses to print stay with the package that owns the record.

## Dependencies & contracts

- The numbers in `src/index.ts` that describe the composer (the letterhead's 60 points, the
  footer's 28, a card's title bar, a compact row's height, the cover label's and the body's line) mirror constants in
  `crates/pdf-compose-core/src/layout.rs` and `src/model.rs`. Change both together.
- Pictures are named by position: the lockup is 0, a document's own follow in the order it passes
  them to `housePictures`.

## Gotchas

- **A cover sheet does not break the page itself.** `coverSheet` returns the label and its lines.
  Put a `pageBreak` after it, and before it unless it opens the document: a page break as the
  first block prints an empty sheet.
- **`pagedTable` takes plain rows.** A table with a totals row is one `styledTable`, which the
  composer carries over pages itself with its heading repeated.

- **Row heights are estimated, not measured.** `tablePages` counts characters against a column's
  share of the width, assuming text a little wider than it usually is. A page of unusually wide
  text can still run over, and the composer then carries the card onto the next page with no
  title. Name a column in `fittedColumns` only when its cells cannot wrap.
- **The house typeface draws Latin only.** Compose through `composeReadable`, which sets the
  document again in Liberation Sans when the composer reports a character it could not draw.
