# PDF detector fast-follow — RemovableAnnotation + HiddenLayer — design

**Status:** Draft (implementation-grade) · **Date:** 2026-06-22 · **Owner:** Trevor Goldsmith
**Builds on:** the detector engine ([`2026-06-22-pdf-detector-engine-design.md`](2026-06-22-pdf-detector-engine-design.md)) — this completes its two deferred detectors.
**Feasibility (GO):** [`2026-06-22-pdf-detector-fastfollow-feasibility-findings.md`](2026-06-22-pdf-detector-fastfollow-feasibility-findings.md) — both feasible as structural (lopdf) detectors; no two-phase interpret needed.
**ADRs to raise:** none new — folds into the existing `pdf-detector-observing-device` decision (moves the two detectors from deferred to delivered).

The detector engine shipped five detectors and honestly disclosed that hidden optional-content layers and removable annotations were not yet covered. The spike proved both are tractable as read-only structural detectors. This slice adds them, completing the seven-category vision and letting the README drop that boundary.

---

## 1. Scope

**In:** two new detectors + their report categories, wired into `detect()`; the wasm/TS category surface; docs.

1. **RemovableAnnotation (Critical).** A visible, extractable glyph whose center lies under an _obscuring_ annotation's `/Rect` (the annotation can be deleted to reveal the text). Per-page — needs both the observed glyphs and the page's `/Annots`.
2. **HiddenLayer (High).** Text drawn inside an optional-content group that the default configuration turns OFF. Document-level (page-scoped region, no per-glyph geometry).

**Out:** per-glyph geometry for HiddenLayer (the operator scan has no positions); annotation _appearance-stream_ opacity analysis (v1 keys off annotation subtype, not a rendered appearance); everything already shipped.

Read-only throughout — both detectors only read the object model and the existing observation.

## 2. Detectors

**RemovableAnnotation** (`detect.rs`, per-page). Inputs: the page's `PageObservation` (glyphs, display-point bboxes) + the lopdf `Document` + the page's lopdf `ObjectId`. For each obscuring annotation on the page (`/Subtype` in {`Redact`, `Square`, `Circle`, `Polygon`, `FreeText`, `Stamp`, `Highlight`, `Ink`} — kinds that paint over content; `Redact` is the highest signal: an _unapplied_ redaction mark), collect every visible+extractable glyph whose display-point bbox center falls inside the annotation's `/Rect`. Group per annotation → one finding with the concatenated recovered text, `region` = the annotation rect, `detail` naming the subtype and the remediation ("delete this annotation to reveal the text"). Severity **Critical** — the concealment is trivially reversible. (A glyph caught here may also match the geometric CoveredText detector; RemovableAnnotation is the more specific, more actionable category and takes precedence — the engine prefers it when the cover is an annotation.)

**HiddenLayer** (`detect.rs`, document-level). Read `/OCProperties /D /OFF` → the inactive OCG id set. For each page, `get_and_decode_page_content` → scan operators: track `/OC <name> BDC … EMC` nesting where `<name>` resolves through `/Resources /Properties` to an inactive OCG; collect `Tj`/`TJ` text inside. One finding per page with hidden-layer text, `page` set, `region` `None` (page-level), severity **High**, `detail` "Text on an optional-content layer that is hidden by default."

## 3. Integration

`detect()` already loads the lopdf `Document` for the structural pass; lift that load to the top so the per-page loop can use it. The page-index↔lopdf mapping: hayro page `i` (0-based) ↔ `get_pages()[(i+1) as u32]`. In the per-page loop, after `page_geometric_findings`, call `annotation_findings(&obs, &doc, page_id, i)`. After the loop, the document-level pass runs `structural_findings` (unchanged) plus `hidden_layer_findings(&doc)`.

The `Category` enum gains `RemovableAnnotation` and `HiddenLayer`; the severity ranking and summary already handle any severity, so no change there. The wasm category mapper and the TS union gain the two camelCase strings (`removableAnnotation`, `hiddenLayer`).

## 4. Precedence (covered vs removable-annotation)

A glyph under an annotation may also satisfy CoveredText. To avoid double-reporting and to give the more actionable result, the engine emits RemovableAnnotation for a glyph whose cover is an annotation and suppresses the geometric CoveredText for that same glyph. Implementation: run the annotation detector first per page, record the set of glyphs it claimed, and have the geometric pass skip claimed glyphs — or, simpler and equally correct for high-recall, run annotation findings and then filter geometric CoveredText findings whose region is fully inside a reported annotation rect. The plan picks the glyph-claim approach (precise, no double count).

## 5. Testing

- **RemovableAnnotation:** a built doc with text under a `Square` (and separately a `Redact`) annotation → a Critical RemovableAnnotation finding recovering the text; a benign `Link` annotation over text → no RemovableAnnotation finding.
- **HiddenLayer:** the spike's OCG doc (text in an OFF layer) → a High HiddenLayer finding recovering the text; an OCG that is ON → no finding.
- **Precedence:** text under an annotation is reported once, as RemovableAnnotation, not also as CoveredText.
- **Self-cross-check unaffected:** a properly-redacted document still yields zero findings (the new detectors add no false positive on a flattened image — no annotations, no OCGs).
- The existing `detect-smoke` continues to pass.

## 6. Boundaries (update the docs)

- HiddenLayer recovers text but not per-glyph geometry (page-level region).
- RemovableAnnotation v1 keys off annotation **subtype**, not a rendered-appearance opacity check — a transparent annotation of an obscuring subtype over text is still flagged (high-recall; a false positive a reviewer dismisses). An obscuring annotation of an unlisted subtype is not flagged (disclosed).
- The README's "hidden OCG + removable-annotation not yet covered" boundary is **removed**; the byte-level/center-containment boundaries remain.
