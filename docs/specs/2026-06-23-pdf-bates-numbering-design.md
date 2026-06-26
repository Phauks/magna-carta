# Bates Numbering (v1) — Design

**Status:** Design (feasibility spike GO, commit `008eba2`).
**Branch:** pdf-engine-roadmap (unmerged; combine at the end).
**Predecessor / reuse:** the surgery content-stream + resource infrastructure (`resolve_mediabox`, `resolve_rotate`, `resolve_inherited_resources`, `resolve_dict`) and the baked standard-font metrics (`standard_fonts_data`, `standard_fonts`).

## Goal

Stamp sequential, identifying labels (Bates numbers) onto every page of legal-production
PDFs — the universal discovery pagination/identification standard — with continuous
numbering across a set of documents and an index mapping each document to its Bates range.

A Bates stamp is an **additive overlay** drawn on top of the existing page content. It is
not redaction: it removes nothing and alters no existing content. The label is real,
selectable PDF text (a feature for downstream legal search), drawn in the base-14
Helvetica font — which the spike proved renders natively in our own engine, so no font
embedding is required.

**v1 scope.** Page stamping + continuous set numbering + the Bates index. Merging a set
into a single combined PDF is **explicitly deferred** to a follow-up — it is the fiddliest
piece (cross-document object-graph copy), it is separable (productions frequently keep
per-document files named by their Bates range), and bundling it would bloat this slice.

## Label model

```
prefix: String          // e.g. "SMITH-"  (free text; ( ) \ are escaped when drawn)
number: u64             // the sequential value for a page
padding: u8             // zero-pad width, e.g. 6 -> "000042"
```

The drawn label is `format!("{prefix}{number:0padding$}{suffix}")` → e.g. `SMITH-000042`
or `ACME-000042-CONF`. `prefix`, `suffix`, and the digit count (`padding`) together give
full control of the label string; the number starts at `start_number`.

**Configurability (full user control of font + format + placement + size).**

- **Font** — `font: BatesFont`, one of the twelve standard text fonts (Helvetica, Times,
  Courier × regular/bold/italic/oblique), default Helvetica. All twelve have baked
  advance-width metrics and render natively in the engine (the spike proved base-14
  Helvetica draws without embedding; the same holds for the other standard fonts), so no
  font embedding is required. The label width is measured with the chosen font's metrics
  (not always Helvetica's). Symbol/ZapfDingbats are intentionally excluded — they have no
  ordinary letters/digits and would render a label as symbols. Uploading an arbitrary
  custom font (font-program embedding + subsetting) is a separate, larger future effort.
- **Format** — `prefix`, `suffix`, `padding` (digit count) as above; `start_number` (the
  first number); and an optional `stop_number: Option<u64>` ceiling. If a document (or a
  set) would number past `stop_number`, stamping fails with `BatesError::RangeExceeded`
  rather than overrunning an allocated Bates range (e.g. an allocation of
  `SMITH-000001…000500`). When `stop_number` is `None`, numbering runs to the page count.
- **Placement** — `position` (six corners) + `margin_pt` (already present).
- **Size** — `font_size_pt` (already present).

## Placement

```
enum BatesPosition { BottomRight, BottomLeft, BottomCenter, TopRight, TopLeft, TopCenter }
```

- Default `BottomRight` (the legal convention).
- `margin_pt`: distance from the page edges (default 18 pt = 0.25 inch).
- `font_size_pt`: default 8.0. Color: black (`0 g`).

The label's drawn width is computed from the baked Helvetica advance widths
(`standard_fonts`): `width_pt = (Σ advance(glyph)/1000) * font_size_pt`. This drives
right/center alignment.

**Coordinate math (the careful part).** The label is drawn by a content stream in the
page's *unrotated* user space, but it must land at the chosen *visual* corner after the
viewer applies `/Rotate` and the MediaBox origin. Given the effective MediaBox
`[llx lly urx ury]` (width `W = urx-llx`, height `H = ury-lly`) and a normalized rotation
`r ∈ {0,90,180,270}`:

- Compute the target point and text orientation in the *rendered* (rotated) frame first
  (e.g. BottomRight at `(W_r - margin - width, margin)` where `W_r`/`H_r` are the rendered
  dimensions — swapped when `r` is 90/270).
- Then map that back into unrotated user space by the inverse of the page rotation, and
  offset by `(llx, lly)`. The text matrix `Tm` carries both the translation and, for
  rotated pages, the rotation so the label reads upright on the rendered page.

This is unit-testable in isolation (assert the computed `Tm`/origin for each position × each
`/Rotate` × a non-zero origin), and end-to-end testable by re-observing the stamp's device
position via the hayro device (as the spike does).

## Per-page stamping mechanism

For each page:

1. **Resolve geometry:** effective MediaBox (origin + size) and `/Rotate`, reusing
   `resolve_mediabox` / `resolve_rotate` (parent-chain, cycle-guarded).
2. **Measure** the label width from Helvetica metrics; compute the draw origin + `Tm` per
   the coordinate math above.
3. **Merge the font resource — non-destructively (the spike's key lesson).** Resolve the
   page's *effective* `/Resources` (`resolve_inherited_resources`, dereferencing indirect
   refs). Build the page's own `/Resources` as a shallow clone of the effective dict (its
   entries are mostly references to shared objects — cheap) with a `/Font` subdict that
   includes all existing fonts **plus** one new entry `/MagnaCartaBates` →
   `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`. Set this on the page. This
   makes the page self-contained, never mutates a shared parent, and never overrides
   inherited resources by omission (the Q4 spike failure). The font name `MagnaCartaBates`
   is distinctive to avoid clobbering an existing resource name.
4. **Append the stamp content** as a new stream added to the page `/Contents` (kept as /
   converted to an array, with the stamp last so it draws on top):
   `q BT /MagnaCartaBates <size> Tf 0 g <Tm> Tm (<escaped-label>) Tj ET Q`. The leading
   `q`, absolute `Tm`, and explicit `0 g` make the stamp robust against whatever graphics
   state prior content left. `(`, `)`, `\` in the label are escaped.

The original content stream(s) and resources are untouched except for the additive font
entry and the appended stamp stream — so original rendering is preserved (the end-to-end
test asserts the original glyph set survives, the inverse of the spike's Q4 regression).

## Set-level numbering + index

```rust
struct BatesOptions { prefix: String, start_number: u64, padding: u8,
                      position: BatesPosition, margin_pt: f32, font_size_pt: f32 }
struct BatesRange { start: u64, end: u64, page_count: usize }   // inclusive start..=end

// Stamp every page of one document, numbering from `start`; returns the stamped bytes
// and the range it consumed.
fn stamp_document(bytes: &[u8], opts: &BatesOptions, start: u64)
    -> Result<(Vec<u8>, BatesRange), BatesError>;

// Stamp a sequence of documents with a CONTINUOUS counter; returns each stamped doc
// with its range (the index = these ranges, which the caller maps to document IDs/names).
fn stamp_set(docs: &[Vec<u8>], opts: &BatesOptions)
    -> Result<Vec<(Vec<u8>, BatesRange)>, BatesError>;
```

`BatesError`: `Parse`, `NoPages`, `Reassemble` (typed `Result`, no logging — engine
conventions). `stamp_set` threads `start = opts.start_number`, then `previous.end + 1`.

## API surface

### Rust (`crates/pdf-core/src/bates.rs`)

The functions above, plus the `BatesOptions`/`BatesPosition`/`BatesRange` types, re-exported
from `crate::`.

### wasm / TypeScript (`packages/pdf`)

`stampBates(bytes, options)` → `{ pdf: Uint8Array, start: number, end: number, pageCount: number }`,
where `options` carries `prefix`, `startNumber`, `padding`, `position` (`"bottomRight"` …),
`marginPt`, `fontSizePt`. (A set helper can be a thin JS loop over `stampBates` threading
the counter; v1 wasm exposes the single-document call, which is the primitive.) The README
documents that Bates stamping is an additive overlay, not redaction.

## Boundaries / honesty

- A Bates stamp does not redact and does not modify existing content; it draws over it. If
  the chosen corner overlaps existing page content, the label sits on top (the caller picks
  position/margin). Documented.
- Pages whose geometry cannot be resolved (no MediaBox anywhere) error rather than guess.
- Single-PDF merge of a set is deferred (stated above).
- Non-Helvetica/embedded fonts are irrelevant here — the stamp always uses base-14
  Helvetica, independent of the page's own fonts.

## Testing

- **Unit:** label formatting (prefix + zero-pad); Helvetica width measurement; the
  placement math for each `BatesPosition` × `/Rotate ∈ {0,90,180,270}` × a non-zero
  MediaBox origin (assert the computed origin/`Tm`); label text escaping (`(`, `)`, `\`).
- **Resource merge:** a page with INHERITED or REFERENCED `/Resources` retains all its
  original fonts AND gains `/MagnaCartaBates` (the spike's Q4 failure encoded as a guard).
- **End-to-end (hayro):** stamp a real fixture → re-observe → the original glyph set is
  preserved and the label's glyphs appear at the expected corner (device position checked,
  as the spike does), on plain, rotated, and offset-origin pages.
- **Set:** continuous numbering across multiple documents; `BatesRange`s are contiguous and
  correct.
- **JS:** `stampBates` round-trip returns the range fields and frees wasm memory.

## What this is not (v1)

- Not redaction (additive overlay only).
- Not single-PDF merge of a set (deferred).
- Not from-scratch page generation (slip sheets / cover pages) — a separate future slice;
  no PDF-writer dependency is added here.
