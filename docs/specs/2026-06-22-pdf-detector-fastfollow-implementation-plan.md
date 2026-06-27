# PDF detector fast-follow — RemovableAnnotation + HiddenLayer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the detector's two deferred detectors — HiddenLayer (text in an off-by-default optional-content group) and RemovableAnnotation (extractable text under an obscuring annotation) — both read-only structural detectors, completing the seven-category report.

**Architecture:** HiddenLayer is a document-level lopdf content-operator scan (`/OCProperties` OFF set × `/OC … BDC … EMC` spans). RemovableAnnotation is a per-page detector combining the observed glyph positions with the page's `/Annots` rects. Both fold into the existing `detect()`; a glyph claimed by an annotation is not also reported as CoveredText (precedence).

**Tech Stack:** Rust (lopdf 0.41, hayro 0.7, kurbo 0.13), TypeScript (`@magna-carta/pdf`), Vitest.

**Design spec:** [`2026-06-22-pdf-detector-fastfollow-design.md`](2026-06-22-pdf-detector-fastfollow-design.md). **Feasibility (GO):** [`2026-06-22-pdf-detector-fastfollow-feasibility-findings.md`](2026-06-22-pdf-detector-fastfollow-feasibility-findings.md) — both proven as structural detectors in `spikes/detector-feasibility/src/bin/extras.rs`.

**Worktree:** execute on the existing `pdf-engine-roadmap` worktree.

## Global Constraints

- `pdf-core` pure compute, typed `Result`, **no logging**, no happy-path panics. **Read-only** — never mutates the input (the lopdf `Document` is the detector's private `load_mem` copy).
- **No process references** in code/tests/consumer strings (no `ADR-NNNN`, "slice N", "Phase N", "spike") — golden rule 13.
- **No shorthand names**; "OCG", "pdf", "bbox", "id" accepted.
- High-recall; the report never asserts "clean."
- **TDD**: failing test first, watch it fail, minimal implementation, watch it pass, commit.
- **Verified lopdf API:** `Document::get_and_decode_page_content(page_id) -> Result<Content>`, `Content { operations: Vec<Operation> }`, `Operation { operator: String, operands: Vec<Object> }`, `Object::{as_name, as_str, as_reference, as_array, as_dict, as_float, as_i64}`, `get_pages() -> BTreeMap<u32,ObjectId>`, `catalog()`. (All exercised by the spike.)
- **Existing `detect.rs` surface (do not redefine):** `pub enum Category { CoveredText, InvisibleText, WhiteoutText, MetadataLeak, OrphanedText }`; `pub struct Finding { category, severity, page: Option<usize>, region: Option<Rect>, recovered_text, detail }`; `pub(crate) fn page_geometric_findings(obs, page) -> Vec<Finding>`; `pub(crate) fn structural_findings(doc, needle_min_len) -> Vec<Finding>`; `to_display_rect(kbox, page_height_pt) -> Rect`; `detect(bytes) -> Result<DetectionReport, DetectError>` (loads `lopdf::Document::load_mem(&bytes)` for the structural pass).
- **textpos:** `GlyphMark { text, bbox: kurbo::Rect, order, invisible, rgba }`, `PageObservation { glyphs, covers, width_pt, height_pt }`.

---

### Task 1: HiddenLayer detector

**Files:**

- Modify: `crates/pdf-core/src/detect.rs`

**Interfaces:**

- Produces: `Category` gains `HiddenLayer` AND `RemovableAnnotation` variants (both added now so the enum is stable; RemovableAnnotation's logic lands in Task 2). `pub(crate) fn hidden_layer_findings(doc: &lopdf::Document) -> Vec<Finding>` — one High `HiddenLayer` finding per page that draws text inside an inactive optional-content group.

- [ ] **Step 1: Add the two Category variants** — in `crates/pdf-core/src/detect.rs`, extend the enum:

```rust
pub enum Category {
    CoveredText,
    InvisibleText,
    WhiteoutText,
    RemovableAnnotation,
    HiddenLayer,
    MetadataLeak,
    OrphanedText,
}
```

- [ ] **Step 2: Write the failing test** — append to the `tests` module in `detect.rs`:

```rust
#[test]
fn flags_text_hidden_in_an_inactive_optional_content_layer() {
    use lopdf::{dictionary, Dictionary, Document, Object, Stream};
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let ocg_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"OCG".to_vec()),
        "Name" => Object::string_literal("Secret Layer"),
    });
    let content = b"/OC /MC0 BDC BT /F1 12 Tf 72 700 Td (hidden layer text) Tj ET EMC".to_vec();
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content));
    let mut properties = Dictionary::new();
    properties.set("MC0", Object::Reference(ocg_id));
    let mut resources = Dictionary::new();
    resources.set("Properties", Object::Dictionary(properties));
    let mut page = Dictionary::new();
    page.set("Type", Object::Name(b"Page".to_vec()));
    page.set("Parent", Object::Reference(pages_id));
    page.set("Contents", Object::Reference(content_id));
    page.set("Resources", Object::Dictionary(resources));
    page.set("MediaBox", Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]));
    let page_id = doc.add_object(Object::Dictionary(page));
    let mut pages = Dictionary::new();
    pages.set("Type", Object::Name(b"Pages".to_vec()));
    pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
    pages.set("Count", Object::Integer(1));
    doc.objects.insert(pages_id, Object::Dictionary(pages));
    let oc_properties = dictionary! {
        "OCGs" => Object::Array(vec![Object::Reference(ocg_id)]),
        "D" => Object::Dictionary(dictionary! {
            "OFF" => Object::Array(vec![Object::Reference(ocg_id)]),
            "ON" => Object::Array(vec![]),
        }),
    };
    let catalog_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"Catalog".to_vec()),
        "Pages" => Object::Reference(pages_id),
        "OCProperties" => Object::Dictionary(oc_properties),
    });
    doc.trailer.set("Root", Object::Reference(catalog_id));

    let findings = hidden_layer_findings(&doc);
    assert!(findings.iter().any(|f| matches!(f.category, Category::HiddenLayer)
        && matches!(f.severity, Severity::High)
        && f.recovered_text.contains("hidden layer text")
        && f.page == Some(0)));
}
```

- [ ] **Step 3: Run, verify it fails**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core flags_text_hidden_in_an_inactive`
Expected: FAIL — `hidden_layer_findings` not defined.

- [ ] **Step 4: Implement** — add to `detect.rs` (outside the test module):

```rust
fn inactive_ocgs(doc: &lopdf::Document) -> Vec<lopdf::ObjectId> {
    doc.catalog()
        .ok()
        .and_then(|c| c.get(b"OCProperties").ok())
        .and_then(|o| o.as_dict().ok())
        .and_then(|ocp| ocp.get(b"D").ok())
        .and_then(|o| o.as_dict().ok())
        .and_then(|d| d.get(b"OFF").ok())
        .and_then(|o| o.as_array().ok())
        .map(|arr| arr.iter().filter_map(|o| o.as_reference().ok()).collect())
        .unwrap_or_default()
}

fn property_ocg(doc: &lopdf::Document, page_id: lopdf::ObjectId, name: &[u8]) -> Option<lopdf::ObjectId> {
    let page = doc.get_object(page_id).ok()?.as_dict().ok()?;
    let resources = page.get(b"Resources").ok()?.as_dict().ok()?;
    let properties = resources.get(b"Properties").ok()?.as_dict().ok()?;
    properties.get(name).ok()?.as_reference().ok()
}

pub(crate) fn hidden_layer_findings(doc: &lopdf::Document) -> Vec<Finding> {
    let off = inactive_ocgs(doc);
    if off.is_empty() {
        return Vec::new();
    }
    let mut findings = Vec::new();
    for (page_number, page_id) in doc.get_pages() {
        let content = match doc.get_and_decode_page_content(page_id) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let mut hidden_depth: u32 = 0;
        let mut recovered = String::new();
        for op in &content.operations {
            match op.operator.as_str() {
                "BDC" | "BMC" => {
                    let is_hidden = op.operands.first().and_then(|o| o.as_name().ok()) == Some(b"OC")
                        && op
                            .operands
                            .get(1)
                            .and_then(|o| o.as_name().ok())
                            .and_then(|name| property_ocg(doc, page_id, name))
                            .map(|ocg| off.contains(&ocg))
                            .unwrap_or(false);
                    if is_hidden || hidden_depth > 0 {
                        hidden_depth += 1;
                    }
                }
                "EMC" => hidden_depth = hidden_depth.saturating_sub(1),
                "Tj" if hidden_depth > 0 => {
                    if let Some(s) = op.operands.first().and_then(|o| o.as_str().ok()) {
                        recovered.push_str(&String::from_utf8_lossy(s));
                    }
                }
                "TJ" if hidden_depth > 0 => {
                    if let Some(arr) = op.operands.first().and_then(|o| o.as_array().ok()) {
                        for item in arr {
                            if let Ok(s) = item.as_str() {
                                recovered.push_str(&String::from_utf8_lossy(s));
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        let recovered = recovered.trim().to_string();
        if !recovered.is_empty() {
            findings.push(Finding {
                category: Category::HiddenLayer,
                severity: Severity::High,
                page: Some((page_number - 1) as usize),
                region: None,
                recovered_text: recovered,
                detail: "Text drawn on an optional-content layer that the default view hides.".into(),
            });
        }
    }
    findings
}
```

- [ ] **Step 5: Wire into `detect()`** — in `detect.rs`, in the existing structural block, add `hidden_layer_findings` alongside `structural_findings`:

```rust
    if let Ok(mut doc) = lopdf::Document::load_mem(&bytes) {
        findings.extend(structural_findings(&mut doc, 3));
        findings.extend(hidden_layer_findings(&doc));
    }
```

- [ ] **Step 6: Run, verify it passes**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core detect`
Expected: PASS (the new test + all existing). `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean. (`Category::RemovableAnnotation` is unused until Task 2; an unused pub enum variant does not warn. If clippy somehow flags it, add `#[allow(dead_code)]` to that variant with a one-line note, removed in Task 2.)

- [ ] **Step 7: Commit**

```bash
git add crates/pdf-core/src/detect.rs
git commit -m "feat(pdf-core): detect text hidden in inactive optional-content layers"
```

---

### Task 2: RemovableAnnotation detector

**Files:**

- Modify: `crates/pdf-core/src/detect.rs`

**Interfaces:**

- Consumes: `PageObservation`, `to_display_rect`, `Finding`, `Category::RemovableAnnotation` (Task 1).
- Produces: `pub(crate) fn annotation_findings(obs: &PageObservation, doc: &lopdf::Document, page_id: lopdf::ObjectId, page: usize) -> (Vec<Finding>, std::collections::BTreeSet<usize>)` — Critical `RemovableAnnotation` findings (one per obscuring annotation that covers extractable glyphs) and the set of obs.glyphs indices claimed (so the geometric pass can skip them).

- [ ] **Step 1: Write the failing test** — append to the `tests` module:

```rust
fn page_with_annot(subtype: &[u8]) -> (lopdf::Document, lopdf::ObjectId) {
    use lopdf::{dictionary, Dictionary, Document, Object, Stream};
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let content_id = doc.add_object(Stream::new(Dictionary::new(), b"BT ET".to_vec()));
    let annot_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"Annot".to_vec()),
        "Subtype" => Object::Name(subtype.to_vec()),
        "Rect" => Object::Array(vec![60.into(), 690.into(), 300.into(), 720.into()]),
    });
    let mut page = Dictionary::new();
    page.set("Type", Object::Name(b"Page".to_vec()));
    page.set("Parent", Object::Reference(pages_id));
    page.set("Contents", Object::Reference(content_id));
    page.set("MediaBox", Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]));
    page.set("Annots", Object::Array(vec![Object::Reference(annot_id)]));
    let page_id = doc.add_object(Object::Dictionary(page));
    let mut pages = Dictionary::new();
    pages.set("Type", Object::Name(b"Pages".to_vec()));
    pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
    pages.set("Count", Object::Integer(1));
    doc.objects.insert(pages_id, Object::Dictionary(pages));
    let catalog_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"Catalog".to_vec()),
        "Pages" => Object::Reference(pages_id),
    });
    doc.trailer.set("Root", Object::Reference(catalog_id));
    (doc, page_id)
}

fn obs_with_glyph_at(text: &str, display_x: f64, display_y: f64, page_height: f32) -> PageObservation {
    // Place a glyph whose DISPLAY-point center is (display_x, display_y); textpos
    // stores device-space (top-left) bboxes, so invert the y-flip used by to_display_rect.
    let dev_y = page_height as f64 - display_y;
    PageObservation {
        glyphs: vec![GlyphMark {
            text: text.into(),
            bbox: kurbo::Rect::new(display_x - 2.0, dev_y - 2.0, display_x + 2.0, dev_y + 2.0),
            order: 1,
            invisible: false,
            rgba: [0, 0, 0, 255],
        }],
        covers: vec![],
        width_pt: 612.0,
        height_pt: page_height,
    }
}

#[test]
fn flags_text_under_an_obscuring_annotation_and_claims_the_glyph() {
    let (doc, page_id) = page_with_annot(b"Square");
    let obs = obs_with_glyph_at("confidential", 72.0, 700.0, 792.0); // inside [60,690,300,720]
    let (findings, claimed) = annotation_findings(&obs, &doc, page_id, 0);
    assert_eq!(findings.len(), 1);
    assert!(matches!(findings[0].category, Category::RemovableAnnotation));
    assert!(matches!(findings[0].severity, Severity::Critical));
    assert!(findings[0].recovered_text.contains("confidential"));
    assert!(claimed.contains(&0));
}

#[test]
fn ignores_a_benign_link_annotation() {
    let (doc, page_id) = page_with_annot(b"Link");
    let obs = obs_with_glyph_at("visible", 72.0, 700.0, 792.0);
    let (findings, claimed) = annotation_findings(&obs, &doc, page_id, 0);
    assert!(findings.is_empty());
    assert!(claimed.is_empty());
}
```

- [ ] **Step 2: Run, verify they fail**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core annotation`
Expected: FAIL — `annotation_findings` not defined.

- [ ] **Step 3: Implement** — add to `detect.rs`:

```rust
use std::collections::BTreeSet;

/// Annotation subtypes that paint over page content (and can be deleted to
/// reveal it). `Redact` is the highest-signal: an unapplied redaction mark.
const OBSCURING_ANNOTATIONS: &[&[u8]] = &[
    b"Redact", b"Square", b"Circle", b"Polygon", b"FreeText", b"Stamp", b"Highlight", b"Ink",
];

fn page_annot_rects(doc: &lopdf::Document, page_id: lopdf::ObjectId) -> Vec<Rect> {
    let page = match doc.get_object(page_id).and_then(|o| o.as_dict()) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let annots = match page.get(b"Annots") {
        Ok(lopdf::Object::Array(a)) => a.clone(),
        Ok(lopdf::Object::Reference(r)) => doc
            .get_object(*r)
            .ok()
            .and_then(|o| o.as_array().ok())
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    let mut rects = Vec::new();
    for a in &annots {
        let Some(dict) = a
            .as_reference()
            .ok()
            .and_then(|id| doc.get_object(id).ok())
            .and_then(|o| o.as_dict().ok())
        else {
            continue;
        };
        let obscuring = dict
            .get(b"Subtype")
            .ok()
            .and_then(|o| o.as_name().ok())
            .map(|s| OBSCURING_ANNOTATIONS.contains(&s))
            .unwrap_or(false);
        if !obscuring {
            continue;
        }
        if let Ok(arr) = dict.get(b"Rect").and_then(|o| o.as_array()) {
            let n: Vec<f32> = arr
                .iter()
                .filter_map(|o| o.as_float().ok().or_else(|| o.as_i64().ok().map(|i| i as f32)))
                .collect();
            if n.len() == 4 {
                // PDF /Rect corners may be unordered; normalize to a display-point Rect.
                rects.push(Rect {
                    x0: n[0].min(n[2]),
                    y0: n[1].min(n[3]),
                    x1: n[0].max(n[2]),
                    y1: n[1].max(n[3]),
                });
            }
        }
    }
    rects
}

fn rect_contains(r: &Rect, x: f32, y: f32) -> bool {
    x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
}

pub(crate) fn annotation_findings(
    obs: &PageObservation,
    doc: &lopdf::Document,
    page_id: lopdf::ObjectId,
    page: usize,
) -> (Vec<Finding>, BTreeSet<usize>) {
    let rects = page_annot_rects(doc, page_id);
    let mut findings = Vec::new();
    let mut claimed = BTreeSet::new();
    for rect in &rects {
        let mut recovered = String::new();
        for (i, g) in obs.glyphs.iter().enumerate() {
            if g.invisible || g.text.trim().is_empty() {
                continue;
            }
            let display = to_display_rect(g.bbox, obs.height_pt);
            let cx = (display.x0 + display.x1) / 2.0;
            let cy = (display.y0 + display.y1) / 2.0;
            if rect_contains(rect, cx, cy) {
                recovered.push_str(&g.text);
                claimed.insert(i);
            }
        }
        if !recovered.is_empty() {
            findings.push(Finding {
                category: Category::RemovableAnnotation,
                severity: Severity::Critical,
                page: Some(page),
                region: Some(*rect),
                recovered_text: recovered,
                detail: "Extractable text sits under an annotation that can be deleted to reveal it.".into(),
            });
        }
    }
    (findings, claimed)
}
```

- [ ] **Step 4: Run, verify they pass**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core detect`
Expected: PASS. `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean.

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/detect.rs
git commit -m "feat(pdf-core): detect extractable text under removable annotations"
```

---

### Task 3: Wire into `detect()` with covered-vs-annotation precedence

**Files:**

- Modify: `crates/pdf-core/src/detect.rs`

**Interfaces:**

- Consumes: `annotation_findings`, `hidden_layer_findings` (Tasks 1–2).
- Produces: `page_geometric_findings` gains a `claimed: &std::collections::BTreeSet<usize>` parameter — glyphs whose index is claimed are skipped for the CoveredText/WhiteoutText branches (they are reported as RemovableAnnotation instead). `detect()` loads the lopdf `Document` once, runs `annotation_findings` per page, and threads `claimed` into the geometric pass.

- [ ] **Step 1: Write the failing test** — append to the `tests` module:

```rust
#[test]
fn text_under_an_annotation_is_reported_once_as_removable_annotation() {
    // hello.pdf with a Square annotation over the text region: the detector must
    // report RemovableAnnotation, not (also) CoveredText, for that text.
    let mut doc = lopdf::Document::load_mem(&corpus_bytes()).unwrap();
    let page_id = *doc.get_pages().get(&1).unwrap();
    let annot_id = doc.add_object(lopdf::dictionary! {
        "Type" => lopdf::Object::Name(b"Annot".to_vec()),
        "Subtype" => lopdf::Object::Name(b"Square".to_vec()),
        "Rect" => lopdf::Object::Array(vec![0.into(), 0.into(), 1000.into(), 1000.into()]),
    });
    let page = doc.get_dictionary_mut(page_id).unwrap();
    page.set("Annots", lopdf::Object::Array(vec![lopdf::Object::Reference(annot_id)]));
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();

    let report = detect(bytes).expect("detect");
    let removable = report.findings.iter().filter(|f| matches!(f.category, Category::RemovableAnnotation)).count();
    let covered = report.findings.iter().filter(|f| matches!(f.category, Category::CoveredText)).count();
    assert!(removable >= 1, "expected a RemovableAnnotation finding");
    assert_eq!(covered, 0, "covered text under the annotation must not be double-reported");
}
```

- [ ] **Step 2: Run, verify it fails**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core text_under_an_annotation`
Expected: FAIL — `page_geometric_findings` takes 2 args / the text is double-reported.

- [ ] **Step 3: Add the `claimed` parameter to `page_geometric_findings`** — change its signature and the CoveredText/WhiteoutText branch to skip claimed glyphs. Find the function and:
  - change `pub(crate) fn page_geometric_findings(obs: &PageObservation, page: usize) -> Vec<Finding>` to `pub(crate) fn page_geometric_findings(obs: &PageObservation, page: usize, claimed: &std::collections::BTreeSet<usize>) -> Vec<Finding>`;
  - in the loop over `obs.glyphs.iter().enumerate()` (add `.enumerate()` if not present), for the covered/whiteout branch, `continue` when `claimed.contains(&i)`. The InvisibleText branch still fires regardless (invisible text is its own category). The exact body depends on the current grouping; preserve the per-cover grouping but exclude claimed glyph indices from the covered/whiteout groups.

```rust
// sketch of the guard inside the covered/whiteout determination:
for (i, g) in obs.glyphs.iter().enumerate() {
    if g.text.trim().is_empty() { continue; }
    if g.invisible {
        // ... emit InvisibleText (unchanged) ...
        continue;
    }
    if claimed.contains(&i) { continue; } // reported as RemovableAnnotation
    // ... existing covered/whiteout grouping ...
}
```

- [ ] **Step 4: Restructure `detect()`** — load the document once, run annotations per page, thread `claimed`. Replace the page loop + structural block:

```rust
    let lo = lopdf::Document::load_mem(&bytes).ok();
    let page_ids: std::collections::BTreeMap<usize, lopdf::ObjectId> = lo
        .as_ref()
        .map(|doc| doc.get_pages().into_iter().map(|(n, id)| ((n - 1) as usize, id)).collect())
        .unwrap_or_default();

    let mut findings = Vec::new();
    let mut glyphs_examined = 0;
    let mut pages_unreadable = Vec::new();
    for page in 0..page_count {
        match crate::textpos::observe_page(&pdf, page) {
            Some(obs) => {
                glyphs_examined += obs.glyphs.len();
                let (annot_findings, claimed) = match (lo.as_ref(), page_ids.get(&page)) {
                    (Some(doc), Some(&page_id)) => annotation_findings(&obs, doc, page_id, page),
                    _ => (Vec::new(), std::collections::BTreeSet::new()),
                };
                findings.extend(annot_findings);
                findings.extend(page_geometric_findings(&obs, page, &claimed));
            }
            None => pages_unreadable.push(page),
        }
    }

    if let Some(doc) = lo.as_ref() {
        let mut doc_mut = lopdf::Document::load_mem(&bytes).unwrap_or_else(|_| doc.clone());
        findings.extend(structural_findings(&mut doc_mut, 3));
        findings.extend(hidden_layer_findings(doc));
    }
```

(`structural_findings` needs `&mut` for `traverse_objects`; keep it on its own freshly-loaded copy as shown. `hidden_layer_findings` and `annotation_findings` take `&`.)

- [ ] **Step 5: Run, verify it passes**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core`
Expected: PASS — the new precedence test, the self-cross-check (still zero findings on a redacted doc), and every existing test. `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean.

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-core/src/detect.rs
git commit -m "feat(pdf-core): wire annotation + hidden-layer detectors with covered-text precedence"
```

---

### Task 4: WASM/TS surface + docs

**Files:**

- Modify: `crates/pdf-core/src/wasm.rs`, `packages/pdf/src/index.ts`
- Modify: `packages/pdf/README.md`, `docs/decisions/pending/pdf-detector-observing-device.md`
- Create: `changelog.d/pdf-detector-fastfollow.md`
- Modify: `ROADMAP.md`, `STATUS.md` (own row only)

**Interfaces:**

- Consumes: `Category::{RemovableAnnotation, HiddenLayer}`.

- [ ] **Step 1: Extend the wasm category mapper** — in `crates/pdf-core/src/wasm.rs`, add the two arms to `category_str`:

```rust
        Category::RemovableAnnotation => "removableAnnotation",
        Category::HiddenLayer => "hiddenLayer",
```

- [ ] **Step 2: Build the wasm**

Run: `cargo build --manifest-path crates/Cargo.toml -p pdf-core --target wasm32-unknown-unknown`
Expected: compiles (the match is now exhaustive over the 7 variants).

- [ ] **Step 3: Extend the TS union** — in `packages/pdf/src/index.ts`, add the two strings to the `DetectionFinding.category` union:

```ts
  category:
    | "coveredText"
    | "invisibleText"
    | "whiteoutText"
    | "removableAnnotation"
    | "hiddenLayer"
    | "metadataLeak"
    | "orphanedText";
```

- [ ] **Step 4: Rebuild wasm + run the JS tests**

```bash
pnpm --filter @magna-carta/pdf run build:wasm
pnpm --filter @magna-carta/pdf test
```

Expected: PASS (no regression). If `pnpm` fails for an environment reason, capture the error and report it — do not fake green.

- [ ] **Step 5: Docs**
  - In `packages/pdf/README.md`: add `removableAnnotation` (`critical`) and `hiddenLayer` (`high`) rows to the categories table; **remove** the honest-boundary item that said hidden OCG detection and removable-annotation attribution are "not yet covered" (they now are), and replace it with the two new boundaries: HiddenLayer findings are page-level (`region: null`, recovered text only); RemovableAnnotation keys off annotation subtype, so a transparent annotation of an obscuring subtype over text is still flagged (high-recall) and an obscuring annotation of an unlisted subtype is not. NO process references.
  - In `docs/decisions/pending/pdf-detector-observing-device.md`: move RemovableAnnotation + HiddenLayer from the "Deferred" section into the delivered detectors (they are now structural detectors, not deferred). Update the `summary:` frontmatter line to say seven detectors with none deferred. (Process language allowed here.)
  - Create `changelog.d/pdf-detector-fastfollow.md` — match `changelog.d/pdf-detector.md` shape, `category: Added`.
  - Add an additive note to `ROADMAP.md`/`STATUS.md` for the two completed detectors (own row only).

- [ ] **Step 6: Verify the gates**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core && cargo clippy --manifest-path crates/Cargo.toml --all-targets -- -D warnings && cargo fmt --manifest-path crates/Cargo.toml --all --check`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add crates/pdf-core/src/wasm.rs packages/pdf/src/index.ts packages/pdf/README.md docs/decisions/pending/pdf-detector-observing-device.md changelog.d/pdf-detector-fastfollow.md ROADMAP.md STATUS.md
git commit -m "feat(pdf): expose removable-annotation + hidden-layer detections and update docs"
```

---

## Self-Review

**Spec coverage:** §2 HiddenLayer (T1) · RemovableAnnotation (T2) · §3 integration + §4 precedence (T3) · category surface + §6 docs (T4). §5 testing: HiddenLayer off-vs-on (T1), annotation Square/Redact-vs-Link (T2), precedence + self-cross-check (T3).

**Placeholder scan:** every code step shows complete code; the Task-3 Step-3 guard is a sketch over the current grouping because the exact body depends on Task-4-of-the-engine's grouping refactor — the implementer adapts the guard into the existing loop (the instruction names the exact change: add `.enumerate()`, `continue` on `claimed.contains(&i)` in the covered/whiteout branch only).

**Type consistency:** `Category` gains both variants in T1; `hidden_layer_findings` (T1) + `annotation_findings` (T2) consumed by `detect()` (T3); `page_geometric_findings` gains `claimed` (T3) and all its callers (only `detect()`) are updated in the same task; the wasm `category_str` (T4) and TS union (T4) cover all 7 variants. `Rect`/`Finding`/`Severity` reused unchanged.

**Read-only:** confirmed — `annotation_findings`/`hidden_layer_findings` take `&Document`; only `structural_findings` takes `&mut`, on its own freshly-loaded copy; the input bytes are never mutated.
