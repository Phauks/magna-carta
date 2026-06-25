# PDF engine — bad-redaction detector engine (slice 3a) — design

**Status:** Draft (implementation-grade design) · **Date:** 2026-06-22 · **Owner:** Trevor Goldsmith
**Builds on:** the redaction + scrub engine in `crates/pdf-core` · roadmap [`2026-06-21-rust-pdf-engine-roadmap-design.md`](2026-06-21-rust-pdf-engine-roadmap-design.md)
**Feasibility:** [`2026-06-22-pdf-detector-feasibility-findings.md`](2026-06-22-pdf-detector-feasibility-findings.md) — GO; the flagship covered-text detector recovers hidden text via an observing `Device`.
**ADRs to raise:** `pdf-detector-observing-device` (the observing-Device text-position primitive + the high-recall divergence model).
**Build gates:** redaction + scrub landed on this branch. Backend-only, read-only. The two invocation surfaces (a generalized Tool and in-matter inspection) and the LLM cross-check are **separate consumer specs** — out of scope here.

A bad redaction is **text that is extractable but not legitimately visible** — covered by an opaque box, drawn invisibly, painted the same color as its background, hidden in an off layer, or sitting in document metadata/attachments. This engine scans a PDF and reports those failures as a ranked, human-reviewed `DetectionReport`. It is **high-recall** (errs toward flagging; a missed failed-redaction is a malpractice event) and **never asserts a document is clean** — it reports findings and what it examined.

---

## 1. Scope

**In:**

1. `textpos.rs` — an **observing `hayro_interpret::Device`** that records a page's resolved draw sequence in paint order: every glyph (recovered Unicode text, page-space bbox, draw mode, fill color) and every opaque cover (fill/image bbox, RGBA, order). The shared **text-position primitive** (content-stream surgery will reuse it).
2. `detect.rs` — the detector and the `DetectionReport`. Drives `textpos` per page; runs a structural pass over the lopdf object model; ranks findings by severity.
3. A `detect` mode + smoke in `crates/pdf-eval`.

**Out (named seams, §8):** the two invocation surfaces (Tool + in-matter), the LLM cross-check, content-stream surgery, a pixel-render backstop for partial-opacity covers, per-glyph geometry for OCG-hidden text.

**Read-only.** The detector never mutates the PDF (redaction/scrub mutate; the detector only inspects). Pure compute — bytes in, report out; no logging, no I/O. Compiles to WASM (client) and native (the harness + future server), like the rest of `pdf-core`.

---

## 2. Architecture

```
crates/pdf-core/
  src/textpos.rs   # the observing Device + per-page observation
  src/detect.rs    # the detectors + DetectionReport
  src/lib.rs       # re-export detect (textpos stays pub(crate))
crates/pdf-eval/src/main.rs  # + `detect` mode + smoke
```

```rust
pub fn detect(bytes: Vec<u8>) -> Result<DetectionReport, DetectError>;

pub struct DetectionReport {
    pub findings: Vec<Finding>,         // ranked: highest severity first
    pub summary: SeveritySummary,       // counts per tier
    pub pages_scanned: usize,
    pub glyphs_examined: usize,         // transparency; NOT a "clean" assertion
}
pub struct Finding {
    pub category: Category,
    pub severity: Severity,             // Critical | High | Medium | Low | Info
    pub page: Option<usize>,            // None for document-level (metadata) findings
    pub region: Option<Rect>,           // page-space bbox of the recoverable content
    pub recovered_text: String,         // the leaked text (may be sampled/truncated)
    pub detail: String,                 // human explanation + remediation hint
}
pub enum Category {
    CoveredText, InvisibleText, WhiteoutText,
    RemovableAnnotation, HiddenLayer,
    MetadataLeak, OrphanedText,
}
pub enum DetectError { Parse }
```

`Rect` is the redaction module's display-point rect (reused). **All `region` values are in display points, bottom-left origin — the same frame as `page_size` and the redaction `Rect`** — so a surface can map a finding onto a rendered page or feed it straight to redaction. The detector observes in device space (post `initial_transform`, top-left); the engine converts each observed bbox back to this frame (`pdf_y = page_height − device_y`) before reporting. The report is data only; display, gating, and the LLM cross-check live in the consumer surfaces.

---

## 3. Detection mechanisms

Three mechanisms feed the detectors:

**(a) The observing Device (per page).** Implements `Device`, recording glyphs and covers in paint order. A glyph's page-space bbox is `transform * glyph_transform * outline` (feasibility-confirmed); recovered text is `Glyph::as_unicode()`; cover opacity is `Paint::Color → to_rgba8()[3]`. From this one pass:

- **CoveredText** — a visible (`Fill`/`Stroke`) extractable glyph whose bbox center lies under a *later* opaque cover (`alpha ≥ 250`). Recovered text + region. **Critical.** (Partial-opacity covers, `128 ≤ alpha < 250`, are flagged **Low** — a high-recall judgment call.)
- **InvisibleText** — an extractable glyph drawn in `GlyphDrawMode::Invisible` (Tr 3). The classic OCR-overlay / invisible-text leak. **High.**
- **WhiteoutText** — an extractable glyph whose fill color equals the opaque fill drawn over/under its bbox (same-color concealment), or near-white on a near-white region. **High.**

**(b) Annotation attribution.** `interpret_page` renders page content, then annotations. To attribute a cover to a *removable annotation* (remediation: "delete this annotation to reveal"), the detector drives interpretation in two phases — page operations first, then each annotation appearance separately, tagging the source. A CoveredText whose covering ink comes from an annotation becomes **RemovableAnnotation** (trivially reversible → **Critical**).

**(c) Structural pass (lopdf, document-level).** For text not on any visible page render:

- **HiddenLayer** — read `/OCProperties` (layers inactive by default); parse content-stream operators (`lopdf::content::Content::decode`) for `/OC … BDC … EMC` spans referencing an inactive layer; extract the text operands. Recovered text, page-level region (no per-glyph bbox — a documented boundary). **High.**
- **MetadataLeak** — recoverable text in the Info dictionary, XMP `/Metadata`, the structure tree (`ActualText`/`Alt`), `/Outlines` titles, AcroForm field values, and embedded-file attachments. **Medium** (often benign authoring metadata; the reviewer decides).
- **OrphanedText** — extractable text in stream objects present in the file but not reachable from the page tree (the scrub's prune target). **High** (text in the bytes that no viewer shows).

The structural pass reuses the surface knowledge already encoded in the scrub feature.

---

## 4. Severity & the high-recall contract

Tiers: **Critical** (recoverable text that looks redacted — covered or removable-annotation), **High** (invisible/whiteout/orphaned/hidden-layer), **Medium** (metadata), **Low** (partial-opacity covers and other judgment calls), **Info** (scan statistics). Findings are returned highest-first.

The engine **never returns "clean."** An empty `findings` list with `glyphs_examined` reported means "nothing detected by these mechanisms," not a guarantee. The report's honesty is the product: it states what it examined and what it found, and the documented boundaries (§7) say what it cannot see.

The default category→tier mapping above is the engine's starting point; the exact mapping is a product judgment the owner can tune (and the two surfaces may present differently).

---

## 5. Coordinate & opacity correctness (where the tests concentrate)

- **Per-glyph bbox** = `transform * glyph_transform * outline` — composing both transforms is mandatory (using `transform` alone collapses every glyph to the text-run origin; feasibility-confirmed).
- **Cover bbox** = the fill path transformed to page space, bounding-boxed.
- **Paint order** = Device call order; a cover counts only if it is painted *after* the glyph.
- **Opacity** = `to_rgba8()[3]`; opaque ≥ 250, partial 128–249 (Low), transparent < 128 ignored.
- Glyphs and covers share the same transform pipeline (one interpret pass), so coordinates are directly comparable regardless of the absolute frame.

Each gets a targeted test with a known input → known finding.

---

## 6. Testing

- **Self-cross-check (mandatory):** a properly-redacted document (the redaction feature's own output) yields **zero** findings — its pages are flattened images with no extractable text. The reciprocal of the redaction gate.
- **Flagship (mandatory):** a deliberately-bad redaction (opaque box over still-extractable text) is flagged **CoveredText / Critical**, and the recovered text matches the hidden string.
- **Per-detector fixtures** (built programmatically): invisible text (Tr 3); whiteout (white text on a white fill); a removable black-box annotation over text; an inactive OCG layer containing text; metadata leaks (Info/XMP/bookmark/form value); an orphaned text stream.
- **Selectivity:** a partial cover flags only the covered region, not the page (feasibility-confirmed: 14 findings for a title band vs 155 for a full-page cover).
- **No false positives:** a clean document yields zero CoveredText findings (feasibility-confirmed).
- **Harness:** `pdf-eval detect <pdf>` prints the ranked report; a `detect-smoke` asserts a bad fixture is flagged and a clean fixture is not.

---

## 7. Boundaries (documented honestly)

- Text recoverable only via custom-font glyph codes with **no ToUnicode map** may not yield Unicode (`as_unicode()` returns `None`); the glyph is still located, but the recovered text may be empty.
- **OCG-hidden text** is recovered as text with a page-level region, not a per-glyph bbox (hayro skips inactive-layer draws; the structural path has no geometry).
- Text **rasterized into an image** is pixels, not recoverable text — out of scope (that is what redaction produces, intentionally).
- **Partial-opacity covers** are a recall judgment call, flagged Low rather than ignored or treated as Critical.
- A **pixel-render backstop** (compare the rendered page to the extracted glyphs to catch covers the semantic pass misjudged) is a named seam, not v1 — the semantic paint-order model proved sufficient on the corpus.

---

## 8. Deferred / named seams

- **The two invocation surfaces** — a generalized platform Tool and in-matter PDF inspection — separate consumer specs (client-side WASM by default; privileged bytes stay on device).
- **The LLM cross-check** — send recovered-text findings to the inference layer for a second opinion / classification; consent-gated (the report contains privileged text). Separate spec.
- **Content-stream surgery** — text-preserving redaction, built on the same `textpos` primitive.
- **Pixel-render backstop** for partial-opacity / unusual covers.
- **Per-glyph OCG geometry** (would need a hayro change to force inactive layers visible — a candidate upstream contribution).

## 9. Open items to confirm at build (golden rule 11)

- Confirm the two-phase interpret (page ops, then per-annotation appearance) cleanly attributes annotation-sourced covers.
- Confirm `lopdf::content::Content::decode` exposes the `/OC` BDC operands and the text operands needed for HiddenLayer recovery; confirm `/OCProperties` inactive-layer parsing.
- Confirm `Glyph::Type3` handling (Type3 glyphs are drawing instructions; either recurse into their content or treat the composed origin as the region).
- Confirm whiteout color comparison is robust to color-space conversion (compare via `to_rgba8`).
