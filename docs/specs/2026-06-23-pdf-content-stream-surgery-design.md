# Content-Stream Surgery (Text-Preserving Redaction) — Design

**Status:** Design (feasibility spike GO, commit `e875e66`).
**Branch:** pdf-engine-roadmap (unmerged; combine at the end).
**Predecessor:** the rasterize-and-reassemble redaction (`crates/pdf-core/src/redact.rs`) and the bad-redaction detector (`detect.rs` + `textpos.rs`).

## Goal

Add a second redaction route that excises only the targeted glyphs from a page's
content stream, leaving the rest of the page as live, selectable, searchable text —
instead of flattening the whole page to a 300-DPI image. The caller selects the route
per redaction run via a `mode`; flatten remains the default when unspecified.

The crown property is unchanged: **no output is emitted unless the targeted text is
verifiably gone.** Surgery never relaxes that — it is fail-closed, and any page whose
removal cannot be *confirmed* falls back to the proven image-flatten path.

## The two-route model

`redact()` gains a `RedactionMode`:

- **`Flatten`** (default-when-unspecified): the current behavior, unchanged — each
  affected page is rendered, the redaction rectangles are burned opaque, and the page
  is reassembled as an image XObject. Maximal safety margin: nothing textual remains
  on a redacted page.
- **`Surgery`**: each affected page is attempted as content-stream surgery; any page
  that fails the per-page **surgery gate** is flattened instead (automatic, per-page,
  no caller involvement). "Surgery" therefore means *surgery where provably safe,
  flatten everywhere else* — it is never less safe than flatten, only more useful when
  it succeeds.

Both modes run the identical whole-document scrub (`sanitize_document`) and the
identical hard verification gate (`verify_gate`) before emitting bytes. The mode only
changes how each *affected page's marked regions* are removed.

## Architecture

### Reused substrate

- `textpos::observe_page` — the detector's observing hayro Device. It already yields,
  per glyph, the recovered text, the device/display-space bbox, the paint order, the
  render mode, and the rgba. Surgery consumes the same observation to decide which
  glyphs fall inside a redaction rectangle (exactly as the detector decides which
  glyphs sit under a cover). No new positioning code.
- `redact::redact` / `reassemble_page` / `verify_gate` / `sanitize_document` — the
  fallback path and the document-level scrub + gate, used verbatim.

### New module: `crates/pdf-core/src/surgery.rs`

Pure-compute, typed `Result`, no logging — same conventions as `redact.rs`/`detect.rs`.

Surgery of one page is four stages:

1. **Glyph enumeration over the content stream.** Decode the page content
   (`lopdf::Document::get_page_content` → `lopdf::content::Content::decode`). Walk the
   operations, tracking the text state needed to enumerate glyph code-units in show-text
   operators (`Tj`, `TJ`, `'`, `"`): the active font's bytes-per-code (1 for simple
   fonts, 2 for Type0/CID via the font's codespace — see Boundaries). Each enumerated
   glyph-unit records its **location**: which operation, which operand (and, for `TJ`,
   which array element), and the byte offset/length of its code within that operand's
   string.

2. **Position computation (self-contained, not correlated to hayro).** The same walk
   computes each glyph's display-point position directly, tracking the graphics state
   (CTM via the `q`/`Q`/`cm` stack) and the text state (`Tm`/`Tlm` text matrices, `Tf`
   font+size, `Tc` char-spacing, `Tw` word-spacing, `Tz` horizontal scaling, `TL`,
   `Ts`, `Tr`), advancing the text matrix by each glyph's width (from the font metrics)
   plus spacing. A glyph's display-point center is `CTM ∘ Tm ∘ glyph-origin`, y-flipped
   to the redaction `Rect` frame (reusing the detector's `to_display_rect`). This avoids
   any dependence on matching hayro's draw order — which on legal forms also draws
   widget/AcroForm appearance glyphs that are *not* in the page content stream (the
   spike's consistent `+1` delta). Correlating to hayro would force those pages to fall
   back; computing positions from the page content handles them.

   The walk supports the common text-positioning operators (`BT`/`ET`, `Tm`, `Td`,
   `TD`, `T*`, `Tj`, `TJ`, `'`, `"`, `Tf`, `Tc`, `Tw`, `Tz`, `TL`, `Ts`, `Tr`, `q`,
   `Q`, `cm`). Any page whose state the walk cannot reconstruct — a Type3 font, vertical
   writing mode, a non-`Identity-H/V` Type0 encoding, a font with no usable width
   metrics, or unbalanced `q`/`Q` — does not qualify for surgery and falls back. No
   guess is made that could mis-locate a glyph.

3. **Excision with advance preservation.** For each glyph the detector marks in-rect,
   remove its code bytes from the operand. To keep the surrounding text from shifting,
   replace each removed run's horizontal advance with an equivalent `TJ` numeric
   adjustment, computed from the font's per-glyph widths (`/Widths` for simple fonts,
   descendant `/W` for Type0) and the active text state (font size, `Tz`, `Tc`, `Tw`).
   Removing whole `Tj` operands collapses to an empty show with the compensating
   adjustment; removing some elements of a `TJ` array edits those elements in place.
   Re-encode the edited `Content` and replace the page `/Contents` with the single
   edited stream (the original content streams become orphaned and are dropped by the
   existing `prune_objects()`).

4. **Per-page verification (the surgery gate) — outcome-based, robust to positioning
   bugs.** A page qualifies as surgered only if, after the edit: (a) the content
   round-trips (decode→encode→decode stable); and (b) **re-observing the edited page via
   `observe_page` finds no glyph whose center lies inside any redaction rectangle** —
   the detector's own geometry applied to the surgery output. This is the keystone
   guarantee: it does not depend on the positioning math being perfect or on `ToUnicode`
   being present — it checks the *outcome* directly. If the math mis-located a target
   glyph and failed to remove it, the re-observation still finds it in the rect → gate
   fails → flatten. Under-removal therefore always falls back to the safe image path;
   the only residual failure mode is over-removal (excising a neighbour that should have
   stayed), which is a usability defect, never a confidentiality leak. The whole-document
   `verify_gate` still runs afterward over the assembled document, so a surgered page is
   held to the same final absence guarantee as a flattened one.

### Fallback triggers (each forces this page to flatten, never an error)

- content stream fails to round-trip (e.g. inline images `BI…ID…EI`);
- the walk cannot reconstruct the page's text state (Type3 font, vertical writing,
  non-`Identity-H/V` Type0 encoding, missing width metrics, unbalanced `q`/`Q`, or an
  unsupported positioning operator);
- a marked glyph's location cannot be resolved to editable operand bytes;
- the post-edit re-observation still finds a glyph centre inside a redaction rectangle
  (under-removal not confirmed-clear).

The page count that fell back vs. surgered is reported (see API) so coverage is
observable rather than assumed.

## Self-cross-validation (charter)

Surgery reuses `textpos` as ground-truth positions; the reciprocal check is that the
**detector re-run on a surgered page reports the target text GONE** (no CoveredText,
no OrphanedText for the removed run). This mirrors the existing redaction↔detector
reciprocal and is asserted in tests.

## API surface

### Rust (`crates/pdf-core`)

```rust
pub enum RedactionMode {
    Flatten, // default
    Surgery,
}
// RedactionOptions gains:  pub mode: RedactionMode,   (Default = Flatten)
// RedactionReport gains:   pub pages_surgered: Vec<usize>,  pub pages_flattened: Vec<usize>,
```

`redact()` keeps its signature (`bytes, regions, opts`); `opts.mode` selects the route.
In `Flatten` mode `pages_surgered` is empty and every affected page is in
`pages_flattened` (preserving today's observable behavior). The error type is unchanged;
surgery introduces no new error variant because every surgery failure degrades to
flatten rather than failing the run.

### wasm / TypeScript (`packages/pdf`)

`redactDocument(bytes, regions, options)` gains an optional `mode: "flatten" | "surgery"`
(default `"flatten"`) and returns `pagesSurgered` / `pagesFlattened` alongside the
existing fields. README documents the two routes, the fail-closed fallback, and the
honest boundaries below.

## Boundaries (disclosed; all fail-closed to flatten)

- **Inline images / non-round-tripping content** → that page flattens.
- **Text inside Form XObjects** → unaccounted by the page-level walk; alignment breaks
  → flatten. (Recursing into form streams is a possible later extension, not v1.)
- **Variable-width CID codespaces** → v1 sizes Type0 codes via the font CMap codespace
  ranges where available and otherwise treats the page as non-aligned → flatten. No
  guess is made that could mis-locate a glyph.
- **Rotated / sheared text** → advance preservation uses the text-space metrics; pages
  whose state the mapper cannot reconstruct fall back rather than risk a visible shift.
- **Raster image XObjects overlapping a redaction rectangle** → a redaction rectangle
  that intersects a raster image XObject (e.g. a scanned page) cannot be handled by
  glyph surgery alone: the surgery stream draws only a vector black box, leaving the
  underlying image pixels intact and recoverable. The outcome gate detects image-covers
  whose bounding rect intersects a redaction rect (`is_image` tag added to `CoverMark`)
  and forces those pages to flatten, which rasterizes and permanently overwrites the
  pixels.
- Surgery removes the targeted glyphs' bytes only; the whole-document scrub
  (`sanitize_document`) remains responsible for non-page surfaces, exactly as today.

## Testing

- **Unit (Rust):** glyph enumeration over `Tj`/`TJ`/`'`/`"`; bytes-per-code by font
  subtype; position computation through `Tm`/`Td`/`TJ`/`cm` against hand-computed
  display points; the in-rect marking; single-glyph excision from a `TJ` element with
  advance substitution; whole-`Tj` excision; each fallback trigger (round-trip failure,
  unsupported font, missing widths) forcing `None`; the outcome gate rejecting a page
  where a marked glyph would survive.
- **Integration:** a known fixture redacted in `Surgery` mode → the target word is gone
  by extraction *and* by `observe_page` render, a chosen non-target word survives, and
  the detector re-run reports the target gone (self-cross-check). A page with inline
  images → reported in `pages_flattened`, target still gone.
- **Coverage measurement:** a non-gating eval over the existing corpus
  (`spikes/pdf-engine-eval/corpus`) records surgered-vs-flattened page counts, so the
  real success rate is reported, not claimed.
- **JS:** `redactDocument` with `mode:"surgery"` returns the new fields and the round
  trip frees wasm memory deterministically (existing pattern).

## What this is not (v1)

- Not Form-XObject content recursion (fallback instead).
- Not arbitrary content editing — only removal of detector-marked glyph runs.
- Not a consumer-facing surface — the generalized Tool and in-matter inspection
  surfaces remain a separate, owner-gated step.
