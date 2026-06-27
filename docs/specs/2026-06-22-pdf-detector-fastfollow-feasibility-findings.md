# Detector fast-follow (RemovableAnnotation + HiddenLayer) — feasibility findings

Spike: `spikes/detector-feasibility/src/bin/extras.rs` (run via `cargo run --bin extras`).
Run date: 2026-06-22. **Verdict: GO** — both deferred detectors are feasible as **structural** (lopdf-only) detectors. The two-phase-interpret approach feared in the engine design is **not needed**.

---

## HiddenLayer — text in an off-by-default optional-content group

Mechanism (pure lopdf, no rendering):

1. Read `/OCProperties /D /OFF` from the catalog → the set of OCG object ids the default config hides.
2. `Document::get_and_decode_page_content(page_id)` → `Vec<Operation>` (handles the content-stream array + decompression).
3. Scan operators for `/OC <name> BDC … EMC`: when a `BDC`/`BMC` has operands `[Name("OC"), Name(prop)]` and `prop` resolves through the page `/Resources /Properties` to an OCG in the OFF set, the enclosed `Tj`/`TJ` text is hidden-layer text.

Spike result: `inactive OCGs=1`, `recovered="hidden layer text"` from an OCG marked OFF. The recovered text has a **page-level region only** (the operator scan has no per-glyph geometry) — the documented boundary.

Verified lopdf API: `Document::get_and_decode_page_content(page_id) -> Result<Content>`, `Content::decode(&[u8])`, `Operation { operator: String, operands: Vec<Object> }`, `Object::{as_name, as_str, as_reference, as_array}`.

## RemovableAnnotation — opaque annotation covering text

Mechanism (lopdf `/Annots` + the existing `textpos` glyph positions):

1. For each page, read `/Annots` (inline array or indirect) → each annotation's `/Subtype` and `/Rect` (PDF points, bottom-left — the same frame the detector's `region` uses).
2. A visible+extractable glyph whose display-point bbox center falls within an annotation's `/Rect`, where the annotation is a cover-type (e.g. `Square`, `Redact`, `FreeText` with an opaque fill), is recoverable text under a removable annotation — delete the annotation and the text is revealed.

Spike result: read `[("Square", [60.0, 690.0, 300.0, 720.0])]`; a glyph at PDF point (72,700) correctly falls inside the rect. The overlap reuses the proven covered-text geometry — only the cover source (annotation rect vs page-content fill) differs, which drives the category (RemovableAnnotation = trivially reversible → Critical) and the remediation hint ("delete this annotation").

Verified lopdf API: `/Annots` reading, `Object::as_float`/`as_i64` for `/Rect` numbers.

## Design implications

- Both detectors are **structural / read-only**, consistent with the existing `structural_findings` + the `textpos` glyph map. No new hayro mechanism, no two-phase interpret.
- New report categories: `RemovableAnnotation` (Critical), `HiddenLayer` (High).
- RemovableAnnotation needs the per-page glyph positions (from `observe_page`) AND the lopdf `/Annots` — so it runs in the per-page path alongside the geometric detectors, not the document-level structural pass.
- HiddenLayer is a document-level structural detector (page-level region).
- This completes the detector's 7-category vision and lets the README drop the "OCG + removable-annotation not yet covered" boundary.
