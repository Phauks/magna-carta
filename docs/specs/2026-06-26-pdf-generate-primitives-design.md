# PDF Generate Primitives — merge / split / rotate / watermark — Design

**Status:** Design · **Date:** 2026-06-26 · **Owner:** Trevor Goldsmith
**Branch:** pdf-generate-primitives (off merged main)
**Roadmap home:** [`2026-06-21-rust-pdf-engine-roadmap-design.md`](2026-06-21-rust-pdf-engine-roadmap-design.md) — slice 4 (generate / stamp / Bates / watermark / merge / split). Bates shipped; this completes the slice.
**Reuse:** lopdf's merge recipe (`renumber_objects_with` + collect pages/objects + rebuild `/Pages`+`/Catalog`) and rotate recipe (`/Rotate` delta); Bates's overlay machinery (`stamp_page` pattern, `escape_pdf_literal`, the baked standard-font width tables, the non-destructive resource merge) and surgery's `resolve_mediabox`/`resolve_rotate`/`resolve_inherited_resources`.

## Goal

Four document-assembly primitives the firm needs constantly — combine exhibits, pull a page
range, fix a sideways scan, stamp a draft — completing the engine's slice-4 "generate" surface.
All are pure lopdf model or additive-overlay work (no rendering). Engine + WASM binding only;
the Tools UI ships with the rest of the PDF surfaces in the 0·7 cycle.

## The four operations

```rust
// generate.rs — model assembly (no rendering)
pub fn merge(documents: &[&[u8]]) -> Result<Vec<u8>, GenerateError>;
pub fn split(bytes: &[u8], ranges: &[PageRange]) -> Result<Vec<Vec<u8>>, GenerateError>;
pub fn rotate(bytes: &[u8], rotation: Rotation, pages: PageSelection) -> Result<Vec<u8>, GenerateError>;

// watermark.rs — additive text overlay (reuses the Bates overlay layer)
pub fn watermark(bytes: &[u8], opts: &WatermarkOptions) -> Result<Vec<u8>, GenerateError>;

pub struct PageRange { pub start: usize, pub end: usize }   // inclusive, 0-based
pub enum PageSelection { All, Pages(Vec<usize>) }            // 0-based
pub enum Rotation { Cw90, Cw180, Cw270 }                     // relative, clockwise
pub enum GenerateError { Parse, NoPages, PageOutOfRange, EmptyInput, Reassemble }
```

### merge

Concatenate the pages of N input PDFs into one, in order. The lopdf recipe: for each input,
`renumber_objects_with(max_id)` to avoid ID collisions, collect its page objects and all its
objects, then build one fresh `/Pages` tree referencing every page in order under a new
`/Catalog`. Each page keeps its own `/MediaBox`, `/Resources`, `/Rotate`, and content — pages of
different sizes coexist (the "combine exhibits" reality).

**Interactive structure is carried across** (full merge):

- **Outlines / bookmarks** — each input's `/Outlines` tree is rebuilt into one merged outline (one
  top-level node per source document), with every `/Dest` remapped to the renumbered page object.
- **AcroForm fields** — each input's `/AcroForm /Fields` are collected into one merged `/AcroForm`;
  field names are made unique on collision (suffix the later document's fields), the default-resource
  `/DR` dictionaries are merged non-destructively, and `/NeedAppearances` is preserved if any input
  set it. Widget annotations move with their pages.
- **Named destinations** — `/Names /Dests` (and the legacy `/Dests`) are merged, remapped to the
  renumbered pages, with name collisions resolved by suffixing.
- **Dropped (disclosed):** the inputs' document `/Info`/XMP metadata and attachments are not merged —
  the combined document gets fresh, minimal document info (the per-page content, annotations,
  bookmarks, form fields, and destinations are what carry).

### split

Produce one output PDF per requested page range. For each `PageRange`, clone the document, keep
only those pages (rebuild `/Pages` + `/Catalog` over the kept page objects, `prune_objects` to
drop the now-orphaned ones), and serialise. Ranges are inclusive and 0-based; an out-of-range or
inverted range is `PageOutOfRange`. Each output is an independent, valid single-document PDF.

### rotate

Set each selected page's `/Rotate` to `(current + delta) % 360`, normalised to a non-negative
multiple of 90 (the lopdf rotate recipe). `Rotation` is **relative and clockwise** (the intuitive
"turn these pages 90°"), so it composes with a page's existing rotation rather than replacing it.
`PageSelection::All` or an explicit 0-based list; an out-of-range index is `PageOutOfRange`.

### watermark

Stamp an **additive text overlay** — the legal staple, a diagonal "CONFIDENTIAL" / "DRAFT" /
"COPY" across each page — reusing the Bates overlay layer (no rendering; the overlay is selectable
text drawn in a built-in standard font that every viewer supplies). Like Bates it is
**additive — it removes nothing** (use `redact`/`sanitize` to remove content); stated in all docs.

```rust
pub struct WatermarkOptions {
    pub content: WatermarkContent,
    pub opacity: f32,           // 0..1 via an ExtGState /ca (+/CA); default ~0.3
    pub rotation_deg: f32,      // default 45 (diagonal, bottom-left to top-right)
    pub placement: WatermarkPlacement,
}
pub enum WatermarkContent {
    Text { text: String, font: BatesFont, font_size_pt: f32, color: [f32; 3] },  // reuse the 12 baked fonts
    Image { bytes: Vec<u8>, scale: f32 },   // a PNG or JPEG logo; `scale` is a fraction of the page width
}
pub enum WatermarkPlacement { Center, Tiled }   // a single centred mark or a tiled repeat
```

Per page: resolve the effective `/MediaBox` (+ page `/Rotate`) via surgery's resolvers; place the
mark centred (or tiled on a grid), rotated by `rotation_deg`; append — non-destructively merging an
`/ExtGState` for the constant alpha into the page `/Resources` (the Bates resource-merge pattern) —
a `q /GS gs … Q` overlay stream **last** so it draws on top. Shared resources (font, `/ExtGState`,
image XObject) are deduped to one object each per document.

- **Text:** width from the baked standard-font tables; `… BT /<font> <size> Tf <color> <matrix> Tm
  (escaped text) Tj ET …` (the Bates text path, extended to an arbitrary rotation matrix and centring).
- **Image (logo):** the PNG/JPEG is decoded with the `image` crate (already a dependency) and embedded
  as an image XObject — JPEG bytes embed directly via `/DCTDecode`; other formats decode to RGB samples
  Flate-encoded, with an `/SMask` carrying the alpha channel when the source has transparency. Drawn
  via `… q <cm: scale·rotate·translate> /<Im> Do Q`, scaled to `scale × page-width` preserving aspect.

**Boundary (stated):** a full bleed/margin positioning system beyond Center/Tiled is deferred; image
watermarks support PNG and JPEG (the common logo formats).

## WASM binding (`packages/pdf`)

Mirrors the existing async-over-`ensureReady` functions; all client-side (bytes never leave the
process):

```ts
export function mergeDocuments(documents: Uint8Array[]): Promise<{ pdf: Uint8Array }>;
export function splitDocument(
  bytes: Uint8Array,
  ranges: { start: number; end: number }[],
): Promise<{ pdfs: Uint8Array[] }>;
export function rotatePages(
  bytes: Uint8Array,
  rotation: 90 | 180 | 270,
  pages?: number[],
): Promise<{ pdf: Uint8Array }>;
export function watermarkDocument(
  bytes: Uint8Array,
  options: WatermarkOptions,
): Promise<{ pdf: Uint8Array }>;
```

`rotation` is the clockwise degrees (`90|180|270`); omitting `pages` rotates all. `WatermarkOptions`
mirrors the Rust struct with camelCase keys; omitted fields take the documented defaults.

## Boundaries & invariants

- **Pure compute, additive where claimed.** watermark and rotate never remove content; merge/split
  reorganise pages without altering page content. No logging; typed `Result`.
- **Not redaction.** watermark/rotate/merge/split are visible, reversible document operations —
  they do not remove hidden content or metadata. Stated in code docs and the README, pointing to
  `redactDocument`/`sanitizeDocument`.
- **No panics on malformed input** (the crate rule): every fallible lopdf call is handled; an empty
  `documents` list is `EmptyInput`, a document with no pages is `NoPages`.

## Testing

- **Rust unit (`crates/pdf-core`):** merge of two programmatically-built docs → one doc with the
  summed page count, each page's MediaBox preserved, **merged outline has one node per source with
  remapped dests, both inputs' form fields present (collision-renamed), named dests merged**; split a
  3-page doc by ranges → the expected per-range page counts, each output independently loadable
  (hayro + lopdf); rotate composes with an existing `/Rotate` and normalises; **text watermark**
  appends (page count unchanged, original content intact, overlay text present via `textpos`/observe,
  `/ExtGState` alpha set) and is additive; **image watermark** embeds an image XObject (a generated
  PNG with alpha → `/SMask`; a JPEG → `/DCTDecode`) and draws it `Do`, additive. Out-of-range/empty
  inputs hit the typed errors.
- **Binding (`packages/pdf`):** the four wrappers round-trip; outputs load via `loadDocument`.

## Open items to confirm at build (golden rule 11)

1. Re-confirm the lopdf merge API (`renumber_objects_with`, `max_id`, `get_pages`) against 0.41.
2. The watermark rotation matrix + centring math (reuse Bates placement, extended for arbitrary
   angle) — verify the rotated text lands centred on the effective MediaBox under page `/Rotate`.
3. Confirm `prune_objects` drops the right objects on split without severing shared resources.

## Scope (confirmed — full, not lean)

Owner chose the complete scope (build it once, no piecemeal follow-ups): **(a) watermark does text
AND image/logo** (PNG/JPEG via the `image` crate → image XObject); **(b) merge carries interactive
structure** — outlines/bookmarks, AcroForm fields (collision-renamed), and named destinations, all
remapped to the renumbered pages; **(c) split is by explicit page ranges**; **(d) rotate is
relative-clockwise**. The only stated deferrals are the inputs' `/Info`/XMP metadata + attachments
on merge, and a positioning system beyond Center/Tiled on watermark.
