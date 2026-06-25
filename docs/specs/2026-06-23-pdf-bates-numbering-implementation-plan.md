# Bates Numbering (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stamp sequential Bates labels onto every page of legal-production PDFs (additive base-14 Helvetica overlay), with continuous numbering across a document set and a per-document Bates index.

**Architecture:** New `crates/pdf-core/src/bates.rs`. Reuses the surgery infrastructure (`resolve_mediabox`, `resolve_rotate`, `resolve_inherited_resources`, `resolve_dict`) and the baked Helvetica metrics (`standard_fonts_data`). Each page gets a non-destructively merged Helvetica font resource and an appended content stream drawing the label at a rotation/origin-aware corner.

**Tech Stack:** Rust (pdf-core), lopdf 0.41, hayro 0.7 (tests only, to verify the stamp renders at the right corner), wasm-bindgen edge, TypeScript wrapper.

## Global Constraints

- Pure-compute engine: typed `Result`, **no logging**, no `panic!`/`unwrap` on input-derived data outside tests. Same conventions as `surgery.rs`/`redact.rs`.
- **No process references** in source/tests/README/consumer strings (no "ADR", "slice", "Phase", "Task N", "spike", "§"). State reasoning inline or cite a file by path.
- Full identifier names.
- Changelog + ADR via **fragments** (`changelog.d/<slug>.md`, `docs/decisions/pending/<slug>.md`); never hand-edit rendered files.
- A Bates stamp is an ADDITIVE OVERLAY, not redaction — say so in all docs; never imply it removes content.
- Reuse before building: use the existing `resolve_*` helpers; do not duplicate geometry/resource resolution.
- The font name used for the stamp is `MagnaCartaBates` (distinctive, to avoid clobbering an existing `/Font` resource name).

## Interfaces produced

```rust
pub enum BatesPosition { BottomRight, BottomLeft, BottomCenter, TopRight, TopLeft, TopCenter } // Default BottomRight
pub struct BatesOptions {
    pub prefix: String, pub start_number: u64, pub padding: u8,
    pub position: BatesPosition, pub margin_pt: f32, pub font_size_pt: f32,
} // Default: prefix "", start 1, padding 6, BottomRight, margin 18.0, size 8.0
pub struct BatesRange { pub start: u64, pub end: u64, pub page_count: usize } // inclusive
pub enum BatesError { Parse, NoPages, Reassemble }

pub fn stamp_document(bytes: &[u8], opts: &BatesOptions, start: u64) -> Result<(Vec<u8>, BatesRange), BatesError>;
pub fn stamp_set(docs: &[Vec<u8>], opts: &BatesOptions) -> Result<Vec<(Vec<u8>, BatesRange)>, BatesError>;
```

---

### Task 1: Label model — formatting, width, escaping

**Files:** Create `crates/pdf-core/src/bates.rs`; modify `crates/pdf-core/src/lib.rs` (`mod bates;`, re-export the public types/functions).

**Produces:** the types above (define them here, behaviour added in later tasks), and:
```rust
pub(crate) fn format_label(prefix: &str, number: u64, padding: u8) -> String;
pub(crate) fn helvetica_advance(ch: char) -> f32;        // glyph-space/1000 units
pub(crate) fn label_width_pt(label: &str, font_size_pt: f32) -> f32;
pub(crate) fn escape_pdf_literal(s: &str) -> String;     // for ( ) \
```

- `format_label`: `format!("{prefix}{number:0width$}", width = padding as usize)`. e.g. `("SMITH-", 42, 6)` → `"SMITH-000042"`.
- `helvetica_advance`: map `ch as u32` (ASCII/WinAnsi code) → glyph name via `crate::standard_fonts_data::WIN_ANSI_ENCODING[code]`, then binary-search `crate::standard_fonts_data::HELVETICA` (slice is sorted by name) for the width; return `width as f32`; fall back to `0.0` for an unmapped char (code ≥ 256 or empty name or name absent).
- `label_width_pt`: `(Σ helvetica_advance(ch) / 1000.0) * font_size_pt`.
- `escape_pdf_literal`: replace `\` → `\\`, `(` → `\(`, `)` → `\)` (in that order — backslash first).

- [ ] **Step 1: failing tests**
```rust
#[test] fn formats_padded_label() {
    assert_eq!(format_label("SMITH-", 42, 6), "SMITH-000042");
    assert_eq!(format_label("", 7, 4), "0007");
    assert_eq!(format_label("X", 12345, 3), "X12345"); // number wider than padding is not truncated
}
#[test] fn helvetica_widths_match_metrics() {
    // From the baked data: Helvetica 'A' = 667, space = 278, '0' = 556, '-' (hyphen) = 333.
    assert_eq!(helvetica_advance('A'), 667.0);
    assert_eq!(helvetica_advance(' '), 278.0);
    assert_eq!(helvetica_advance('0'), 556.0);
    assert_eq!(helvetica_advance('-'), 333.0);
}
#[test] fn label_width_scales_with_size() {
    // "00" = 2*556 = 1112 glyph units; at 10pt -> 1112/1000*10 = 11.12 pt
    assert!((label_width_pt("00", 10.0) - 11.12).abs() < 0.01);
}
#[test] fn escapes_pdf_literal_specials() {
    assert_eq!(escape_pdf_literal(r"a(b)c\d"), r"a\(b\)c\\d");
}
```
(First confirm the four Helvetica widths against `standard_fonts_data.rs` — adjust the asserted numbers to the real baked values if any differ.)
- [ ] **Step 2:** run `cargo test -p pdf-core bates::` (from `crates/`) — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** PASS; `cargo clippy -p pdf-core --all-targets` + fmt clean (dead-code on the not-yet-used types/functions is expected).
- [ ] **Step 5:** commit `feat(pdf-core): bates label model — formatting, width, escaping`.

---

### Task 2: Per-page stamping — placement, resource merge, content append

**Files:** modify `crates/pdf-core/src/bates.rs`.

**Produces:**
```rust
// Stamp ONE page in place with `label`. Returns Err only on structural impossibility
// (no resolvable MediaBox). Reuses crate::surgery::{resolve_mediabox, resolve_rotate,
// resolve_inherited_resources, resolve_dict} (make them pub(crate) if not already).
pub(crate) fn stamp_page(doc: &mut lopdf::Document, page_id: lopdf::ObjectId,
                         label: &str, opts: &BatesOptions) -> Result<(), BatesError>;
```

**Placement math.** Let the effective MediaBox be `[llx lly urx ury]`, `W = urx-llx`, `H = ury-lly`, rotation `r = resolve_rotate(...).rem_euclid(360)`, margin `m = opts.margin_pt`, size `s = opts.font_size_pt`, label width `w = label_width_pt(label, s)`. Displayed dims `(Wd, Hd) = (W, H)` for `r ∈ {0,180}`, else `(H, W)`. Choose the text origin in the displayed bottom-left frame `(dx, dy)`:
- BottomLeft `(m, m)`, BottomRight `(Wd - m - w, m)`, BottomCenter `((Wd - w)/2, m)`
- TopLeft `(m, Hd - m - s)`, TopRight `(Wd - m - w, Hd - m - s)`, TopCenter `((Wd - w)/2, Hd - m - s)`

The text matrix `Tm = [a b c d e f]` maps text space → user space. The linear part counter-rotates the text so it reads upright on the displayed page:
- `r=0`: `[1,0,0,1]`, user origin `(e,f) = (llx + dx, lly + dy)`
- `r=180`: `[-1,0,0,-1]`, `(e,f) = (llx + W - dx, lly + H - dy)`
- `r=90`: linear `[0,1,-1,0]`; derive `(e,f)` so the displayed `(dx,dy)` lands correctly
- `r=270`: linear `[0,-1,1,0]`; derive `(e,f)` likewise

Derive the `r=90`/`r=270` translations and **verify ALL positions × rotations empirically** (Step-1 tests below render the stamped page via hayro and assert the label's observed glyph device positions fall in the correct corner region of the rendered image). The empirical render check is the correctness gate for the rotation math; the matrix derivation is scaffolding.

**Resource merge (non-destructive — the spike's key lesson).** Resolve the page's effective `/Resources` (`resolve_inherited_resources`, dereferencing indirect refs). Build a shallow clone of that dict; within it, build a `/Font` subdict = clone of the existing `/Font` (deref) **plus** `MagnaCartaBates => << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>` (add the font object, reference it). Set the merged `/Resources` on the PAGE dict (page-level, self-contained — never mutate a shared parent, never drop inherited entries).

**Content append.** Add a stream `q BT /MagnaCartaBates <s> Tf 0 g <a> <b> <c> <d> <e> <f> Tm (<escaped label>) Tj ET Q` (numbers formatted compactly). Read the page `/Contents`: if a single `Reference`, replace with an `Array[old, stamp]`; if an `Array`, push the stamp; the stamp is LAST so it draws on top.

- [ ] **Step 1: failing tests** (build pages programmatically; render + observe to verify the corner — reuse the observing-device pattern from `surgery.rs` tests / `detect.rs`):
  - `stamp_page_preserves_existing_fonts_under_inherited_resources`: a page whose `/Resources` is an INDIRECT REFERENCE containing a font; after `stamp_page`, the page's resolved fonts include BOTH the original font AND `MagnaCartaBates` (encodes the spike's Q4 regression).
  - `stamped_label_renders_at_bottom_right`: build a blank 612×792 page, stamp `BottomRight`; render via hayro + observe; assert the label glyphs are present (recovered text contains the label) and their device x is in the right half and device y in the bottom band of the rendered image.
  - `stamped_label_correct_corner_each_rotation`: for `r ∈ {90,180,270}` with `BottomRight`, the observed label position is in the displayed bottom-right region of the RENDERED (rotated) image. (Compute expected region from the rendered dimensions.)
  - `stamp_appends_not_replaces_content`: a page with existing text → after stamping, the original text glyphs still render AND the label glyphs render (observed count = original + label length).
- [ ] **Step 2-4:** FAIL → implement → PASS; clippy + fmt clean.
- [ ] **Step 5:** commit `feat(pdf-core): stamp a Bates label on a page with rotation-aware placement`.

---

### Task 3: Document and set stamping + index

**Files:** modify `crates/pdf-core/src/bates.rs`.

**Produces:** `stamp_document`, `stamp_set` (signatures above).

- `stamp_document(bytes, opts, start)`: `lopdf::Document::load_mem` (`BatesError::Parse`); collect page ids in page order (`get_pages` → sorted by page number); if empty → `BatesError::NoPages`; for page i (0-based), `label = format_label(&opts.prefix, start + i as u64, opts.padding)`, `stamp_page(...)`; `save_to` (`BatesError::Reassemble`); return `(bytes, BatesRange { start, end: start + n - 1, page_count: n })`.
- `stamp_set(docs, opts)`: thread `next = opts.start_number`; for each doc, `stamp_document(doc, opts, next)`, push the result, `next = range.end + 1`; return the vec.

- [ ] **Step 1: failing tests**
  - `stamp_document_numbers_every_page`: a 2-page doc stamped from 5 → `BatesRange { start:5, end:6, page_count:2 }`; render each page, assert page 0 shows `…00005` and page 1 shows `…00006`.
  - `stamp_set_numbers_continuously`: two docs (2 pages, 3 pages) from start 1 → ranges `{1,2,2}` and `{3,5,3}`.
  - `empty_document_errors`: a doc with no pages → `BatesError::NoPages`.
- [ ] **Step 2-4:** FAIL → implement → PASS; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): bates document and set stamping with continuous numbering`.

---

### Task 4: wasm edge, TypeScript, README, ADR + changelog fragments, ROADMAP/STATUS

**Files:** modify `crates/pdf-core/src/wasm.rs`, `packages/pdf/src/index.ts`, `packages/pdf/README.md`; create `docs/decisions/pending/pdf-bates-numbering.md`, `changelog.d/pdf-bates.md`; modify `ROADMAP.md`, `STATUS.md` (own rows only).

- `wasm.rs`: `#[wasm_bindgen(js_name = stampBates)] pub fn stamp_bates(bytes: Vec<u8>, opts: JsValue) -> Result<JsValue, JsError>` — deserialize `{ prefix?, startNumber?, padding?, position?, marginPt?, fontSizePt? }` (apply defaults), map `position` string (`"bottomRight"` etc.) to `BatesPosition`, call `stamp_document(&bytes, &opts, start_number)`, return `{ pdf: Uint8Array, start, end, pageCount }`.
- `index.ts`: `BatesPosition` string union, `BatesStampOptions` interface, `BatesStampResult` (`{ pdf: Uint8Array; start: number; end: number; pageCount: number }`), and `async function stampBates(bytes, options?)`. JSDoc states it is an additive overlay, not redaction.
- `README.md`: a "Bates numbering" section — what it does (stamp sequential labels), the options, and an explicit note that it is an overlay (adds selectable text on top; does not redact or modify existing content). No process references.
- ADR fragment `pdf-bates-numbering.md` (frontmatter `slug`, `status: Accepted`, `area: Documents`, `date: 2026-06-23`, `summary`): the additive-overlay model, base-14 Helvetica (no embedding), non-destructive resource merge, rotation/origin-aware placement, continuous set numbering, merge-deferred.
- `changelog.d/pdf-bates.md`: concise entry; real test count; note it is an overlay, not redaction.

- [ ] **Step 1:** build wasm (`packages/pdf` build); extend JS tests with a `stampBates` round-trip asserting the result fields + deterministic `free()`; run JS tests.
- [ ] **Step 2:** confirm README ↔ index.ts ↔ wasm agree on `position` strings and field names; run the process-ref scan.
- [ ] **Step 3:** commit `feat(pdf): expose Bates numbering (stampBates) + docs`.

---

## Self-Review

- **Spec coverage:** label model (T1), placement + resource merge + append (T2), document/set numbering + index (T3), bindings + docs (T4). Merge-to-single-PDF and from-scratch generation are explicitly out of v1.
- **Type consistency:** `BatesOptions`/`BatesRange`/`BatesPosition`/`BatesError` defined in T1, used unchanged in T2/T3/T4. `MagnaCartaBates` font name is the single source.
- **No placeholders:** every code task has test code and the real formulas; the rotation translations are derived + empirically gated.
- **Honesty:** overlay-not-redaction stated in the ADR, README, and changelog; merge deferral stated.
