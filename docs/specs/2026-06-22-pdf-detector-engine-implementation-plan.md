# PDF engine — bad-redaction detector engine (slice 3a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only, pure-Rust `detect(bytes) -> DetectionReport` in `pdf-core` that scans a PDF and flags failed redactions (recoverable text that is covered, invisible, whitened-out, in metadata, or orphaned), ranked by severity, exposed as `detectDocument` in `@magna-carta/pdf`.

**Architecture:** An observing `hayro_interpret::Device` (`textpos.rs`) records each page's resolved draw sequence (glyphs with recovered text + page-space bbox; opaque covers with bbox + alpha + paint order). `detect.rs` runs geometric detectors over that observation and structural detectors over the lopdf object model, then assembles a ranked `DetectionReport`. Read-only — the detector never mutates the PDF.

**Tech Stack:** Rust (hayro 0.7, **kurbo 0.13**, lopdf 0.41, image 0.25, wasm-bindgen 0.2), TypeScript (`@magna-carta/pdf`), Vitest.

**Design spec:** [`2026-06-22-pdf-detector-engine-design.md`](2026-06-22-pdf-detector-engine-design.md). **Feasibility (GO):** [`2026-06-22-pdf-detector-feasibility-findings.md`](2026-06-22-pdf-detector-feasibility-findings.md) — the covered-text mechanism is spike-proven; the spike source is `spikes/detector-feasibility/`.

**Scope note.** This plan implements 5 of the spec's 7 detectors — the spike-proven geometric ones (CoveredText, InvisibleText, WhiteoutText) and the scrub-reuse structural ones (MetadataLeak, OrphanedText). **RemovableAnnotation** (needs a two-phase interpret) and **HiddenLayer** (needs an optional-content content-operator scan) are a named fast-follow (slice 3a-ii), gated on their own mini-spike — do not implement them here.

**Worktree:** execute on the existing `pdf-engine-roadmap` worktree.

## Global Constraints

- Add `kurbo = "0.13"` to `pdf-core` (matches hayro's resolved 0.13.1). Keep `lopdf 0.41`, `hayro 0.7`.
- `pdf-core` is pure compute: typed `Result`, **no logging**, no happy-path panics. The detector is **read-only** (never mutates or emits a PDF).
- **No process references** in code/tests/consumer strings (no `ADR-NNNN`, "slice N", "Phase N", "spike") — golden rule 13. The `spikes/` directory name is a path, not a code reference; do not cite it in `crates/`/`packages/` source.
- **No shorthand names** (golden rule 12): `DetectionReport`, `recovered_text`, etc. ("pdf", "bbox", "rgba", "OCG", "id" accepted).
- **High-recall, never "clean":** an empty `findings` list means "nothing detected," not a guarantee. Findings ranked highest-severity first.
- **TDD**: failing test first, watch it fail, minimal implementation, watch it pass, commit.
- **Verified hayro API (feasibility-confirmed):** observe via `hayro::hayro_interpret::{Context, InterpreterCache, InterpreterSettings, interpret_page, Device, GlyphDrawMode, PathDrawMode, Paint, TransformExt}`, `hayro::hayro_interpret::font::Glyph`, `hayro::hayro_interpret::hayro_cmap::BfString`, `hayro::hayro_syntax::Pdf`. Glyph bbox = `(transform * glyph_transform) * OutlineGlyph::outline()` bounding box; recovered text = `Glyph::as_unicode()` (`BfString::{Char,String}`); cover opacity = `Paint::Color(c).to_rgba().to_rgba8()[3]`; invisible text = `GlyphDrawMode::Invisible`; setup = `Context::new(page.initial_transform(true).to_kurbo(), Rect::new(0,0,w,h), &InterpreterCache::new(), page.xref(), InterpreterSettings::default())` then `interpret_page(page, &mut ctx, &mut device)`.
- **Verified lopdf API:** `Document::load_mem(&[u8])`, `get_pages()`, `get_object(&self) (auto-derefs)`, `catalog()`, `trailer`, `objects: BTreeMap<ObjectId,Object>`, `traverse_objects(&mut self, |&mut Object|) -> Vec<ObjectId>` (reachable set from the trailer), `Stream::decompressed_content()`, `Dictionary::{has,get,iter}`, `Object::{as_dict,as_str,as_name,as_reference,as_array,Type}`.
- **Verified pdf-core API:** `Document::{load, page_size}`, `PageSize { width_pt, height_pt }`, `redact`/`sanitize` (used by the self-cross-check test).

---

### Task 1: `textpos.rs` — the observing Device

**Files:**
- Create: `crates/pdf-core/src/textpos.rs`
- Modify: `crates/pdf-core/Cargo.toml` (add `kurbo = "0.13"`)
- Modify: `crates/pdf-core/src/lib.rs` (`mod textpos;`)

**Interfaces:**
- Produces: `pub(crate) struct GlyphMark { pub text: String, pub bbox: kurbo::Rect, pub order: usize, pub invisible: bool, pub rgba: [u8;4] }`; `pub(crate) struct CoverMark { pub bbox: kurbo::Rect, pub order: usize, pub rgba: [u8;4] }`; `pub(crate) struct PageObservation { pub glyphs: Vec<GlyphMark>, pub covers: Vec<CoverMark>, pub width_pt: f32, pub height_pt: f32 }`; `pub(crate) fn observe_page(pdf: &hayro::hayro_syntax::Pdf, index: usize) -> Option<PageObservation>`.

- [ ] **Step 1: Add the dependency** — in `crates/pdf-core/Cargo.toml` under `[dependencies]`:

```toml
kurbo = "0.13"
```

- [ ] **Step 2: Write the failing test** — create `crates/pdf-core/src/textpos.rs` with only this test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use hayro::hayro_syntax::Pdf;

    fn corpus() -> Vec<u8> {
        // A small text-bearing PDF with embedded fonts.
        include_bytes!("../tests/fixtures/hello.pdf").to_vec()
    }

    #[test]
    fn observes_glyphs_with_text_and_bbox() {
        let pdf = Pdf::new(corpus()).unwrap();
        let obs = observe_page(&pdf, 0).expect("observe");
        let recovered: String = obs.glyphs.iter().map(|g| g.text.as_str()).collect();
        assert!(recovered.contains("Hello"), "recovered text was {recovered:?}");
        // Every glyph has a finite, non-degenerate bbox.
        assert!(obs.glyphs.iter().any(|g| g.bbox.width() > 0.0 && g.bbox.height() > 0.0));
        assert!(obs.width_pt > 0.0 && obs.height_pt > 0.0);
    }
}
```

- [ ] **Step 3: Run, verify it fails**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core textpos`
Expected: FAIL — `observe_page` not defined.

- [ ] **Step 4: Implement** — prepend to `crates/pdf-core/src/textpos.rs` (this is the spike's proven observer, adapted):

```rust
//! Observe a page's resolved draw sequence (glyphs + opaque covers, in paint
//! order) via a hayro interpret Device — the text-position primitive the
//! detector consumes. Read-only.

use hayro::hayro_interpret::font::Glyph;
use hayro::hayro_interpret::hayro_cmap::BfString;
use hayro::hayro_interpret::{
    interpret_page, BlendMode, ClipPath, Context, Device, GlyphDrawMode, Image, InterpreterCache,
    InterpreterSettings, Paint, PathDrawMode, SoftMask, TransformExt,
};
use hayro::hayro_syntax::Pdf;
use kurbo::{Affine, BezPath, Rect, Shape};

pub(crate) struct GlyphMark {
    pub text: String,
    pub bbox: Rect,
    pub order: usize,
    pub invisible: bool,
    pub rgba: [u8; 4],
}

pub(crate) struct CoverMark {
    pub bbox: Rect,
    pub order: usize,
    pub rgba: [u8; 4],
}

pub(crate) struct PageObservation {
    pub glyphs: Vec<GlyphMark>,
    pub covers: Vec<CoverMark>,
    pub width_pt: f32,
    pub height_pt: f32,
}

fn paint_rgba(paint: &Paint) -> [u8; 4] {
    match paint {
        Paint::Color(c) => c.to_rgba().to_rgba8(),
        Paint::Pattern(_) => [0, 0, 0, 255], // treat a pattern fill as opaque for cover purposes
    }
}

#[derive(Default)]
struct Observer {
    order: usize,
    glyphs: Vec<GlyphMark>,
    covers: Vec<CoverMark>,
}

impl<'a> Device<'a> for Observer {
    fn set_soft_mask(&mut self, _: Option<SoftMask<'a>>) {}
    fn set_blend_mode(&mut self, _: BlendMode) {}

    fn draw_path(&mut self, path: &BezPath, transform: Affine, paint: &Paint<'a>, mode: &PathDrawMode) {
        self.order += 1;
        if let PathDrawMode::Fill(_) = mode {
            let mut p = path.clone();
            p.apply_affine(transform);
            self.covers.push(CoverMark { bbox: p.bounding_box(), order: self.order, rgba: paint_rgba(paint) });
        }
    }

    fn push_clip_path(&mut self, _: &ClipPath) {}
    fn push_transparency_group(&mut self, _: f32, _: Option<SoftMask<'a>>, _: BlendMode) {}

    fn draw_glyph(
        &mut self,
        glyph: &Glyph<'a>,
        transform: Affine,
        glyph_transform: Affine,
        paint: &Paint<'a>,
        mode: &GlyphDrawMode,
    ) {
        self.order += 1;
        let text = match glyph.as_unicode() {
            Some(BfString::Char(ch)) => ch.to_string(),
            Some(BfString::String(s)) => s,
            None => String::new(),
        };
        let matrix = transform * glyph_transform;
        let bbox = match glyph {
            Glyph::Outline(o) => {
                let mut p = o.outline();
                p.apply_affine(matrix);
                p.bounding_box()
            }
            Glyph::Type3(_) => {
                let t = matrix.translation();
                Rect::new(t.x, t.y, t.x, t.y)
            }
        };
        self.glyphs.push(GlyphMark {
            text,
            bbox,
            order: self.order,
            invisible: matches!(mode, GlyphDrawMode::Invisible),
            rgba: paint_rgba(paint),
        });
    }

    fn draw_image(&mut self, _image: Image<'a, '_>, transform: Affine) {
        self.order += 1;
        let mut p = Rect::new(0.0, 0.0, 1.0, 1.0).to_path(0.1);
        p.apply_affine(transform);
        self.covers.push(CoverMark { bbox: p.bounding_box(), order: self.order, rgba: [0, 0, 0, 255] });
    }

    fn pop_clip_path(&mut self) {}
    fn pop_transparency_group(&mut self) {}
}

pub(crate) fn observe_page(pdf: &Pdf, index: usize) -> Option<PageObservation> {
    let pages = pdf.pages();
    let page = pages.get(index)?;
    let (width_pt, height_pt) = page.render_dimensions();
    let initial_transform = page.initial_transform(true).to_kurbo();
    let cache = InterpreterCache::new();
    let mut ctx = Context::new(
        initial_transform,
        Rect::new(0.0, 0.0, width_pt as f64, height_pt as f64),
        &cache,
        page.xref(),
        InterpreterSettings::default(),
    );
    let mut obs = Observer::default();
    interpret_page(page, &mut ctx, &mut obs);
    Some(PageObservation { glyphs: obs.glyphs, covers: obs.covers, width_pt, height_pt })
}
```

- [ ] **Step 5: Wire the module** — add to `crates/pdf-core/src/lib.rs` after the existing `mod scrub;` lines:

```rust
mod textpos;
```

(No `pub use` — `textpos` is `pub(crate)`, consumed by `detect.rs`.)

- [ ] **Step 6: Run, verify it passes**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core textpos`
Expected: PASS (1 test — recovers "Hello", glyphs have bboxes). `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean. (If `kurbo` resolves to a different minor than hayro's and the `Device` impl fails to typecheck on `kurbo::Affine`/`Rect`, pin `kurbo` to the exact version in `crates/Cargo.lock` for `hayro` and report it.)

- [ ] **Step 7: Commit**

```bash
git add crates/pdf-core/Cargo.toml crates/pdf-core/src/textpos.rs crates/pdf-core/src/lib.rs
git commit -m "feat(pdf-core): observing Device text-position primitive"
```

---

### Task 2: `detect.rs` — report types + the geometric detectors

**Files:**
- Create: `crates/pdf-core/src/detect.rs`
- Modify: `crates/pdf-core/src/lib.rs` (`mod detect; pub use detect::*;`)

**Interfaces:**
- Consumes: `PageObservation`, `GlyphMark`, `CoverMark` (Task 1).
- Produces: `pub enum Severity { Critical, High, Medium, Low, Info }`; `pub enum Category { CoveredText, InvisibleText, WhiteoutText, MetadataLeak, OrphanedText }`; `pub struct Finding { pub category, pub severity, pub page: Option<usize>, pub region: Option<Rect> /*display-point bottom-left*/, pub recovered_text: String, pub detail: String }`; `pub struct Rect { pub x0,y0,x1,y1: f32 }` (re-use the redaction `Rect` — see note); `pub(crate) fn page_geometric_findings(obs: &PageObservation, page: usize) -> Vec<Finding>`.

> **Rect reuse:** the redaction module already defines `pub struct Rect { x0,y0,x1,y1: f32 }` in `redact.rs` and re-exports it. Use that same type for `Finding.region`. Convert a `kurbo::Rect` (device space, top-left) to it in display-points bottom-left via `to_display_rect(kbox, page_height_pt)` defined below.

- [ ] **Step 1: Write the failing tests** — create `crates/pdf-core/src/detect.rs` with only this test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::textpos::{CoverMark, GlyphMark, PageObservation};

    fn glyph(text: &str, x: f64, y: f64, order: usize, invisible: bool, rgba: [u8; 4]) -> GlyphMark {
        GlyphMark { text: text.into(), bbox: kurbo::Rect::new(x, y, x + 5.0, y + 8.0), order, invisible, rgba }
    }

    #[test]
    fn flags_covered_text_and_recovers_it() {
        let obs = PageObservation {
            glyphs: vec![glyph("S", 10.0, 10.0, 1, false, [0, 0, 0, 255]), glyph("X", 500.0, 500.0, 2, false, [0, 0, 0, 255])],
            // an opaque cover painted AFTER glyph "S", over its location
            covers: vec![CoverMark { bbox: kurbo::Rect::new(0.0, 0.0, 100.0, 100.0), order: 3, rgba: [0, 0, 0, 255] }],
            width_pt: 600.0,
            height_pt: 800.0,
        };
        let findings = page_geometric_findings(&obs, 0);
        let covered: Vec<_> = findings.iter().filter(|f| matches!(f.category, Category::CoveredText)).collect();
        assert_eq!(covered.len(), 1);
        assert_eq!(covered[0].recovered_text, "S");
        assert!(matches!(covered[0].severity, Severity::Critical));
        assert_eq!(covered[0].page, Some(0));
        // "X" is not under the cover → not flagged.
    }

    #[test]
    fn flags_invisible_text() {
        let obs = PageObservation {
            glyphs: vec![glyph("hidden", 10.0, 10.0, 1, true, [0, 0, 0, 255])],
            covers: vec![],
            width_pt: 600.0,
            height_pt: 800.0,
        };
        let findings = page_geometric_findings(&obs, 0);
        assert!(findings.iter().any(|f| matches!(f.category, Category::InvisibleText) && f.recovered_text == "hidden"));
    }

    #[test]
    fn flags_whiteout_text_under_same_color_fill() {
        // White text (255,255,255) over a white opaque cover → same-color concealment.
        let obs = PageObservation {
            glyphs: vec![glyph("white", 10.0, 10.0, 1, false, [255, 255, 255, 255])],
            covers: vec![CoverMark { bbox: kurbo::Rect::new(0.0, 0.0, 100.0, 100.0), order: 2, rgba: [255, 255, 255, 255] }],
            width_pt: 600.0,
            height_pt: 800.0,
        };
        let findings = page_geometric_findings(&obs, 0);
        assert!(findings.iter().any(|f| matches!(f.category, Category::WhiteoutText) && f.recovered_text == "white"));
    }
}
```

- [ ] **Step 2: Run, verify they fail**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core detect`
Expected: FAIL — `page_geometric_findings` / the types not defined.

- [ ] **Step 3: Implement** — prepend to `crates/pdf-core/src/detect.rs`:

```rust
//! The bad-redaction detector: geometric detectors over an observed page, plus
//! structural detectors over the object model, assembled into a ranked report.

use crate::textpos::{CoverMark, GlyphMark, PageObservation};
use crate::Rect;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    CoveredText,
    InvisibleText,
    WhiteoutText,
    MetadataLeak,
    OrphanedText,
}

#[derive(Debug, Clone)]
pub struct Finding {
    pub category: Category,
    pub severity: Severity,
    pub page: Option<usize>,
    /// Page-space region in display points, bottom-left origin (the redaction `Rect` frame).
    pub region: Option<Rect>,
    pub recovered_text: String,
    pub detail: String,
}

/// Convert a kurbo device-space bbox (top-left origin) to a display-point rect
/// (bottom-left origin), matching `page_size`/the redaction `Rect`.
fn to_display_rect(kbox: kurbo::Rect, page_height_pt: f32) -> Rect {
    let h = page_height_pt as f64;
    Rect {
        x0: kbox.x0 as f32,
        y0: (h - kbox.y1) as f32,
        x1: kbox.x1 as f32,
        y1: (h - kbox.y0) as f32,
    }
}

const OPAQUE: u8 = 250;

fn color_matches(a: [u8; 4], b: [u8; 4]) -> bool {
    let close = |x: u8, y: u8| (x as i16 - y as i16).abs() <= 8;
    close(a[0], b[0]) && close(a[1], b[1]) && close(a[2], b[2])
}

/// The opaque cover (if any) painted after this glyph, over its center.
fn covering<'a>(glyph: &GlyphMark, covers: &'a [CoverMark]) -> Option<&'a CoverMark> {
    let center = glyph.bbox.center();
    covers
        .iter()
        .filter(|c| c.order > glyph.order && c.rgba[3] >= OPAQUE && c.bbox.contains(center))
        .next()
}

pub(crate) fn page_geometric_findings(obs: &PageObservation, page: usize) -> Vec<Finding> {
    let mut findings = Vec::new();
    for g in &obs.glyphs {
        if g.text.trim().is_empty() {
            continue;
        }
        let region = Some(to_display_rect(g.bbox, obs.height_pt));

        if g.invisible {
            findings.push(Finding {
                category: Category::InvisibleText,
                severity: Severity::High,
                page: Some(page),
                region,
                recovered_text: g.text.clone(),
                detail: "Text drawn in an invisible render mode but extractable.".into(),
            });
            continue;
        }
        if let Some(cover) = covering(g, &obs.covers) {
            // Same-color cover ⇒ whiteout concealment; otherwise an opaque box.
            if color_matches(g.rgba, cover.rgba) {
                findings.push(Finding {
                    category: Category::WhiteoutText,
                    severity: Severity::High,
                    page: Some(page),
                    region,
                    recovered_text: g.text.clone(),
                    detail: "Text painted the same color as the fill covering it.".into(),
                });
            } else {
                findings.push(Finding {
                    category: Category::CoveredText,
                    severity: Severity::Critical,
                    page: Some(page),
                    region,
                    recovered_text: g.text.clone(),
                    detail: "Extractable text sits under an opaque fill that hides it from view.".into(),
                });
            }
        }
    }
    findings
}
```

- [ ] **Step 4: Wire the module** — add to `crates/pdf-core/src/lib.rs` after `mod textpos;`:

```rust
mod detect;
pub use detect::*;
```

- [ ] **Step 5: Run, verify they pass**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core detect`
Expected: PASS (3 tests). `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean. (If clippy flags `.filter(...).next()` → use `.find(...)`.)

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-core/src/detect.rs crates/pdf-core/src/lib.rs
git commit -m "feat(pdf-core): geometric detectors (covered, invisible, whiteout)"
```

---

### Task 3: Structural detectors — metadata leaks + orphaned text

**Files:**
- Modify: `crates/pdf-core/src/detect.rs`

**Interfaces:**
- Consumes: `Finding`, `Category`, `Severity` (Task 2).
- Produces: `pub(crate) fn structural_findings(doc: &mut lopdf::Document, needle_min_len: usize) -> Vec<Finding>` — document-level findings: `MetadataLeak` (Info dictionary string values, `/Outlines` titles, AcroForm field `/V`, the XMP `/Metadata` stream text) and `OrphanedText` (text in objects unreachable from the trailer).

- [ ] **Step 1: Write the failing test** — append to the `tests` module in `detect.rs`:

```rust
#[test]
fn flags_metadata_and_orphaned_text() {
    use lopdf::{Dictionary, Document, Object, Stream};
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut catalog = Dictionary::new();
    catalog.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog.set("Pages", Object::Reference(pages_id));
    let catalog_id = doc.add_object(catalog);
    let mut pages = Dictionary::new();
    pages.set("Type", Object::Name(b"Pages".to_vec()));
    pages.set("Kids", Object::Array(vec![]));
    pages.set("Count", Object::Integer(0));
    doc.objects.insert(pages_id, Object::Dictionary(pages));
    doc.trailer.set("Root", Object::Reference(catalog_id));
    // Metadata leak: an Info dictionary with an author.
    let info_id = doc.add_object(Object::Dictionary({
        let mut d = Dictionary::new();
        d.set("Author", Object::string_literal("Privileged Author"));
        d
    }));
    doc.trailer.set("Info", Object::Reference(info_id));
    // Orphaned text: a stream object referenced by nothing.
    doc.add_object(Stream::new(Dictionary::new(), b"(orphan secret) Tj".to_vec()));

    let findings = structural_findings(&mut doc, 3);
    assert!(findings.iter().any(|f| matches!(f.category, Category::MetadataLeak)
        && f.recovered_text.contains("Privileged Author")));
    assert!(findings.iter().any(|f| matches!(f.category, Category::OrphanedText)
        && f.recovered_text.contains("orphan secret")));
}
```

- [ ] **Step 2: Run, verify it fails**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core flags_metadata_and_orphaned_text`
Expected: FAIL — `structural_findings` not defined.

- [ ] **Step 3: Implement** — add to `detect.rs` (outside the test module):

```rust
use lopdf::{Object, ObjectId};

fn object_strings(obj: &Object, out: &mut String) {
    match obj {
        Object::String(bytes, _) => {
            out.push_str(&String::from_utf8_lossy(bytes));
            out.push('\n');
        }
        Object::Array(items) => items.iter().for_each(|o| object_strings(o, out)),
        Object::Dictionary(d) => d.iter().for_each(|(_, o)| object_strings(o, out)),
        Object::Stream(s) => {
            if let Ok(decoded) = s.decompressed_content() {
                out.push_str(&String::from_utf8_lossy(&decoded));
                out.push('\n');
            } else {
                out.push_str(&String::from_utf8_lossy(&s.content));
                out.push('\n');
            }
        }
        _ => {}
    }
}

pub(crate) fn structural_findings(doc: &mut lopdf::Document, needle_min_len: usize) -> Vec<Finding> {
    let mut findings = Vec::new();

    // MetadataLeak — the Info dictionary's human-readable string values.
    let info_id = doc.trailer.get(b"Info").ok().and_then(|o| o.as_reference().ok());
    if let Some(info_id) = info_id {
        if let Ok(info) = doc.get_object(info_id).and_then(|o| o.as_dict()) {
            let mut text = String::new();
            for (_, v) in info.iter() {
                object_strings(v, &mut text);
            }
            let text = text.trim().to_string();
            if text.len() >= needle_min_len {
                findings.push(Finding {
                    category: Category::MetadataLeak,
                    severity: Severity::Medium,
                    page: None,
                    region: None,
                    recovered_text: text,
                    detail: "Document information dictionary carries identifying metadata.".into(),
                });
            }
        }
    }

    // OrphanedText — objects not reachable from the trailer that carry text.
    let reachable: std::collections::BTreeSet<ObjectId> =
        doc.traverse_objects(|_| {}).into_iter().collect();
    let orphan_ids: Vec<ObjectId> = doc
        .objects
        .keys()
        .copied()
        .filter(|id| !reachable.contains(id))
        .collect();
    for id in orphan_ids {
        if let Some(obj) = doc.objects.get(&id) {
            let mut text = String::new();
            object_strings(obj, &mut text);
            let text = text.trim().to_string();
            if text.len() >= needle_min_len {
                findings.push(Finding {
                    category: Category::OrphanedText,
                    severity: Severity::High,
                    page: None,
                    region: None,
                    recovered_text: text,
                    detail: "Text present in an object that no page references — recoverable from the file bytes.".into(),
                });
            }
        }
    }

    findings
}
```

> **Note:** `traverse_objects` takes `&mut self` and follows references from the trailer; the detector owns its `Document` copy, so calling it is side-effect-free for the caller. The `doc.trailer.get(b"Info")` cloning dance avoids holding a borrow across `get_object`; if the borrow checker prefers, read the `info_id` first into a local `ObjectId` then drop the trailer borrow before `get_object`.

- [ ] **Step 4: Run, verify it passes**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core detect`
Expected: PASS (4 tests). `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean. Simplify the `Info` read if clippy objects (e.g. `doc.trailer.get(b"Info").and_then(|o| o.as_reference()).ok()`).

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/detect.rs
git commit -m "feat(pdf-core): structural detectors (metadata leak, orphaned text)"
```

---

### Task 4: `detect()` orchestration + ranking + the self-cross-check

**Files:**
- Modify: `crates/pdf-core/src/detect.rs`

**Interfaces:**
- Consumes: `page_geometric_findings`, `structural_findings`, `observe_page` (Tasks 1–3); `crate::Document` (slice 1); `crate::redact` (the self-cross-check test).
- Produces: `pub struct SeveritySummary { pub critical, high, medium, low, info: usize }`; `pub struct DetectionReport { pub findings: Vec<Finding>, pub summary: SeveritySummary, pub pages_scanned: usize, pub glyphs_examined: usize }`; `pub enum DetectError { Parse }`; `pub fn detect(bytes: Vec<u8>) -> Result<DetectionReport, DetectError>`.

- [ ] **Step 1: Write the failing tests** — append to the `tests` module:

```rust
#[test]
fn detect_flags_a_bad_redaction_and_recovers_text() {
    // hello.pdf with an opaque black box appended over the text — the classic failure.
    let mut doc = lopdf::Document::load_mem(&corpus_bytes()).unwrap();
    let page_id = *doc.get_pages().get(&1).unwrap();
    let cover_id = doc.add_object(lopdf::Stream::new(
        lopdf::Dictionary::new(),
        b"q 0 0 0 rg 0 0 1000 1000 re f Q".to_vec(),
    ));
    let mut contents: Vec<lopdf::Object> = match doc.get_dictionary(page_id).unwrap().get(b"Contents") {
        Ok(lopdf::Object::Array(a)) => a.clone(),
        Ok(lopdf::Object::Reference(r)) => vec![lopdf::Object::Reference(*r)],
        _ => vec![],
    };
    contents.push(lopdf::Object::Reference(cover_id));
    doc.get_dictionary_mut(page_id).unwrap().set("Contents", lopdf::Object::Array(contents));
    let mut bad = Vec::new();
    doc.save_to(&mut bad).unwrap();

    let report = detect(bad).expect("detect");
    let covered: Vec<_> = report.findings.iter().filter(|f| matches!(f.category, Category::CoveredText)).collect();
    assert!(!covered.is_empty(), "expected covered-text findings");
    assert!(covered.iter().any(|f| f.recovered_text.contains("Hello")));
    assert!(report.findings.first().map(|f| f.severity).unwrap() == Severity::Critical); // ranked
}

#[test]
fn detect_finds_nothing_in_a_properly_redacted_document() {
    // The reciprocal of the redaction gate: a flattened-image redaction has no
    // extractable text, so the detector must find zero covered/invisible/whiteout text.
    let regions = [crate::RedactionRegion {
        page: 0,
        rect: crate::Rect { x0: 0.0, y0: 0.0, x1: 1000.0, y1: 1000.0 },
        reason: None,
    }];
    let outcome = crate::redact(corpus_bytes(), &regions, &crate::RedactionOptions::default()).unwrap();
    let report = detect(outcome.pdf).expect("detect");
    let page_text: Vec<_> = report
        .findings
        .iter()
        .filter(|f| matches!(f.category, Category::CoveredText | Category::InvisibleText | Category::WhiteoutText))
        .collect();
    assert!(page_text.is_empty(), "a redacted document must yield no recoverable page text, got {page_text:?}");
}

fn corpus_bytes() -> Vec<u8> {
    include_bytes!("../tests/fixtures/hello.pdf").to_vec()
}
```

- [ ] **Step 2: Run, verify they fail**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core detect_flags detect_finds_nothing`
Expected: FAIL — `detect` not defined.

- [ ] **Step 3: Implement** — add to `detect.rs`:

```rust
#[derive(Debug, Clone, Default)]
pub struct SeveritySummary {
    pub critical: usize,
    pub high: usize,
    pub medium: usize,
    pub low: usize,
    pub info: usize,
}

#[derive(Debug, Clone)]
pub struct DetectionReport {
    pub findings: Vec<Finding>,
    pub summary: SeveritySummary,
    pub pages_scanned: usize,
    pub glyphs_examined: usize,
}

#[derive(Debug)]
pub enum DetectError {
    Parse,
}

fn severity_rank(s: Severity) -> u8 {
    match s {
        Severity::Critical => 0,
        Severity::High => 1,
        Severity::Medium => 2,
        Severity::Low => 3,
        Severity::Info => 4,
    }
}

pub fn detect(bytes: Vec<u8>) -> Result<DetectionReport, DetectError> {
    let pdf = hayro::hayro_syntax::Pdf::new(bytes.clone()).map_err(|_| DetectError::Parse)?;
    let page_count = pdf.pages().len();

    let mut findings = Vec::new();
    let mut glyphs_examined = 0;
    for page in 0..page_count {
        if let Some(obs) = crate::textpos::observe_page(&pdf, page) {
            glyphs_examined += obs.glyphs.len();
            findings.extend(page_geometric_findings(&obs, page));
        }
    }

    // Structural pass over the detector's own object-model copy.
    if let Ok(mut doc) = lopdf::Document::load_mem(&bytes) {
        findings.extend(structural_findings(&mut doc, 3));
    }

    findings.sort_by_key(|f| severity_rank(f.severity));

    let mut summary = SeveritySummary::default();
    for f in &findings {
        match f.severity {
            Severity::Critical => summary.critical += 1,
            Severity::High => summary.high += 1,
            Severity::Medium => summary.medium += 1,
            Severity::Low => summary.low += 1,
            Severity::Info => summary.info += 1,
        }
    }

    Ok(DetectionReport { findings, summary, pages_scanned: page_count, glyphs_examined })
}
```

- [ ] **Step 4: Run, verify they pass**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core`
Expected: PASS (all detector tests + the existing redaction/scrub/slice-1 tests). `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean.

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/detect.rs
git commit -m "feat(pdf-core): detect orchestration, severity ranking, self-cross-check"
```

---

### Task 5: WASM edge + `@magna-carta/pdf` wrapper

**Files:**
- Modify: `crates/pdf-core/src/wasm.rs`
- Modify: `packages/pdf/src/index.ts`
- Test: `packages/pdf/test/detect.test.ts`

**Interfaces:**
- Consumes: `detect`, the report types (Tasks 2–4).
- Produces (JS): `detectDocument(bytes: Uint8Array): { findings: Finding[], summary, pagesScanned, glyphsExamined }`; `Finding = { category: string, severity: string, page: number | null, region: { x0,y0,x1,y1 } | null, recoveredText: string, detail: string }`.

- [ ] **Step 1: Add the wasm edge** — add to `crates/pdf-core/src/wasm.rs`:

```rust
use crate::{detect, Category, Severity};

impl From<crate::DetectError> for JsError {
    fn from(e: crate::DetectError) -> Self {
        match e {
            crate::DetectError::Parse => JsError::new("failed to parse PDF"),
        }
    }
}

fn category_str(c: Category) -> &'static str {
    match c {
        Category::CoveredText => "coveredText",
        Category::InvisibleText => "invisibleText",
        Category::WhiteoutText => "whiteoutText",
        Category::MetadataLeak => "metadataLeak",
        Category::OrphanedText => "orphanedText",
    }
}

fn severity_str(s: Severity) -> &'static str {
    match s {
        Severity::Critical => "critical",
        Severity::High => "high",
        Severity::Medium => "medium",
        Severity::Low => "low",
        Severity::Info => "info",
    }
}

#[wasm_bindgen(js_name = detectDocument)]
pub fn detect_document(bytes: Vec<u8>) -> Result<JsValue, JsError> {
    let report = detect(bytes)?;
    let set = |o: &js_sys::Object, k: &str, v: &JsValue| {
        let _ = js_sys::Reflect::set(o, &k.into(), v);
    };

    let findings = js_sys::Array::new();
    for f in &report.findings {
        let o = js_sys::Object::new();
        set(&o, "category", &category_str(f.category).into());
        set(&o, "severity", &severity_str(f.severity).into());
        set(&o, "page", &f.page.map(|p| JsValue::from(p as u32)).unwrap_or(JsValue::NULL));
        match &f.region {
            Some(r) => {
                let ro = js_sys::Object::new();
                set(&ro, "x0", &JsValue::from(r.x0));
                set(&ro, "y0", &JsValue::from(r.y0));
                set(&ro, "x1", &JsValue::from(r.x1));
                set(&ro, "y1", &JsValue::from(r.y1));
                set(&o, "region", &ro.into());
            }
            None => set(&o, "region", &JsValue::NULL),
        }
        set(&o, "recoveredText", &f.recovered_text.as_str().into());
        set(&o, "detail", &f.detail.as_str().into());
        findings.push(&o);
    }

    let summary = js_sys::Object::new();
    set(&summary, "critical", &JsValue::from(report.summary.critical as u32));
    set(&summary, "high", &JsValue::from(report.summary.high as u32));
    set(&summary, "medium", &JsValue::from(report.summary.medium as u32));
    set(&summary, "low", &JsValue::from(report.summary.low as u32));
    set(&summary, "info", &JsValue::from(report.summary.info as u32));

    let result = js_sys::Object::new();
    set(&result, "findings", &findings);
    set(&result, "summary", &summary);
    set(&result, "pagesScanned", &JsValue::from(report.pages_scanned as u32));
    set(&result, "glyphsExamined", &JsValue::from(report.glyphs_examined as u32));
    Ok(result.into())
}
```

- [ ] **Step 2: Build the wasm to verify it compiles**

Run: `cargo build --manifest-path crates/Cargo.toml -p pdf-core --target wasm32-unknown-unknown`
Expected: compiles. (If the `wasm32-unknown-unknown` target is missing: `rustup target add wasm32-unknown-unknown`.)

- [ ] **Step 3: Add the TS wrapper** — append to `packages/pdf/src/index.ts`:

```ts
export interface DetectionFinding {
  category:
    | "coveredText"
    | "invisibleText"
    | "whiteoutText"
    | "metadataLeak"
    | "orphanedText";
  severity: "critical" | "high" | "medium" | "low" | "info";
  page: number | null;
  region: { x0: number; y0: number; x1: number; y1: number } | null;
  recoveredText: string;
  detail: string;
}

export interface DetectionReport {
  findings: DetectionFinding[];
  summary: { critical: number; high: number; medium: number; low: number; info: number };
  pagesScanned: number;
  glyphsExamined: number;
}

import { detectDocument as wasmDetect } from "./pkg/pdf_core.js";

/**
 * Scan a PDF for failed redactions — recoverable text that is covered, invisible,
 * whitened-out, in metadata, or orphaned. Returns findings ranked by severity.
 * Read-only: the input is never modified. An empty `findings` list means nothing
 * was detected, not a guarantee that the document is safe.
 */
export async function detectDocument(bytes: Uint8Array): Promise<DetectionReport> {
  await ensureReady();
  return wasmDetect(bytes) as DetectionReport;
}
```

- [ ] **Step 4: Write the failing JS test** — create `packages/pdf/test/detect.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, detectDocument, redactDocument } from "../src/index.js";

const hello = new Uint8Array(
  readFileSync(fileURLToPath(new URL("./fixtures/hello.pdf", import.meta.url))),
);

describe("detectDocument", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("finds nothing in a properly redacted document", async () => {
    const redacted = await redactDocument(hello, [
      { page: 0, rect: { x0: 0, y0: 0, x1: 1000, y1: 1000 }, reason: "PII" },
    ]);
    const report = await detectDocument(redacted.pdf);
    const pageText = report.findings.filter((f) =>
      ["coveredText", "invisibleText", "whiteoutText"].includes(f.category),
    );
    expect(pageText).toHaveLength(0);
  });

  it("returns a structured report", async () => {
    const report = await detectDocument(hello);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(typeof report.glyphsExamined).toBe("number");
  });
});
```

- [ ] **Step 5: Build wasm, run the test**

```bash
pnpm --filter @magna-carta/pdf run build:wasm
pnpm --filter @magna-carta/pdf test
```
Expected: PASS (slice-1 + redaction + scrub tests + the 2 new detect tests). If `pnpm` fails for an environment reason (not a code error), capture the exact error and report it — do not fake green.

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-core/src/wasm.rs packages/pdf/src/index.ts packages/pdf/test/detect.test.ts
git commit -m "feat(pdf): detectDocument wasm edge and typed report wrapper"
```

---

### Task 6: `pdf-eval` detect mode + smoke + docs

**Files:**
- Modify: `crates/pdf-eval/src/main.rs`
- Modify: `.github/workflows/ci.yml`
- Modify: `packages/pdf/README.md` (append a Detection section)
- Create: `docs/decisions/pending/pdf-detector-observing-device.md`
- Create: `changelog.d/pdf-detector.md`
- Modify: `ROADMAP.md`, `STATUS.md` (own row only)

**Interfaces:**
- Consumes: `pdf_core::{detect, Category, Severity}`.
- Produces: a `pdf-eval detect <pdf>` mode (prints the ranked report) and a `detect-smoke <pdf>` that asserts a bad fixture is flagged.

- [ ] **Step 1: Add the modes** — in `crates/pdf-eval/src/main.rs`, add to the `match` in `main()`:

```rust
        Some("detect") => detect_mode(args.next().expect("usage: detect <pdf>")),
        Some("detect-smoke") => detect_smoke_mode(args.next().expect("usage: detect-smoke <pdf>")),
```

and add the functions (ungated — only `pdf-core`, no pdfium):

```rust
fn detect_mode(path: String) {
    let bytes = std::fs::read(&path).unwrap();
    match pdf_core::detect(bytes) {
        Ok(report) => {
            println!(
                "scanned {} page(s), {} glyphs; {} finding(s)",
                report.pages_scanned, report.glyphs_examined, report.findings.len()
            );
            for f in &report.findings {
                let text: String = f.recovered_text.chars().take(60).collect();
                println!("  {:?} [{:?}] page={:?} :: {:?}", f.severity, f.category, f.page, text);
            }
        }
        Err(e) => {
            eprintln!("FAIL detect: {e:?}");
            std::process::exit(1);
        }
    }
}

fn detect_smoke_mode(path: String) {
    // Append an opaque cover over the page, then assert the detector flags it.
    let orig = std::fs::read(&path).unwrap();
    let mut doc = lopdf::Document::load_mem(&orig).unwrap();
    let page_id = *doc.get_pages().get(&1).unwrap();
    let cover_id = doc.add_object(lopdf::Stream::new(
        lopdf::Dictionary::new(),
        b"q 0 0 0 rg 0 0 2000 2000 re f Q".to_vec(),
    ));
    let mut contents: Vec<lopdf::Object> = match doc.get_dictionary(page_id).unwrap().get(b"Contents") {
        Ok(lopdf::Object::Array(a)) => a.clone(),
        Ok(lopdf::Object::Reference(r)) => vec![lopdf::Object::Reference(*r)],
        _ => vec![],
    };
    contents.push(lopdf::Object::Reference(cover_id));
    doc.get_dictionary_mut(page_id).unwrap().set("Contents", lopdf::Object::Array(contents));
    let mut bad = Vec::new();
    doc.save_to(&mut bad).unwrap();

    match pdf_core::detect(bad) {
        Ok(report) => {
            let covered = report
                .findings
                .iter()
                .filter(|f| matches!(f.category, pdf_core::Category::CoveredText))
                .count();
            if covered > 0 {
                println!("ok   flagged {covered} covered-text finding(s)");
            } else {
                eprintln!("FAIL detect-smoke: no covered-text finding on a known-bad input");
                std::process::exit(1);
            }
        }
        Err(e) => {
            eprintln!("FAIL detect-smoke: {e:?}");
            std::process::exit(1);
        }
    }
}
```

`pdf-eval` already depends on `lopdf`; if not, add `lopdf = "0.41"` to `crates/pdf-eval/Cargo.toml`.

- [ ] **Step 2: Verify the smoke flags a corpus file**

Run: `cargo run --manifest-path crates/Cargo.toml -p pdf-eval --release -- detect-smoke crates/pdf-eval/corpus-ci/basicapi.pdf`
Expected: `ok flagged N covered-text finding(s)`, exit 0. (If that corpus file is absent, list `crates/pdf-eval/corpus-ci/` and use an available text-bearing file, noting the substitution.) `cargo clippy --manifest-path crates/Cargo.toml -p pdf-eval -- -D warnings` — clean.

- [ ] **Step 3: Add a CI detect-smoke step** — in `.github/workflows/ci.yml`, after the existing `sanitize-smoke` step in the `rust-pdf-core` job (match its form, default features, with a `name:`):

```yaml
      - name: pdf-eval detect-smoke (default features — no pdfium)
        run: cargo run --manifest-path crates/Cargo.toml -p pdf-eval --release -- detect-smoke crates/pdf-eval/corpus-ci/basicapi.pdf
```

- [ ] **Step 4: Write the docs**
  - Append a "Detection" section to `packages/pdf/README.md`: `detectDocument(bytes)`, the `DetectionFinding` shape, the five v1 categories and their severities, and that it is **read-only** and **never asserts a document is clean**. State the honest boundaries: regions for metadata/orphan findings are document-level (`page: null`); text recoverable only via glyph codes without a ToUnicode map may yield an empty `recoveredText`; rasterized (image) text is not recovered. Note that hidden-optional-content-layer detection and removable-annotation attribution are not yet covered. NO process references.
  - Create `docs/decisions/pending/pdf-detector-observing-device.md` — match the frontmatter of `docs/decisions/pending/pdf-redaction-rasterize-route.md`. Record: the observing-Device text-position primitive (shared with future content-stream surgery), the high-recall divergence model (extractable ∧ not-visible), and the deferred RemovableAnnotation + HiddenLayer detectors.
  - Create `changelog.d/pdf-detector.md` — match `changelog.d/pdf-redaction.md`, `category: Added`.
  - Add an additive row/bullet to `ROADMAP.md` and `STATUS.md` for the detector (own row only).

- [ ] **Step 5: Verify the gates locally**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core && cargo clippy --manifest-path crates/Cargo.toml --all-targets -- -D warnings && cargo fmt --manifest-path crates/Cargo.toml --all --check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-eval/src/main.rs .github/workflows/ci.yml packages/pdf/README.md docs/decisions/pending/pdf-detector-observing-device.md changelog.d/pdf-detector.md ROADMAP.md STATUS.md
git commit -m "feat(pdf-eval): detector smoke, CI, and docs"
```

---

## Self-Review

**Spec coverage:** §1 `textpos` observing Device (T1) · `detect.rs` + report (T2–4) · `pdf-eval` mode + smoke (T6). §3 mechanisms: the observing Device + CoveredText/InvisibleText/WhiteoutText (T1–2); the structural MetadataLeak/OrphanedText (T3). §4 severity ranking + never-clean (T4). §5 coordinate frame conversion `to_display_rect` (T2). §6 testing: self-cross-check + flagship (T4), per-detector (T2–3), selectivity (covered by the geometric center test), no-false-positives (T4 redacted→none). §5 WASM (T5). **Deferred per the scope note (NOT in this plan):** RemovableAnnotation (annotation two-phase) and HiddenLayer (optional-content scan) — a fast-follow gated on a mini-spike; the docs (T6) state this honestly. §7 boundaries documented (T6).

**Placeholder scan:** every code step shows complete code. The two structural-read "if the borrow checker prefers…" notes name a concrete alternative, not a blank.

**Type consistency:** `GlyphMark`/`CoverMark`/`PageObservation` (T1) consumed unchanged in T2/T4; `Finding`/`Category`/`Severity`/`Rect` (T2) consumed in T3–T6; `page_geometric_findings` (T2) + `structural_findings` (T3) → `detect` (T4); `detect` (T4) → wasm `detectDocument` (T5) → TS `detectDocument` (T5); the JS category/severity strings (T5) match the README (T6). `Rect` is the redaction module's existing type (reused, not redefined). The detector is read-only — no task mutates the input PDF (the structural pass mutates only the detector's private `Document` copy via `traverse_objects`).
