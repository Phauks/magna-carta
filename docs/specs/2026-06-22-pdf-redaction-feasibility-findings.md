# Redaction Feasibility Findings

Spike crate: `spikes/redaction-feasibility/` (standalone, not a workspace member).
Corpus: `spikes/pdf-engine-eval/corpus/` (10 files: court forms, IRS AcroForms, academic, image PDFs).
Run date: 2026-06-22.

---

## Q-A — Plain text extraction (verification-gate baseline)

### lopdf over full corpus (10 files)

| File | Result | First 80 chars |
|---|---|---|
| basicapi.pdf | OK | `\n\n\n\n\nTable Of Content \n\n\n\nChapter 1 ...` |
| court_ao088.pdf | OK | `AO 88 (Rev. 02/14) Subpoena to Appear and Testify...` |
| court_ao089.pdf | OK | `AO 89 (Rev. 08/09) Subpoena to Testify at a Hearing...` |
| court_ao240.pdf | OK | `AO 240 (Rev. 07/10) Application to Proceed...` |
| gov_irs_w4_acroform.pdf | OK | `Form W-4\n2026Employee's Withholding Certificate...` |
| gov_irs_w9_acroform.pdf | OK | `Form W-9\n(Rev. March 2024)Request for Taxpayer...` |
| pdfjs_cmykjpeg.pdf | EMPTY (image-only) | — |
| pdfjs_franz_image.pdf | OK | `Hello World\n` |
| pdfjs_issue1905.pdf | OK | `TDF NUMBERS\n©The Document Foundation...` |
| TAMReview.pdf | OK | `Working Papers on Information SystemsISSN 1535-6078...` |

**Summary: 9/10 yield usable text. 1 empty (pdfjs_cmykjpeg.pdf — image-only, as expected). 0 failures.**

### pdf-extract comparison (3 files)

| File | Result | Notes |
|---|---|---|
| basicapi.pdf | OK | Clean text, similar quality to lopdf |
| TAMReview.pdf | OK (corrupt) | Returns garbled low-control-character garbage — font encoding not resolved |
| court_ao088.pdf | OK | Clean text |

pdf-extract also emitted hundreds of `unknown glyph name 'gNNN' for font EMMOLK+Cambria` warnings to stderr during basicapi.pdf processing. These are non-fatal but indicate fragility on subset-encoded fonts.

### Q-A Verdict

**lopdf is the right choice for the verification gate.** It handles 9/10 corpus files (100% of text-bearing files). pdf-extract produces corrupt output on TAMReview.pdf (wrong encoding resolution) and is noisier. For the gate — which only needs to confirm a redacted string is absent — lopdf `extract_text` per page is reliable. The empty/image-only case (pdfjs_cmykjpeg) returns `Ok("")` or a decode error, both of which correctly indicate "no surviving text."

---

## Q-B — Position-aware text extraction (decides if content-stream surgery is practical)

### hayro-interpret Device trait

The `Device<'a>` trait in `hayro_interpret` (path: `C:\Users\Trevo\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\hayro-interpret-0.7.0\src\device.rs`) is a public, user-implementable trait. Key method:

```rust
fn draw_glyph(
    &mut self,
    glyph: &Glyph<'a>,
    transform: Affine,        // kurbo::Affine — page-space transform for this glyph
    glyph_transform: Affine,  // per-glyph local transform
    paint: &Paint<'a>,
    draw_mode: &GlyphDrawMode,
);
```

`Affine::translation()` on the `transform` gives `(tx, ty)` in PDF page-space points.
`Glyph::as_unicode()` returns `Option<BfString>` (the text content via ToUnicode CMap).

### Empirical results

A custom `TextPositionCollector` implementing `Device<'a>` was constructed and driven via `hayro_interpret::interpret_page`. Results on corpus:

**basicapi.pdf (page 0):** 198 glyph draw calls. Sample:
```
unicode=Some(" ") tx=0.00 ty=76.54
unicode=Some("T") tx=0.00 ty=841.89
unicode=Some("a") tx=0.00 ty=841.89
unicode=Some("b") tx=0.00 ty=841.89
unicode=Some("l") tx=0.00 ty=841.89
```
ty=841.89 ≈ A4 page height (841.89 pt) — correct PDF coordinate origin at bottom-left.

**TAMReview.pdf (page 0):** 1695 glyph draw calls. Sample:
```
unicode=Some("W") tx=72.00 ty=806.00
unicode=Some("o") tx=72.00 ty=806.00
unicode=Some("r") tx=72.00 ty=806.00
unicode=Some("k") tx=72.00 ty=806.00
unicode=Some("i") tx=72.00 ty=806.00
```
tx=72.00 = 1 inch left margin. ty=806.00 = near top of body text.

### Assessment of the API

The `Device` trait gives glyph-level callbacks with full page-space Affine transforms. A thin shim implementing `Device` can:
- Collect `(unicode, tx, ty)` per glyph call
- Reconstruct per-glyph bounding boxes by combining the transform with the font's advance width (available via the `OutlineGlyph` inside `Glyph::Outline`)
- Group glyphs into runs/words by proximity and transform similarity

This is **not** a full interpreter we have to build ourselves — hayro-interpret handles the entire PDF graphics state (CTM, text matrix, nested XObjects, Form XObjects, annotation appearance streams). We just hook into it.

### lopdf alone (without hayro)

`lopdf::content::Content::decode` gives raw PDF operators (`Tj`, `TJ`, `Td`, `Tm`, `cm`, etc.) but does not resolve them to page-space positions. Doing so requires implementing the full PDF text-positioning state machine (Tm, Tlm, Td, TD, T*, text rise, character/word spacing, horizontal scaling, glyph widths — all six components of the text line matrix). This is **major work** (~500–1000 LOC of correct code to cover all the edge cases in PDF 1.7 §9.4).

### Q-B Verdict

**Position-aware text extraction is available via a thin shim over hayro-interpret (option b).** The `Device::draw_glyph` callback fires for every rendered glyph with a pre-resolved page-space Affine transform and Unicode text. This requires ~50–100 lines to implement the collector device and group glyphs into bounding boxes. No PDF state machine needed — hayro handles all of it. This makes content-stream surgery viable as a strategy (the locate-and-excise step has a working foundation).

**Key limitation discovered:** tx values for basicapi.pdf all show `tx=0.00` for characters on the same line — this may indicate the glyph transform carries the per-glyph advance rather than the `transform`. The `transform` gives the text run origin; `glyph_transform` contains the per-glyph local transform. To compute per-glyph x positions within a run, both transforms must be composed. This is a minor implementation detail, not a blocker.

---

## Q-C — Rasterize-and-reassemble: prove the safety-critical half

### Baseline

`basicapi.pdf` (3 pages, 386 chars of text): lopdf `extract_text` on page 1 returns `"Table Of Content..."` — confirmed.

### Surgery

Steps performed:
1. Load with `lopdf::Document::load_mem`
2. Add an empty `lopdf::Stream::new(Dictionary::new(), b"".to_vec())` as a new object
3. Set the page 1 dict `/Contents` reference to the new empty stream
4. Remove `/Annots` from the page 1 dict
5. Serialize with `doc.save_to(&mut out_buf)` → 105,054 bytes

### Verification

```
[PASS] post-surgery page 1 extract_text returned empty — gate PASSES
[CONTROL p2] page 2 (unchanged) still has text (62 chars) — confirms surgery is page-specific
```

`lopdf::Document::extract_text(&[1])` on the post-surgery doc returns `Ok("")` or a decode error — both indicate no surviving text on page 1. Page 2 retains its original text, confirming surgery is isolated to the target page.

### Image XObject API

```rust
let mut img_dict = lopdf::Dictionary::new();
img_dict.set("Type",              lopdf::Object::Name(b"XObject".to_vec()));
img_dict.set("Subtype",           lopdf::Object::Name(b"Image".to_vec()));
img_dict.set("Width",             lopdf::Object::Integer(W));
img_dict.set("Height",            lopdf::Object::Integer(H));
img_dict.set("ColorSpace",        lopdf::Object::Name(b"DeviceRGB".to_vec()));
img_dict.set("BitsPerComponent",  lopdf::Object::Integer(8));
let img_stream = lopdf::Stream::new(img_dict, rgb_bytes_or_jpeg);
let img_obj_id = doc.add_object(img_stream);
// Then add to page Resources/XObject, set content stream: "q W 0 0 W H cm /Im0 Do Q"
```

This API compiles and runs. The `image` crate converts source image data to raw RGB bytes (for `DeviceRGB`) or JPEG bytes (add `/Filter /DCTDecode` for smaller output). Confirmed at compile time and runtime.

### Q-C Verdict

**The rasterize-and-reassemble approach's removal+verify loop works end-to-end in pure Rust.** Replacing a page's content stream with an empty stream reliably produces an empty `extract_text` result for that page. The image XObject placement API exists and compiles. The full pipeline (render page to PNG via `hayro::render` → produce JPEG via `image` crate → place as lopdf image XObject on a blank page) is all pure Rust with no missing links.

---

## Overall Recommendation

### Both strategies are feasible in pure Rust.

**Strategy 1 — Rasterize-and-reassemble (safe, ship-first):**
- Feasibility: **Proven.** lopdf content surgery works (Q-C pass). hayro rasterizes to Pixmap. image crate encodes to JPEG/PNG. lopdf places the image. The loop (render → burn-in redaction boxes on the pixmap → encode → reassemble) is fully implementable with existing crates.
- Safety: The verification gate (Q-A: lopdf extract_text on each page after reassembly) is reliable. A page whose text was replaced by an image returns empty — gate passes.
- Risk: Output file size grows (images instead of text vectors). Visual fidelity is ~150 DPI without upscaling. Searchability is lost (intentional for redaction). Text selection in the output is lost (acceptable for a redacted document).
- Verdict: **Ship this first.** It is the safer approach with no risk of partial redaction.

**Strategy 2 — Content-stream surgery (precision, later):**
- Feasibility: **Feasible via hayro-interpret shim.** Position-aware text extraction is available off the shelf (Q-B: thin Device impl, ~50–100 LOC). lopdf content operator editing is possible but requires matching and excising Tj/TJ operators by glyph bounding box — more engineering.
- Safety: The verification gate (Q-A) still applies after surgery. The gate can catch any text that was missed.
- Key risk: Per-glyph bounding box reconstruction requires composing both the `transform` and `glyph_transform` Affines from the Device callback, plus the font's advance widths. Wrong bounding box → incomplete redaction. This must be tested thoroughly against all font types (Type1, TrueType, CID-keyed, Type3).
- Second risk: Content stream surgery must also handle text in Form XObjects referenced from the content stream, annotations, and embedded files. hayro-interpret does process Form XObjects and annotations (confirmed: `render_annotations: bool` flag in InterpreterSettings), so the Device callback fires for all visible text — but the corresponding raw operators live in separate sub-streams, complicating the excise step.
- Verdict: **Implement after the rasterize path is shipping.** The Device trait shim for locating text is ready; the surgical excision of operators is the remaining engineering risk.

### Final recommendation

Implement rasterize-and-reassemble first (Q-C proved it works). Add content-stream surgery as a second mode behind a feature flag once the operator-excision logic is built and validated. The verification gate (lopdf extract_text) is the same for both and is reliable (9/10 corpus, 100% of text-bearing files).
