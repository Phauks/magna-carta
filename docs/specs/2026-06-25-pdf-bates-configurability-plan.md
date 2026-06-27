# Bates Numbering — Configurability Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Make the Bates stamp's font, label format, and numbering range user-configurable (location and size already are). Extends the built `crates/pdf-core/src/bates.rs`.

**Design home:** `docs/specs/2026-06-23-pdf-bates-numbering-design.md` (Configurability section).

## Global Constraints

- Pure-compute (typed `Result`, no logging, no `unwrap`/`panic` on input data outside tests). No process references. Full names. Changelog/ADR via fragments. The stamp stays an ADDITIVE OVERLAY (never removes content).
- Reuse the baked `standard_fonts_data` width slices + encoding tables; do not duplicate metric data.

## Interfaces produced

```rust
pub enum BatesFont {            // default Helvetica
    Helvetica, HelveticaBold, HelveticaOblique, HelveticaBoldOblique,
    TimesRoman, TimesBold, TimesItalic, TimesBoldItalic,
    Courier, CourierBold, CourierOblique, CourierBoldOblique,
}
impl BatesFont {
    pub(crate) fn postscript_name(self) -> &'static str;  // e.g. "Helvetica-Bold", "Times-Roman", "Courier"
    pub(crate) fn width_table(self) -> &'static [(&'static str, i16)]; // the matching standard_fonts_data slice
}
// BatesOptions gains:  pub font: BatesFont,  pub suffix: String,  pub stop_number: Option<u64>
// BatesError gains:    RangeExceeded
```

---

### Task 1: Configurable font + format + range (engine)

**Files:** modify `crates/pdf-core/src/bates.rs`.

1. **`BatesFont`** enum (12 text fonts above; derive `Debug, Clone, Copy, Default` with `#[default] Helvetica`). `postscript_name()` returns the standard PostScript name (`Helvetica`, `Helvetica-Bold`, `Helvetica-Oblique`, `Helvetica-BoldOblique`, `Times-Roman`, `Times-Bold`, `Times-Italic`, `Times-BoldItalic`, `Courier`, `Courier-Bold`, `Courier-Oblique`, `Courier-BoldOblique`). `width_table()` returns the matching `standard_fonts_data` slice (`HELVETICA`, `HELVETICA_BOLD`, … `COURIER_BOLDOBLIQUE`).
2. **Generalize width measurement:** replace `helvetica_advance(ch)` with `pub(crate) fn font_advance(font: BatesFont, ch: char) -> f32` — `code = ch as u32`; if `< 256`, `name = WIN_ANSI_ENCODING[code]` (all twelve text fonts use WinAnsi here); binary-search `font.width_table()` for the width; else `0.0`. Update `label_width_pt` to `pub(crate) fn label_width_pt(font: BatesFont, label: &str, font_size_pt: f32) -> f32`.
3. **`format_label`** gains a suffix: `pub(crate) fn format_label(prefix: &str, number: u64, padding: u8, suffix: &str) -> String` → `format!("{prefix}{number:0width$}{suffix}")`.
4. **`BatesOptions`** gains `font: BatesFont` (default Helvetica), `suffix: String` (default ""), `stop_number: Option<u64>` (default None). Update the `Default` impl.
5. **`BatesError`** gains `RangeExceeded`.
6. **Wire into `stamp_page`:** the placement width uses `label_width_pt(opts.font, label, opts.font_size_pt)`.
7. **Wire into `stamp_document`:** the shared font object's `/BaseFont` = `opts.font.postscript_name()` (still `/Subtype /Type1` — all twelve are Type1 base fonts). Compute `end = start + page_count - 1`; if `opts.stop_number` is `Some(stop)` and `end > stop` → `Err(BatesError::RangeExceeded)` (checked BEFORE stamping any page). The label for page `i` = `format_label(&opts.prefix, start + i, opts.padding, &opts.suffix)`. `stamp_set` inherits the ceiling per document (each `stamp_document` checks its own `end` against the shared `stop_number`).
8. **Update existing tests** for the changed signatures (`format_label`, `label_width_pt`, the font-advance rename); keep their assertions intact (Helvetica values unchanged).

- [ ] **Step 1: failing tests** (additions):
  - `font_advance_varies_by_font`: Courier `font_advance(Courier, 'A')` = 600 (monospace); Times-Roman `font_advance(TimesRoman, 'A')` = 722; Helvetica still 667. (Confirm against `standard_fonts_data`.)
  - `postscript_names_are_standard`: a couple, e.g. `HelveticaBold.postscript_name() == "Helvetica-Bold"`, `TimesRoman.postscript_name() == "Times-Roman"`.
  - `format_label_with_suffix`: `format_label("ACME-", 42, 6, "-CONF") == "ACME-000042-CONF"`; empty suffix unchanged.
  - `stamp_document_uses_chosen_font`: stamp with `font: Courier`; the document's stamp font object has `/BaseFont /Courier`; render+observe shows the label glyphs.
  - `stop_number_blocks_overflow`: a 3-page doc, `start_number 1`, `stop_number Some(2)` → `Err(BatesError::RangeExceeded)`; with `stop_number Some(3)` → Ok.
- [ ] **Step 2-4:** FAIL → implement → whole crate `cargo test -p pdf-core` green → clippy `-p pdf-core --all-targets -D warnings` + fmt clean.
- [ ] **Step 5:** commit `feat(pdf-core): configurable bates font, suffix, and stop-number ceiling`.

---

### Task 2: Surface the options (wasm/TS) + docs

**Files:** modify `crates/pdf-core/src/wasm.rs`, `packages/pdf/src/index.ts`, `packages/pdf/README.md`, `docs/decisions/pending/pdf-bates-numbering.md`, `changelog.d/pdf-bates.md`.

1. **`wasm.rs` `stamp_bates`:** read `font` (string), `suffix` (string), `stopNumber` (number) from the options. Map the font string → `BatesFont` (`"helvetica"`, `"helvetica-bold"`, `"helvetica-oblique"`, `"helvetica-boldoblique"`, `"times-roman"`, `"times-bold"`, `"times-italic"`, `"times-bolditalic"`, `"courier"`, `"courier-bold"`, `"courier-oblique"`, `"courier-boldoblique"`; unknown/absent → Helvetica). `stopNumber` → `Option<u64>`. Map `BatesError::RangeExceeded` in `From<BatesError> for JsError` → e.g. `"bates numbering exceeds the configured stop number"`.
2. **`index.ts`:** add a `BatesFont` string union (the twelve), extend `BatesStampOptions` with `font?`, `suffix?`, `stopNumber?`; JSDoc each.
3. **`README.md`:** document the new options (font list, suffix, padding=digit count, startNumber, stopNumber ceiling) in the Bates section's options table + a note that font is one of the built-in standard fonts (custom/uploaded fonts not supported in this version).
4. **ADR fragment** `pdf-bates-numbering.md`: add a sentence that font (twelve standard text fonts), label format (prefix/suffix/digit count), start, and a stop ceiling are configurable; custom-font embedding deferred.
5. **changelog fragment** `pdf-bates.md`: note the added configurability; keep the real test count current.

- [ ] **Step 1:** build wasm; extend the JS `stampBates` tests with a `font` + `suffix` + `stopNumber` round-trip (including a `stopNumber` overflow that rejects); run JS tests.
- [ ] **Step 2:** confirm README ↔ index.ts ↔ wasm agree on the font strings + field names; run the process-ref scan.
- [ ] **Step 3:** commit `feat(pdf): expose configurable bates font, suffix, and stop number`.

## Self-Review

- Coverage: font (T1 enum+advance+BaseFont, T2 surface), format/suffix/digits (T1, T2), start/stop (T1 ceiling, T2 surface), location/size already present. Symbol/ZapfDingbats excluded by design. Custom-font embedding deferred.
- Type consistency: `BatesFont` + the three new `BatesOptions` fields + `RangeExceeded` defined in T1, surfaced unchanged in T2.
