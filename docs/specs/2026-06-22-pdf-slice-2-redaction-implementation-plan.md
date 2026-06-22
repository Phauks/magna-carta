# PDF engine slice 2 — redaction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, defensible PDF redaction (rasterize-and-reassemble + a hard verification gate) to `pdf-core`, exposed as `redactDocument` in `@magna-carta/pdf`.

**Architecture:** A free function `redact(bytes, regions, opts)` that brings **lopdf** into `pdf-core` for the object model: for each page touched by a redaction it renders the page (hayro, slice-1 path), burns opaque black boxes over the regions, replaces the whole page with that flattened image XObject (stripping text/annotations), then runs a `lopdf extract_text` gate that **refuses to emit** if any redacted text survives. Render stays hayro; rewrite is lopdf.

**Tech Stack:** Rust (hayro 0.7, image 0.25, **lopdf 0.41**, wasm-bindgen 0.2), TypeScript (`@magna-carta/pdf`), Vitest.

**Design spec:** [`2026-06-22-pdf-slice-2-redaction-design.md`](2026-06-22-pdf-slice-2-redaction-design.md). **Feasibility:** [`2026-06-22-pdf-redaction-feasibility-findings.md`](2026-06-22-pdf-redaction-feasibility-findings.md).

**Worktree:** execute on the existing `pdf-engine-roadmap` worktree (slice 1 + the spec live here).

## Global Constraints

- Add `lopdf = "0.41"` to `pdf-core` (already a workspace-used version via `pdf-eval`). Pin `hayro = "0.7"`, `image = "0.25"`.
- **Rect convention:** redaction regions are in **rendered-page display points, bottom-left origin** — the same space slice-1 `page_size`/`render_page` produce. This lets hayro's render absorb `/Rotate` and `MediaBox`/`CropBox` origin, so the burn-in is a pure scale + y-flip. (This refines design §5: rotation/origin are handled by leaning on hayro's render, not by reimplementing the PDF transform.)
- **DPI default 300**, lossless **DEFLATE** (`/Filter /FlateDecode`) image. Both configurable via `opts`.
- **The gate is HARD:** on any surviving text, `redact` returns `RedactError::GateFailed` and emits **no PDF**. A mandatory negative test proves the gate can fail.
- `pdf-core` is a pure compute library: typed `Result`, **no logging** (golden rule 4 lives at the consuming Worker).
- **No process references** in code/tests/consumer strings (no `ADR-NNNN`, "slice 2", "spike", "Phase N") — golden rule 13. State reasoning inline or cite a `docs/conventions/` path.
- **No shorthand names** (golden rule 12): `redactDocument`, `RedactionRegion`, etc. ("pdf" allowed.)
- **TDD**: failing test first, watch it fail, minimal implementation, watch it pass, commit.
- **Verified lopdf API:** `Document::load_mem(&[u8]) -> Result<Document>`; `get_pages() -> BTreeMap<u32, ObjectId>` (1-based page number → id); `get_dictionary_mut(id) -> Result<&mut Dictionary>`; `add_object<T: Into<Object>>(t) -> ObjectId`; `Stream::new(Dictionary, Vec<u8>)` + `Stream::compress() -> Result<()>` (sets FlateDecode); `extract_text(&[u32]) -> Result<String>`; `save_to(&mut impl Write) -> Result<()>`; `Dictionary::set`, `Dictionary::remove(&[u8])`; `Object::{Name, Integer, Real, Reference, Array, Dictionary}`.
- **Verified slice-1 API:** `pdf_core::Document::load(Vec<u8>)`; `render_page(index, dpi, false) -> RenderedPage { data: Vec<u8> /*rgba8*/, width: u32, height: u32 }`; `page_size(index) -> PageSize { width_pt, height_pt }`.

---

### Task 1: Redaction types + the rect→pixel mapping

**Files:**
- Create: `crates/pdf-core/src/redact.rs`
- Modify: `crates/pdf-core/src/lib.rs` (add `mod redact; pub use redact::*;`)
- Modify: `crates/pdf-core/Cargo.toml` (add `lopdf = "0.41"`)

**Interfaces:**
- Produces: `Rect { x0, y0, x1, y1: f32 }`; `RedactionRegion { page: usize, rect: Rect, reason: Option<String> }`; `RedactionOptions { dpi: f32, redacted_text: Vec<String> }` with `Default` (dpi 300); `RedactionReport { pages_redacted: Vec<usize>, region_count: usize }`; `RedactionOutcome { pdf: Vec<u8>, report: RedactionReport }`; `enum RedactError { Parse, PageOutOfRange, Render, Reassemble, GateFailed { detail: String } }`; `fn rect_to_pixels(r: &Rect, page_w_pt: f32, page_h_pt: f32, px_w: u32, px_h: u32) -> (u32, u32, u32, u32)`.

- [ ] **Step 1: Add the dependency** — in `crates/pdf-core/Cargo.toml` under `[dependencies]`:

```toml
lopdf = "0.41"
```

- [ ] **Step 2: Write the failing test** — create `crates/pdf-core/src/redact.rs` with only this test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_rect_with_y_flip() {
        // A 612x792 pt page rendered at 1 px/pt (px == pt for the math).
        // Rect at the page's bottom-left corner (PDF y-up) maps to the
        // raster's BOTTOM (image y-down).
        let r = Rect { x0: 0.0, y0: 0.0, x1: 100.0, y1: 50.0 };
        let (x0, y0, x1, y1) = rect_to_pixels(&r, 612.0, 792.0, 612, 792);
        assert_eq!((x0, x1), (0, 100));
        // y-up [0,50] -> image rows [792-50, 792-0] = [742, 792]
        assert_eq!((y0, y1), (742, 792));
    }

    #[test]
    fn scales_by_resolution_and_orders_corners() {
        // 2 px/pt; corners given unordered.
        let r = Rect { x0: 100.0, y0: 100.0, x1: 50.0, y1: 50.0 };
        let (x0, y0, x1, y1) = rect_to_pixels(&r, 100.0, 100.0, 200, 200);
        assert_eq!((x0, x1), (100, 200)); // 50..100 pt * 2
        assert_eq!((y0, y1), (0, 100)); // y-up 50..100 -> top of a 200px raster
    }
}
```

- [ ] **Step 3: Run, verify it fails**

Run: `cargo test -p pdf-core redact`
Expected: FAIL — `Rect` / `rect_to_pixels` not defined.

- [ ] **Step 4: Implement the types + mapping** — prepend to `crates/pdf-core/src/redact.rs`:

```rust
//! Safe redaction: flatten each affected page to a black-boxed image and
//! verify (via text extraction) that no redacted text survives.

/// A rectangle in rendered-page display points, bottom-left origin
/// (the same space `page_size`/`render_page` use).
#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

/// One region to redact on one page (0-based page index).
#[derive(Debug, Clone)]
pub struct RedactionRegion {
    pub page: usize,
    pub rect: Rect,
    pub reason: Option<String>,
}

/// Knobs for a redaction run.
#[derive(Debug, Clone)]
pub struct RedactionOptions {
    /// Raster resolution for the flattened pages. The legal-production standard is 300.
    pub dpi: f32,
    /// If supplied, the gate also asserts these strings are absent document-wide.
    pub redacted_text: Vec<String>,
}

impl Default for RedactionOptions {
    fn default() -> Self {
        Self { dpi: 300.0, redacted_text: Vec::new() }
    }
}

#[derive(Debug, Clone)]
pub struct RedactionReport {
    pub pages_redacted: Vec<usize>,
    pub region_count: usize,
}

#[derive(Debug)]
pub struct RedactionOutcome {
    pub pdf: Vec<u8>,
    pub report: RedactionReport,
}

/// What redaction can fail at. `GateFailed` means text survived — no PDF is emitted.
#[derive(Debug)]
pub enum RedactError {
    Parse,
    PageOutOfRange,
    Render,
    Reassemble,
    GateFailed { detail: String },
}

/// Map a display-point rect to a pixel rect on the rendered raster, applying the
/// y-flip (PDF y-up, bottom-left → image y-down, top-left), corner ordering, and clamping.
pub fn rect_to_pixels(r: &Rect, page_w_pt: f32, page_h_pt: f32, px_w: u32, px_h: u32) -> (u32, u32, u32, u32) {
    let sx = px_w as f32 / page_w_pt;
    let sy = px_h as f32 / page_h_pt;
    let clamp_x = |v: f32| v.clamp(0.0, px_w as f32);
    let clamp_y = |v: f32| v.clamp(0.0, px_h as f32);
    let x0 = clamp_x((r.x0.min(r.x1) * sx).floor()) as u32;
    let x1 = clamp_x((r.x0.max(r.x1) * sx).ceil()) as u32;
    // y-flip: a high PDF-y (near the top) is a low image row.
    let y0 = clamp_y(((page_h_pt - r.y0.max(r.y1)) * sy).floor()) as u32;
    let y1 = clamp_y(((page_h_pt - r.y0.min(r.y1)) * sy).ceil()) as u32;
    (x0, y0, x1, y1)
}
```

- [ ] **Step 5: Wire the module** — add to `crates/pdf-core/src/lib.rs` (after the existing `mod`/`use` lines):

```rust
mod redact;
pub use redact::*;
```

- [ ] **Step 6: Run, verify it passes**

Run: `cargo test -p pdf-core redact`
Expected: PASS (2 tests). Run `cargo clippy -p pdf-core -- -D warnings` — clean.

- [ ] **Step 7: Commit**

```bash
git add crates/pdf-core/Cargo.toml crates/pdf-core/src/redact.rs crates/pdf-core/src/lib.rs
git commit -m "feat(pdf-core): redaction types and display-space rect mapping"
```

---

### Task 2: Render a page and burn in the black boxes

**Files:**
- Modify: `crates/pdf-core/src/redact.rs`
- Test: reuse `crates/pdf-core/tests/fixtures/blank.pdf` (slice-1 fixture: a 612x792 empty white page)

**Interfaces:**
- Consumes: `Rect`, `RedactionRegion`, `RedactError`, `rect_to_pixels` (Task 1); `pdf_core::Document::{load, page_size, render_page}` (slice 1).
- Produces: `fn render_redacted_page(doc: &crate::Document, page: usize, rects: &[Rect], dpi: f32) -> Result<(Vec<u8>, u32, u32), RedactError>` — returns `(rgb_bytes, px_w, px_h)`: the page rendered at `dpi` with opaque black boxes painted over `rects`, as packed RGB8 (alpha dropped).

- [ ] **Step 1: Write the failing test** — append to the `tests` module in `redact.rs`:

```rust
fn blank_doc() -> crate::Document {
    crate::Document::load(include_bytes!("../tests/fixtures/blank.pdf").to_vec()).unwrap()
}

#[test]
fn burns_an_opaque_black_box() {
    let doc = blank_doc();
    // 100x100 pt box near the bottom-left of a 612x792 page, at 72 dpi (1 px/pt).
    let rects = [Rect { x0: 100.0, y0: 100.0, x1: 200.0, y1: 200.0 }];
    let (rgb, w, h) = render_redacted_page(&doc, 0, &rects, 72.0).unwrap();
    assert_eq!((w, h), (612, 792));
    assert_eq!(rgb.len(), (w * h * 3) as usize);
    // A pixel inside the box is black; a corner pixel (outside) is not.
    let at = |x: u32, y: u32| {
        let i = ((y * w + x) * 3) as usize;
        (rgb[i], rgb[i + 1], rgb[i + 2])
    };
    // box pixel: x in [100,200], image-row in [792-200,792-100] = [592,692]
    assert_eq!(at(150, 640), (0, 0, 0));
    assert_ne!(at(5, 5), (0, 0, 0)); // blank page corner is white
}
```

- [ ] **Step 2: Run, verify it fails**

Run: `cargo test -p pdf-core burns_an_opaque_black_box`
Expected: FAIL — `render_redacted_page` not defined.

- [ ] **Step 3: Implement** — add to `redact.rs` (outside the test module):

```rust
use crate::Document;

pub(crate) fn render_redacted_page(
    doc: &Document,
    page: usize,
    rects: &[Rect],
    dpi: f32,
) -> Result<(Vec<u8>, u32, u32), RedactError> {
    let size = doc.page_size(page).map_err(|_| RedactError::PageOutOfRange)?;
    let rendered = doc.render_page(page, dpi, false).map_err(|_| RedactError::Render)?;
    let (w, h) = (rendered.width, rendered.height);
    let mut rgba = rendered.data; // RGBA8, row-major

    for r in rects {
        let (x0, y0, x1, y1) = rect_to_pixels(r, size.width_pt, size.height_pt, w, h);
        for y in y0..y1 {
            for x in x0..x1 {
                let i = ((y * w + x) * 4) as usize;
                rgba[i] = 0;
                rgba[i + 1] = 0;
                rgba[i + 2] = 0;
                rgba[i + 3] = 255;
            }
        }
    }

    // Pack to RGB8 for a DeviceRGB image XObject.
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for px in rgba.chunks_exact(4) {
        rgb.extend_from_slice(&px[..3]);
    }
    Ok((rgb, w, h))
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `cargo test -p pdf-core burns_an_opaque_black_box`
Expected: PASS. Run `cargo clippy -p pdf-core -- -D warnings` — clean.

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/redact.rs
git commit -m "feat(pdf-core): render a page with burned-in redaction boxes"
```

---

### Task 3: Reassemble a page as a flattened image (lopdf)

**Files:**
- Modify: `crates/pdf-core/src/redact.rs`
- Create: `crates/pdf-core/tests/fixtures/hello.pdf` (copy of `spikes/pdf-engine-eval/corpus/pdfjs_franz_image.pdf` — 2.8 KB, pdf.js Apache-2.0, extractable text "Hello World")

**Interfaces:**
- Consumes: `RedactError` (Task 1).
- Produces: `fn reassemble_page(doc: &mut lopdf::Document, page_id: lopdf::ObjectId, rgb: &[u8], px_w: u32, px_h: u32, page_w_pt: f32, page_h_pt: f32) -> Result<(), RedactError>` — replaces the page's content with a single full-`MediaBox` DEFLATE image XObject, sets the MediaBox to the display size, zeroes `/Rotate`, and removes `/Annots`.

- [ ] **Step 1: Add the fixture**

```bash
cp spikes/pdf-engine-eval/corpus/pdfjs_franz_image.pdf crates/pdf-core/tests/fixtures/hello.pdf
```

- [ ] **Step 2: Write the failing test** — append to the `tests` module:

```rust
fn hello_bytes() -> Vec<u8> {
    include_bytes!("../tests/fixtures/hello.pdf").to_vec()
}

#[test]
fn reassemble_removes_text_and_places_image() {
    let mut lo = lopdf::Document::load_mem(&hello_bytes()).unwrap();
    // sanity: the original page 1 has extractable text
    assert!(lo.extract_text(&[1]).unwrap_or_default().contains("Hello"));

    let page_id = *lo.get_pages().get(&1).unwrap();
    let rgb = vec![0u8; (10 * 10 * 3) as usize]; // a tiny dummy raster
    reassemble_page(&mut lo, page_id, &rgb, 10, 10, 200.0, 200.0).unwrap();

    let mut out = Vec::new();
    lo.save_to(&mut out).unwrap();
    let reloaded = lopdf::Document::load_mem(&out).unwrap();
    // the page is now an image — no extractable text survives
    assert!(reloaded.extract_text(&[1]).unwrap_or_default().trim().is_empty());
}
```

- [ ] **Step 3: Run, verify it fails**

Run: `cargo test -p pdf-core reassemble_removes_text_and_places_image`
Expected: FAIL — `reassemble_page` not defined.

- [ ] **Step 4: Implement** — add to `redact.rs`:

```rust
use lopdf::{Dictionary, Object, Stream};

pub(crate) fn reassemble_page(
    doc: &mut lopdf::Document,
    page_id: lopdf::ObjectId,
    rgb: &[u8],
    px_w: u32,
    px_h: u32,
    page_w_pt: f32,
    page_h_pt: f32,
) -> Result<(), RedactError> {
    let mut img_dict = Dictionary::new();
    img_dict.set("Type", Object::Name(b"XObject".to_vec()));
    img_dict.set("Subtype", Object::Name(b"Image".to_vec()));
    img_dict.set("Width", Object::Integer(px_w as i64));
    img_dict.set("Height", Object::Integer(px_h as i64));
    img_dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
    img_dict.set("BitsPerComponent", Object::Integer(8));
    let mut img_stream = Stream::new(img_dict, rgb.to_vec());
    img_stream.compress().map_err(|_| RedactError::Reassemble)?; // FlateDecode (lossless)
    let img_id = doc.add_object(img_stream);

    // Draw the image across the full MediaBox.
    let content = format!("q {page_w_pt} 0 0 {page_h_pt} 0 0 cm /Im0 Do Q");
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));

    let mut xobjects = Dictionary::new();
    xobjects.set("Im0", Object::Reference(img_id));
    let mut resources = Dictionary::new();
    resources.set("XObject", Object::Dictionary(xobjects));

    let page = doc.get_dictionary_mut(page_id).map_err(|_| RedactError::Reassemble)?;
    page.set("Contents", Object::Reference(content_id));
    page.set("Resources", Object::Dictionary(resources));
    page.set(
        "MediaBox",
        Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(page_w_pt),
            Object::Real(page_h_pt),
        ]),
    );
    page.set("Rotate", Object::Integer(0));
    page.remove(b"Annots");
    Ok(())
}
```

- [ ] **Step 5: Run, verify it passes**

Run: `cargo test -p pdf-core reassemble_removes_text_and_places_image`
Expected: PASS. Run `cargo clippy -p pdf-core -- -D warnings` — clean.

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-core/src/redact.rs crates/pdf-core/tests/fixtures/hello.pdf
git commit -m "feat(pdf-core): reassemble a page as a flattened DEFLATE image"
```

---

### Task 4: The verification gate + the `redact` orchestration

**Files:**
- Modify: `crates/pdf-core/src/redact.rs`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `pub fn redact(bytes: Vec<u8>, regions: &[RedactionRegion], opts: &RedactionOptions) -> Result<RedactionOutcome, RedactError>`; `pub(crate) fn verify_gate(doc: &lopdf::Document, affected_pages_1based: &[u32], redacted_text: &[String]) -> Result<(), RedactError>`.

- [ ] **Step 1: Write the failing tests** — append to the `tests` module:

```rust
#[test]
fn redact_removes_target_text_and_passes_gate() {
    let regions = [RedactionRegion {
        page: 0,
        rect: Rect { x0: 0.0, y0: 0.0, x1: 1000.0, y1: 1000.0 }, // cover the whole page
        reason: Some("PII".into()),
    }];
    let opts = RedactionOptions { dpi: 150.0, redacted_text: vec!["Hello".into()] };
    let outcome = redact(hello_bytes(), &regions, &opts).expect("redaction succeeds");
    assert_eq!(outcome.report.pages_redacted, vec![0]);
    // the redacted text is gone from the emitted PDF
    let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
    assert!(!reloaded.extract_text(&[1]).unwrap_or_default().contains("Hello"));
}

#[test]
fn gate_fails_when_text_survives() {
    // The gate run against a doc that STILL has the text must fail — proving
    // the gate is not a no-op.
    let lo = lopdf::Document::load_mem(&hello_bytes()).unwrap();
    let result = verify_gate(&lo, &[1], &["Hello".into()]);
    assert!(matches!(result, Err(RedactError::GateFailed { .. })));
}
```

- [ ] **Step 2: Run, verify they fail**

Run: `cargo test -p pdf-core redact_removes_target_text_and_passes_gate gate_fails_when_text_survives`
Expected: FAIL — `redact` / `verify_gate` not defined.

- [ ] **Step 3: Implement** — add to `redact.rs`:

```rust
use std::collections::BTreeMap;

pub(crate) fn verify_gate(
    doc: &lopdf::Document,
    affected_pages_1based: &[u32],
    redacted_text: &[String],
) -> Result<(), RedactError> {
    // Structural: each affected page must now be text-free (it is an image).
    for &p in affected_pages_1based {
        let text = doc.extract_text(&[p]).unwrap_or_default();
        if !text.trim().is_empty() {
            return Err(RedactError::GateFailed {
                detail: format!("page {p} still has extractable text"),
            });
        }
    }
    // Content: supplied strings must be absent document-wide.
    if !redacted_text.is_empty() {
        let all: Vec<u32> = doc.get_pages().keys().copied().collect();
        let whole = doc.extract_text(&all).unwrap_or_default();
        for s in redacted_text {
            if !s.is_empty() && whole.contains(s.as_str()) {
                return Err(RedactError::GateFailed {
                    detail: format!("redacted text still present: {s}"),
                });
            }
        }
    }
    Ok(())
}

pub fn redact(
    bytes: Vec<u8>,
    regions: &[RedactionRegion],
    opts: &RedactionOptions,
) -> Result<RedactionOutcome, RedactError> {
    // Group regions by 0-based page index.
    let mut by_page: BTreeMap<usize, Vec<Rect>> = BTreeMap::new();
    for region in regions {
        by_page.entry(region.page).or_default().push(region.rect);
    }

    let render_doc = Document::load(bytes.clone())?; // hayro, for rendering
    let mut lo = lopdf::Document::load_mem(&bytes).map_err(|_| RedactError::Parse)?;
    let pages = lo.get_pages(); // 1-based number -> ObjectId

    let mut redacted: Vec<usize> = Vec::new();
    for (&page, rects) in &by_page {
        let size = render_doc.page_size(page).map_err(|_| RedactError::PageOutOfRange)?;
        let (rgb, w, h) = render_redacted_page(&render_doc, page, rects, opts.dpi)?;
        let page_id = *pages
            .get(&((page + 1) as u32))
            .ok_or(RedactError::PageOutOfRange)?;
        reassemble_page(&mut lo, page_id, &rgb, w, h, size.width_pt, size.height_pt)?;
        redacted.push(page);
    }

    let affected_1based: Vec<u32> = redacted.iter().map(|p| (*p + 1) as u32).collect();
    verify_gate(&lo, &affected_1based, &opts.redacted_text)?;

    let mut pdf = Vec::new();
    lo.save_to(&mut pdf).map_err(|_| RedactError::Reassemble)?;
    Ok(RedactionOutcome {
        report: RedactionReport { pages_redacted: redacted, region_count: regions.len() },
        pdf,
    })
}
```

- [ ] **Step 4: Run, verify they pass**

Run: `cargo test -p pdf-core` (the whole crate)
Expected: PASS (all redaction tests + the slice-1 tests). Run `cargo clippy -p pdf-core -- -D warnings` — clean.

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/redact.rs
git commit -m "feat(pdf-core): redaction orchestration with a hard verification gate"
```

---

### Task 5: WASM edge + `@magna-carta/pdf` wrapper

**Files:**
- Modify: `crates/pdf-core/src/wasm.rs`
- Modify: `packages/pdf/src/index.ts`
- Test: `packages/pdf/test/redact.test.ts`

**Interfaces:**
- Consumes: `redact`, the redaction types (Task 1–4).
- Produces (JS): `redactDocument(bytes: Uint8Array, regions: RedactionRegion[], opts?: { dpi?: number; redactedText?: string[] }): { pdf: Uint8Array; pagesRedacted: number[] }`; `RedactionRegion = { page: number; rect: { x0; y0; x1; y1 }; reason?: string }`.

- [ ] **Step 1: Write the wasm edge** — add to `crates/pdf-core/src/wasm.rs`:

```rust
use crate::{redact, Rect, RedactionOptions, RedactionRegion};

impl From<crate::RedactError> for JsError {
    fn from(e: crate::RedactError) -> Self {
        match e {
            crate::RedactError::Parse => JsError::new("failed to parse PDF"),
            crate::RedactError::PageOutOfRange => JsError::new("page index out of range"),
            crate::RedactError::Render => JsError::new("failed to render page"),
            crate::RedactError::Reassemble => JsError::new("failed to reassemble PDF"),
            crate::RedactError::GateFailed { detail } => {
                JsError::new(&format!("redaction verification failed: {detail}"))
            }
        }
    }
}

#[wasm_bindgen(js_name = redactDocument)]
pub fn redact_document(bytes: Vec<u8>, regions: JsValue, opts: JsValue) -> Result<JsValue, JsError> {
    #[derive(serde::Deserialize)]
    struct JsRect { x0: f32, y0: f32, x1: f32, y1: f32 }
    #[derive(serde::Deserialize)]
    struct JsRegion { page: usize, rect: JsRect, #[serde(default)] reason: Option<String> }
    #[derive(serde::Deserialize, Default)]
    struct JsOpts { dpi: Option<f32>, #[serde(rename = "redactedText", default)] redacted_text: Vec<String> }

    let js_regions: Vec<JsRegion> = serde_wasm_bindgen::from_value(regions)?;
    let js_opts: JsOpts = if opts.is_undefined() || opts.is_null() {
        JsOpts::default()
    } else {
        serde_wasm_bindgen::from_value(opts)?
    };

    let regions: Vec<RedactionRegion> = js_regions
        .into_iter()
        .map(|r| RedactionRegion {
            page: r.page,
            rect: Rect { x0: r.rect.x0, y0: r.rect.y0, x1: r.rect.x1, y1: r.rect.y1 },
            reason: r.reason,
        })
        .collect();
    let options = RedactionOptions {
        dpi: js_opts.dpi.unwrap_or(300.0),
        redacted_text: js_opts.redacted_text,
    };

    let outcome = redact(bytes, &regions, &options)?;

    let result = js_sys::Object::new();
    js_sys::Reflect::set(&result, &"pdf".into(), &js_sys::Uint8Array::from(&outcome.pdf[..]))?;
    let pages = js_sys::Array::new();
    for p in outcome.report.pages_redacted {
        pages.push(&JsValue::from(p as u32));
    }
    js_sys::Reflect::set(&result, &"pagesRedacted".into(), &pages)?;
    Ok(result.into())
}
```

- [ ] **Step 2: Add the wasm deps** — in `crates/pdf-core/Cargo.toml` under `[target.'cfg(target_arch = "wasm32")'.dependencies]`:

```toml
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"
js-sys = "0.3"
```

- [ ] **Step 3: Build the wasm to verify it compiles**

Run: `cargo build -p pdf-core --target wasm32-unknown-unknown`
Expected: compiles. (Native is unaffected — the module is cfg-gated.) If `serde` derive is needed on the native path too, it is not — these types stay in `wasm.rs`.

- [ ] **Step 4: Add the TS wrapper** — append to `packages/pdf/src/index.ts`:

```ts
export interface RedactionRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RedactionRegion {
  page: number;
  rect: RedactionRect;
  reason?: string;
}

export interface RedactionOptions {
  /** Raster resolution for flattened pages. Defaults to 300 (the legal-production standard). */
  dpi?: number;
  /** If supplied, redaction also verifies these strings are absent from the output. */
  redactedText?: string[];
}

export interface RedactionResult {
  pdf: Uint8Array;
  pagesRedacted: number[];
}

import { redactDocument as wasmRedact } from "./pkg/pdf_core.js";

/**
 * Redact regions from a PDF by flattening each affected page to an image with
 * opaque boxes, then verifying no redacted text survives. Throws if the
 * verification gate fails (no unsafe PDF is ever returned).
 */
export async function redactDocument(
  bytes: Uint8Array,
  regions: RedactionRegion[],
  opts: RedactionOptions = {},
): Promise<RedactionResult> {
  await ensureReady();
  return wasmRedact(bytes, regions, opts) as RedactionResult;
}
```

(`ensureReady` already exists in `index.ts` from slice 1 and is used by the Node test path; reuse it. **Confirm it is `export`ed** — the redaction test imports it to prime the wasm under Node, exactly as the slice-1 render test does. If it is not exported, add `export` to its declaration.)

- [ ] **Step 5: Write the failing JS test** — create `packages/pdf/test/redact.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, redactDocument, loadDocument } from "../src/index.js";

const hello = new Uint8Array(
  readFileSync(fileURLToPath(new URL("./fixtures/hello.pdf", import.meta.url))),
);

describe("redactDocument", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("redacts a region and removes the target text", async () => {
    const result = await redactDocument(
      hello,
      [{ page: 0, rect: { x0: 0, y0: 0, x1: 1000, y1: 1000 }, reason: "PII" }],
      { dpi: 150, redactedText: ["Hello"] },
    );
    expect(result.pagesRedacted).toEqual([0]);
    // the output still loads and renders
    const doc = await loadDocument(result.pdf);
    expect(doc.pageCount).toBeGreaterThanOrEqual(1);
    doc.free();
  });

  it("throws if the gate would fail (e.g. an out-of-range page)", async () => {
    await expect(
      redactDocument(hello, [{ page: 99, rect: { x0: 0, y0: 0, x1: 10, y1: 10 } }]),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Copy the fixture, build wasm, run the test**

```bash
cp crates/pdf-core/tests/fixtures/hello.pdf packages/pdf/test/fixtures/hello.pdf
pnpm --filter @magna-carta/pdf run build:wasm
pnpm --filter @magna-carta/pdf test
```
Expected: PASS (the slice-1 tests + the 2 new redaction tests). If `ensureReady` does not already accept an optional wasm-bytes argument, it does (added in slice 1 for Node).

- [ ] **Step 7: Commit**

```bash
git add crates/pdf-core/src/wasm.rs crates/pdf-core/Cargo.toml packages/pdf/src/index.ts packages/pdf/test/redact.test.ts packages/pdf/test/fixtures/hello.pdf
git commit -m "feat(pdf): redactDocument wasm edge and typed wrapper"
```

---

### Task 6: `pdf-eval` redact mode + smoke + docs

**Files:**
- Modify: `crates/pdf-eval/src/main.rs`
- Create: `packages/pdf/README.md` redaction section (append)
- Create: `docs/decisions/pending/pdf-redaction-rasterize-route.md`
- Create: `changelog.d/pdf-redaction.md`
- Modify: `ROADMAP.md`, `STATUS.md` (own slice row only)

**Interfaces:**
- Consumes: `pdf_core::{redact, RedactionRegion, RedactionOptions, Rect}`.
- Produces: a `pdf-eval redact <pdf> <out> --page N --rect x0,y0,x1,y1 [--dpi 300]` mode and a `redact-smoke <pdf>` that redacts a full page and asserts the gate passes.

- [ ] **Step 1: Add the redact + redact-smoke modes** — in `crates/pdf-eval/src/main.rs`, add to the `match` in `main()`:

```rust
Some("redact-smoke") => redact_smoke_mode(args.next().expect("usage: redact-smoke <pdf>")),
```

and add the function (ungated — uses only `pdf-core`, no pdfium):

```rust
fn redact_smoke_mode(path: String) {
    let bytes = std::fs::read(&path).unwrap();
    // Redact the entire first page; the gate must pass (the page becomes an image).
    let regions = [pdf_core::RedactionRegion {
        page: 0,
        rect: pdf_core::Rect { x0: 0.0, y0: 0.0, x1: 100_000.0, y1: 100_000.0 },
        reason: None,
    }];
    match pdf_core::redact(bytes, &regions, &pdf_core::RedactionOptions::default()) {
        Ok(outcome) => {
            println!("ok   redacted page(s) {:?}, {} bytes", outcome.report.pages_redacted, outcome.pdf.len());
        }
        Err(e) => {
            eprintln!("FAIL redaction gate: {e:?}");
            std::process::exit(1);
        }
    }
}
```

- [ ] **Step 2: Verify the smoke passes on a corpus file**

Run: `cargo run -p pdf-eval --release -- redact-smoke crates/pdf-eval/corpus-ci/basicapi.pdf`
Expected: `ok redacted page(s) [0], N bytes`, exit 0. Run `cargo clippy -p pdf-eval -- -D warnings` — clean.

- [ ] **Step 3: Add a redaction CI smoke step** — in `.github/workflows/ci.yml`, in the `rust-pdf-core` job after the existing `smoke` step:

```yaml
      - run: cargo run --manifest-path crates/Cargo.toml -p pdf-eval --release -- redact-smoke crates/pdf-eval/corpus-ci/basicapi.pdf
```

- [ ] **Step 4: Write the docs**
  - Append a "Redaction" section to `packages/pdf/README.md`: `redactDocument(bytes, regions, opts)`, the display-space rect convention, the DPI-300 default, and the **hard-gate** behavior (throws on survival, never returns an unsafe PDF). NO process references.
  - Create `docs/decisions/pending/pdf-redaction-rasterize-route.md` (match the existing fragment frontmatter; record: rasterize-and-reassemble chosen for safety-by-construction, the hard `extract_text` verification gate, surgery deferred to the text-position-primitive slice).
  - Create `changelog.d/pdf-redaction.md` (match the existing format; `category: Added`).
  - Add an additive row/bullet to `ROADMAP.md` and `STATUS.md` for slice 2 (do not modify other rows).

- [ ] **Step 5: Verify the gates locally**

Run: `cargo test -p pdf-core && cargo clippy --all-targets -- -D warnings && cargo fmt --all --check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-eval/src/main.rs .github/workflows/ci.yml packages/pdf/README.md docs/decisions/pending/pdf-redaction-rasterize-route.md changelog.d/pdf-redaction.md ROADMAP.md STATUS.md
git commit -m "feat(pdf-eval): redaction smoke gate, CI, and docs"
```

---

## Self-Review

**Spec coverage:** §1 lopdf-in-pdf-core (T1) · the `redact` op (T1–4) · the verification gate, structural + content + hard-refuse (T4) · the negative gate test (T4) · WASM + `redactDocument` (T5) · `pdf-eval` redact mode + smoke (T6). §3 operation = render+burn (T2) + reassemble (T3). §4 gate = T4. §5 coordinate correctness = T1 `rect_to_pixels` (display-space refinement, see Global Constraints) + the burn test (T2). §6 WASM surface = T5. §7 testing: happy path (T4/T5), negative gate (T4), burn/pixel (T2), reassemble removal (T3), smoke (T6). §8 deferred = untouched. ADR = T6.

**Placeholder scan:** every code step shows complete code; the two "if `ensureReady` already accepts…" notes reference a slice-1 fact (it does), not a blank.

**Type consistency:** `Rect`/`RedactionRegion`/`RedactionOptions`/`RedactionOutcome`/`RedactError`/`rect_to_pixels` defined in T1 and consumed unchanged in T2–6; `render_redacted_page` (T2) → `reassemble_page` (T3) → `redact`/`verify_gate` (T4) signatures match across tasks; JS `redactDocument(bytes, regions, opts)` (T5) matches the wasm export name.

**Refinement noted vs the spec:** the design §5 lists `/Rotate` + `MediaBox`-origin handling in the rect math; this plan instead pins regions to **rendered display space** so hayro's render absorbs both — a cleaner, lower-risk realization of the same correctness goal. The negative-gate requirement and the hard-refuse semantics are implemented exactly as specified.
