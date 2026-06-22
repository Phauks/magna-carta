# PDF engine — whole-document scrub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable whole-document **scrub** to `pdf-core` that removes document-level surfaces where redacted content can hide (metadata, attachments, XFA, form values, structure tree, outlines, optional-content), exposed standalone as `sanitizeDocument` and composed by `redact` (sanitized-by-default), with a hardened verification gate that decompresses every stream so a redacted string cannot survive anywhere.

**Architecture:** A new `crates/pdf-core/src/scrub.rs` holds `ScrubOptions` + `sanitize_document` (the in-place document-surface removals) and `verify_scrub_absence` (the structural-absence gate). `redact` composes `sanitize_document` after page reassembly; the existing `verify_gate` gains a logical-content decompress-and-scan. A standalone `sanitize(bytes, opts)` free function and a `sanitizeDocument` wasm/TS edge expose scrub without redaction.

**Tech Stack:** Rust (lopdf 0.41, hayro 0.7, image 0.25, wasm-bindgen 0.2), TypeScript (`@magna-carta/pdf`), Vitest.

**Design spec:** [`2026-06-22-pdf-document-scrub-design.md`](2026-06-22-pdf-document-scrub-design.md). Builds on the redaction engine in `crates/pdf-core/src/redact.rs`.

**Worktree:** execute on the existing `pdf-engine-roadmap` worktree.

## Global Constraints

- **Pin lopdf 0.41** (already a dependency). Do not move to a git SHA. hayro 0.7, image 0.25 unchanged.
- `pdf-core` is a pure compute library: typed `Result`, **no logging**, no happy-path panics.
- **No process references** in code/tests/consumer strings (no `ADR-NNNN`, "slice N", "Phase N", "spike", "design spec") — golden rule 13. State reasoning inline or cite a `docs/conventions/` path.
- **No shorthand names** (golden rule 12): `sanitize_document`, `ScrubOptions`, `sanitizeDocument`. ("pdf", "XMP", "XFA", "OCG", "id" are accepted external terms.)
- **TDD**: failing test first, watch it fail, minimal implementation, watch it pass, commit.
- **ScrubOptions defaults all-true** (scrub everything); a false field retains that surface.
- The scrub gate is **hard**: any scrubbed surface that survives, or any supplied `redacted_text` string found in document content, returns `GateFailed` and emits **no PDF**.
- **Verified lopdf 0.41 API:** `Document::{load_mem, with_version, new_object_id, add_object, get_pages, get_object(&self) (auto-derefs), get_object_mut, catalog, catalog_mut, prune_objects, save_to}`; public fields `objects: BTreeMap<ObjectId, Object>` and `trailer: Dictionary`; `Dictionary::{has, get, get_mut, set, remove, iter}`; `Object::{as_dict, as_dict_mut, as_array, as_array_mut, as_reference, as_name, string_literal, Name, String, Array, Dictionary, Reference, Boolean, Integer}`; `Stream { pub dict, pub content }`, `Stream::{new, compress, decompressed_content}`. `Object::String(Vec<u8>, StringFormat)`. `&str` is `Into<Vec<u8>>` for keys (used across the existing `redact.rs`); for **values** use explicit `Object` constructors (there is no `From<&str> for Object`).
- **Verified existing `redact.rs` surface (do not redefine):** `pub fn redact(bytes, regions, opts) -> Result<RedactionOutcome, RedactError>`; `pub(crate) fn verify_gate(doc, affected_pages_1based, redacted_text) -> Result<(), RedactError>`; `RedactionOptions { dpi: f32, redacted_text: Vec<String> }` with `Default`; `RedactError { Parse, PageOutOfRange, Render, Reassemble, GateFailed { detail } }`.

---

### Task 1: `ScrubOptions` + `sanitize_document` for the catalog/trailer surfaces

**Files:**
- Create: `crates/pdf-core/src/scrub.rs`
- Modify: `crates/pdf-core/src/lib.rs` (add `mod scrub; pub use scrub::*;`)

**Interfaces:**
- Produces: `ScrubOptions { metadata, attachments, xfa, form_field_values, structure_tree, outlines, optional_content: bool }` with `Default` (all true); `enum ScrubError { Parse, Reassemble, GateFailed { detail: String } }`; `fn sanitize_document(doc: &mut lopdf::Document, opts: &ScrubOptions) -> Result<(), ScrubError>`; `pub(crate) fn catalog_subdict_mut<'a>(doc: &'a mut lopdf::Document, key: &[u8]) -> Option<&'a mut lopdf::Dictionary>`; `pub(crate) fn catalog_subdict<'a>(doc: &'a lopdf::Document, key: &[u8]) -> Option<&'a lopdf::Dictionary>`.

- [ ] **Step 1: Write the failing tests** — create `crates/pdf-core/src/scrub.rs` with only this test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{Dictionary, Document, Object, Stream};

    /// A minimal valid document: catalog + empty Pages tree.
    pub(super) fn base_doc() -> Document {
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
        doc
    }

    /// Set a key on the catalog dictionary (helper for surface fixtures).
    pub(super) fn set_on_catalog(doc: &mut Document, key: &str, value: Object) {
        doc.catalog_mut().unwrap().set(key, value);
    }

    #[test]
    fn scrubs_metadata() {
        let mut doc = base_doc();
        let meta_id = doc.add_object(Stream::new(Dictionary::new(), b"<x>secret</x>".to_vec()));
        set_on_catalog(&mut doc, "Metadata", Object::Reference(meta_id));
        let info_id = doc.add_object(Object::Dictionary({
            let mut d = Dictionary::new();
            d.set("Author", Object::string_literal("Jane Doe"));
            d
        }));
        doc.trailer.set("Info", Object::Reference(info_id));

        sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();

        assert!(!doc.trailer.has(b"Info"));
        assert!(!doc.catalog().unwrap().has(b"Metadata"));
    }

    #[test]
    fn keeps_metadata_when_opted_out() {
        let mut doc = base_doc();
        let info_id = doc.add_object(Object::Dictionary(Dictionary::new()));
        doc.trailer.set("Info", Object::Reference(info_id));
        let opts = ScrubOptions { metadata: false, ..ScrubOptions::default() };

        sanitize_document(&mut doc, &opts).unwrap();

        assert!(doc.trailer.has(b"Info"));
    }

    #[test]
    fn scrubs_structure_outlines_and_optional_content() {
        let mut doc = base_doc();
        set_on_catalog(&mut doc, "StructTreeRoot", Object::Null);
        set_on_catalog(&mut doc, "MarkInfo", Object::Null);
        set_on_catalog(&mut doc, "Outlines", Object::Null);
        set_on_catalog(&mut doc, "OCProperties", Object::Null);

        sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();

        let cat = doc.catalog().unwrap();
        assert!(!cat.has(b"StructTreeRoot"));
        assert!(!cat.has(b"MarkInfo"));
        assert!(!cat.has(b"Outlines"));
        assert!(!cat.has(b"OCProperties"));
    }

    #[test]
    fn scrubs_xfa_but_keeps_acroform() {
        let mut doc = base_doc();
        let mut acro = Dictionary::new();
        acro.set("XFA", Object::Array(vec![]));
        acro.set("Fields", Object::Array(vec![]));
        let acro_id = doc.add_object(Object::Dictionary(acro));
        set_on_catalog(&mut doc, "AcroForm", Object::Reference(acro_id));

        sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();

        let acro = catalog_subdict(&doc, b"AcroForm").expect("AcroForm kept");
        assert!(!acro.has(b"XFA"));
        assert!(acro.has(b"Fields"));
    }
}
```

- [ ] **Step 2: Run, verify it fails**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core scrub`
Expected: FAIL — `ScrubOptions` / `sanitize_document` not defined.

- [ ] **Step 3: Implement** — prepend to `crates/pdf-core/src/scrub.rs`:

```rust
//! Whole-document scrub: remove document-level surfaces where redacted content
//! can hide (metadata, attachments, form data, structure tree, outlines,
//! optional-content), so a sanitized document carries nothing off-page.

use lopdf::{Dictionary, Document, Object, ObjectId};

/// Which document-level surfaces to remove. Every field defaults to `true`
/// (scrub everything); set a field false to retain that surface.
#[derive(Debug, Clone)]
pub struct ScrubOptions {
    /// Info dictionary + catalog `/Metadata` (XMP) stream.
    pub metadata: bool,
    /// `/Names/EmbeddedFiles`, file-attachment annotations, `/AF`, `/Collection`.
    pub attachments: bool,
    /// AcroForm `/XFA` (the XML form dataset).
    pub xfa: bool,
    /// Clear each form field's value (`/V`, `/DV`) and rendered appearance (`/AP`).
    pub form_field_values: bool,
    /// `/StructTreeRoot` + `/MarkInfo` (Tagged-PDF `ActualText`/`Alt`).
    pub structure_tree: bool,
    /// `/Outlines` (bookmarks) + named destinations.
    pub outlines: bool,
    /// `/OCProperties`, so nothing can stay hidden in an optional-content layer.
    pub optional_content: bool,
}

impl Default for ScrubOptions {
    fn default() -> Self {
        Self {
            metadata: true,
            attachments: true,
            xfa: true,
            form_field_values: true,
            structure_tree: true,
            outlines: true,
            optional_content: true,
        }
    }
}

/// What scrub can fail at. `GateFailed` means a surface (or supplied string)
/// survived verification — no PDF is emitted.
#[derive(Debug)]
pub enum ScrubError {
    Parse,
    Reassemble,
    GateFailed { detail: String },
}

/// A mutable handle to a sub-dictionary of the catalog, whether it is stored
/// inline or behind an indirect reference. `None` if absent or not a dictionary.
pub(crate) fn catalog_subdict_mut<'a>(doc: &'a mut Document, key: &[u8]) -> Option<&'a mut Dictionary> {
    let target = doc
        .catalog()
        .ok()
        .and_then(|c| c.get(key).ok())
        .and_then(|o| o.as_reference().ok());
    match target {
        Some(id) => doc.get_object_mut(id).ok().and_then(|o| o.as_dict_mut().ok()),
        None => doc
            .catalog_mut()
            .ok()
            .and_then(|c| c.get_mut(key).ok())
            .and_then(|o| o.as_dict_mut().ok()),
    }
}

/// The immutable counterpart of `catalog_subdict_mut`.
pub(crate) fn catalog_subdict<'a>(doc: &'a Document, key: &[u8]) -> Option<&'a Dictionary> {
    let obj = doc.catalog().ok()?.get(key).ok()?;
    match obj {
        Object::Reference(id) => doc.get_object(*id).ok()?.as_dict().ok(),
        Object::Dictionary(d) => Some(d),
        _ => None,
    }
}

fn scrub_metadata(doc: &mut Document) {
    doc.trailer.remove(b"Info");
    if let Ok(catalog) = doc.catalog_mut() {
        catalog.remove(b"Metadata");
    }
}

fn scrub_structure_tree(doc: &mut Document) {
    if let Ok(catalog) = doc.catalog_mut() {
        catalog.remove(b"StructTreeRoot");
        catalog.remove(b"MarkInfo");
    }
}

fn scrub_outlines(doc: &mut Document) {
    if let Ok(catalog) = doc.catalog_mut() {
        catalog.remove(b"Outlines");
    }
    if let Some(names) = catalog_subdict_mut(doc, b"Names") {
        names.remove(b"Dests");
    }
}

fn scrub_optional_content(doc: &mut Document) {
    if let Ok(catalog) = doc.catalog_mut() {
        catalog.remove(b"OCProperties");
    }
}

fn scrub_xfa(doc: &mut Document) {
    if let Some(acroform) = catalog_subdict_mut(doc, b"AcroForm") {
        acroform.remove(b"XFA");
    }
}

/// Remove the document-level surfaces selected in `opts`, in place. Performs only
/// the removals — the caller prunes orphaned objects and runs the gate.
pub fn sanitize_document(doc: &mut Document, opts: &ScrubOptions) -> Result<(), ScrubError> {
    if opts.metadata {
        scrub_metadata(doc);
    }
    if opts.xfa {
        scrub_xfa(doc);
    }
    if opts.structure_tree {
        scrub_structure_tree(doc);
    }
    if opts.outlines {
        scrub_outlines(doc);
    }
    if opts.optional_content {
        scrub_optional_content(doc);
    }
    Ok(())
}

#[allow(unused_imports)]
use lopdf::Stream; // used by later surface removals
```

- [ ] **Step 4: Wire the module** — add to `crates/pdf-core/src/lib.rs` (after the existing `mod redact; pub use redact::*;` lines):

```rust
mod scrub;
pub use scrub::*;
```

- [ ] **Step 5: Run, verify it passes**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core scrub`
Expected: PASS (4 tests). Run `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean. (If the `#[allow(unused_imports)] use lopdf::Stream;` line warns or is rejected, remove it — it is only a forward convenience; later tasks import `Stream` where used.)

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-core/src/scrub.rs crates/pdf-core/src/lib.rs
git commit -m "feat(pdf-core): document scrub options and catalog/trailer surface removal"
```

---

### Task 2: Attachments surface (embedded files, portfolio, file-attachment annotations)

**Files:**
- Modify: `crates/pdf-core/src/scrub.rs`

**Interfaces:**
- Consumes: `catalog_subdict_mut` (Task 1).
- Produces: `fn scrub_attachments(doc: &mut lopdf::Document)`, dispatched from `sanitize_document` when `opts.attachments`.

- [ ] **Step 1: Write the failing test** — append to the `tests` module in `scrub.rs`:

```rust
#[test]
fn scrubs_attachments_and_file_attachment_annotations() {
    let mut doc = base_doc();

    // /Names/EmbeddedFiles + /Collection on the catalog.
    let mut names = Dictionary::new();
    names.set("EmbeddedFiles", Object::Array(vec![]));
    let names_id = doc.add_object(Object::Dictionary(names));
    set_on_catalog(&mut doc, "Names", Object::Reference(names_id));
    set_on_catalog(&mut doc, "Collection", Object::Null);

    // A page carrying a FileAttachment annotation and a (kept) Text annotation.
    let mut file_annot = Dictionary::new();
    file_annot.set("Subtype", Object::Name(b"FileAttachment".to_vec()));
    let file_annot_id = doc.add_object(Object::Dictionary(file_annot));
    let mut text_annot = Dictionary::new();
    text_annot.set("Subtype", Object::Name(b"Text".to_vec()));
    let text_annot_id = doc.add_object(Object::Dictionary(text_annot));
    let mut page = Dictionary::new();
    page.set("Type", Object::Name(b"Page".to_vec()));
    page.set(
        "Annots",
        Object::Array(vec![Object::Reference(file_annot_id), Object::Reference(text_annot_id)]),
    );
    let page_id = doc.add_object(Object::Dictionary(page));
    // Attach the page to the (Task-1 base) Pages tree so get_pages() finds it.
    let pages_id = doc.catalog().unwrap().get(b"Pages").unwrap().as_reference().unwrap();
    let pages = doc.get_object_mut(pages_id).unwrap().as_dict_mut().unwrap();
    pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
    pages.set("Count", Object::Integer(1));
    doc.get_object_mut(page_id).unwrap().as_dict_mut().unwrap()
        .set("Parent", Object::Reference(pages_id));

    sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();

    let cat = doc.catalog().unwrap();
    assert!(!cat.has(b"Collection"));
    assert!(!catalog_subdict(&doc, b"Names").map_or(false, |n| n.has(b"EmbeddedFiles")));
    // The FileAttachment annotation is gone; the Text annotation is kept.
    let annots = doc.get_object(page_id).unwrap().as_dict().unwrap()
        .get(b"Annots").unwrap().as_array().unwrap();
    assert_eq!(annots.len(), 1);
    assert_eq!(annots[0].as_reference().unwrap(), text_annot_id);
}
```

- [ ] **Step 2: Run, verify it fails**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core scrubs_attachments`
Expected: FAIL — the FileAttachment annotation and EmbeddedFiles still present (`scrub_attachments` not wired).

- [ ] **Step 3: Implement** — add `scrub_attachments` to `scrub.rs` (outside the test module) and dispatch it from `sanitize_document`:

```rust
fn scrub_attachments(doc: &mut Document) {
    // Embedded-files name tree, portfolio, and catalog-level associated files.
    if let Some(names) = catalog_subdict_mut(doc, b"Names") {
        names.remove(b"EmbeddedFiles");
    }
    if let Ok(catalog) = doc.catalog_mut() {
        catalog.remove(b"Collection");
        catalog.remove(b"AF");
    }
    // File-attachment annotations (and /AF) on every page.
    let page_ids: Vec<ObjectId> = doc.get_pages().values().copied().collect();
    for page_id in page_ids {
        let annots: Vec<Object> = match doc
            .get_object(page_id)
            .ok()
            .and_then(|o| o.as_dict().ok())
            .and_then(|d| d.get(b"Annots").ok())
        {
            Some(Object::Array(arr)) => arr.clone(),
            Some(Object::Reference(id)) => doc
                .get_object(*id)
                .ok()
                .and_then(|o| o.as_array().ok())
                .cloned()
                .unwrap_or_default(),
            _ => Vec::new(),
        };
        if !annots.is_empty() {
            let kept: Vec<Object> = annots
                .into_iter()
                .filter(|annot| {
                    let subtype = annot
                        .as_reference()
                        .ok()
                        .and_then(|id| doc.get_object(id).ok())
                        .and_then(|o| o.as_dict().ok())
                        .and_then(|d| d.get(b"Subtype").ok())
                        .and_then(|o| o.as_name().ok())
                        .map(|name| name.to_vec());
                    subtype.as_deref() != Some(b"FileAttachment")
                })
                .collect();
            if let Ok(page) = doc.get_object_mut(page_id).and_then(|o| o.as_dict_mut()) {
                page.set("Annots", Object::Array(kept));
            }
        }
        if let Ok(page) = doc.get_object_mut(page_id).and_then(|o| o.as_dict_mut()) {
            page.remove(b"AF");
        }
    }
}
```

Add the dispatch line in `sanitize_document`, after the `xfa` branch:

```rust
    if opts.attachments {
        scrub_attachments(doc);
    }
```

- [ ] **Step 4: Run, verify it passes**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core scrub`
Expected: PASS (5 tests). `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean.

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/scrub.rs
git commit -m "feat(pdf-core): scrub embedded files, portfolio, and file-attachment annotations"
```

---

### Task 3: Form-field values surface (recursive AcroForm walk)

**Files:**
- Modify: `crates/pdf-core/src/scrub.rs`

**Interfaces:**
- Consumes: `catalog_subdict`, `catalog_subdict_mut` (Task 1).
- Produces: `pub(crate) fn collect_field_ids(doc: &lopdf::Document) -> Vec<lopdf::ObjectId>` (reused by the gate in Task 4); `fn scrub_form_field_values(doc: &mut lopdf::Document)`, dispatched from `sanitize_document` when `opts.form_field_values`.

- [ ] **Step 1: Write the failing test** — append to the `tests` module:

```rust
#[test]
fn clears_form_field_values_keeping_blank_fields() {
    let mut doc = base_doc();
    // A parent field with one child widget; both carry a value.
    let mut child = Dictionary::new();
    child.set("V", Object::string_literal("SSN 123-45-6789"));
    child.set("AP", Object::Null);
    let child_id = doc.add_object(Object::Dictionary(child));
    let mut parent = Dictionary::new();
    parent.set("T", Object::string_literal("ssn"));
    parent.set("V", Object::string_literal("SSN 123-45-6789"));
    parent.set("DV", Object::string_literal("SSN 123-45-6789"));
    parent.set("Kids", Object::Array(vec![Object::Reference(child_id)]));
    let parent_id = doc.add_object(Object::Dictionary(parent));
    let mut acro = Dictionary::new();
    acro.set("Fields", Object::Array(vec![Object::Reference(parent_id)]));
    let acro_id = doc.add_object(Object::Dictionary(acro));
    set_on_catalog(&mut doc, "AcroForm", Object::Reference(acro_id));

    sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();

    // Values and appearances cleared on the field and its widget; field kept.
    let parent = doc.get_object(parent_id).unwrap().as_dict().unwrap();
    assert!(!parent.has(b"V"));
    assert!(!parent.has(b"DV"));
    assert!(parent.has(b"T")); // the field itself remains (blank)
    let child = doc.get_object(child_id).unwrap().as_dict().unwrap();
    assert!(!child.has(b"V"));
    assert!(!child.has(b"AP"));
    // NeedAppearances set so a viewer regenerates blank appearances.
    let acro = catalog_subdict(&doc, b"AcroForm").unwrap();
    assert_eq!(acro.get(b"NeedAppearances").unwrap().as_bool().unwrap(), true);
}
```

- [ ] **Step 2: Run, verify it fails**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core clears_form_field_values`
Expected: FAIL — values still present (`scrub_form_field_values` not wired).

- [ ] **Step 3: Implement** — add to `scrub.rs` and dispatch from `sanitize_document`:

```rust
/// Every field/widget object reachable from `AcroForm /Fields` (depth-first
/// through `/Kids`). Used to clear values and, by the gate, to verify none survive.
pub(crate) fn collect_field_ids(doc: &Document) -> Vec<ObjectId> {
    let mut stack: Vec<ObjectId> = catalog_subdict(doc, b"AcroForm")
        .and_then(|acro| acro.get(b"Fields").ok())
        .and_then(|o| o.as_array().ok())
        .map(|arr| arr.iter().filter_map(|o| o.as_reference().ok()).collect())
        .unwrap_or_default();
    let mut seen = std::collections::BTreeSet::new();
    let mut ids = Vec::new();
    while let Some(id) = stack.pop() {
        if !seen.insert(id) {
            continue;
        }
        ids.push(id);
        if let Ok(kids) = doc
            .get_object(id)
            .and_then(|o| o.as_dict())
            .and_then(|d| d.get(b"Kids"))
            .and_then(|o| o.as_array())
        {
            for kid in kids {
                if let Ok(kid_id) = kid.as_reference() {
                    stack.push(kid_id);
                }
            }
        }
    }
    ids
}

fn scrub_form_field_values(doc: &mut Document) {
    for id in collect_field_ids(doc) {
        if let Ok(field) = doc.get_object_mut(id).and_then(|o| o.as_dict_mut()) {
            field.remove(b"V");
            field.remove(b"DV");
            field.remove(b"AP");
        }
    }
    if let Some(acroform) = catalog_subdict_mut(doc, b"AcroForm") {
        acroform.set("NeedAppearances", Object::Boolean(true));
    }
}
```

Add the dispatch line in `sanitize_document`, after the `attachments` branch:

```rust
    if opts.form_field_values {
        scrub_form_field_values(doc);
    }
```

- [ ] **Step 4: Run, verify it passes**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core scrub`
Expected: PASS (6 tests). `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean.

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/scrub.rs
git commit -m "feat(pdf-core): clear AcroForm field values, keeping blank fields"
```

---

### Task 4: The hardened gate — structural-absence + logical-content decompress-scan

**Files:**
- Modify: `crates/pdf-core/src/scrub.rs` (add `verify_scrub_absence`)
- Modify: `crates/pdf-core/src/redact.rs` (add `scan_logical_content`; call it inside `verify_gate`)

**Interfaces:**
- Consumes: `ScrubOptions`, `ScrubError`, `catalog_subdict`, `collect_field_ids` (Tasks 1, 3); `RedactError`, `verify_gate` (existing `redact.rs`).
- Produces: `pub(crate) fn verify_scrub_absence(doc: &lopdf::Document, opts: &ScrubOptions) -> Result<(), ScrubError>`; `pub(crate) fn scan_logical_content(doc: &lopdf::Document, needles: &[String]) -> Option<String>`.

- [ ] **Step 1: Write the failing tests** — append to the `tests` module in **`scrub.rs`**:

```rust
#[test]
fn absence_gate_passes_after_scrub_and_fails_when_surface_survives() {
    let mut doc = base_doc();
    set_on_catalog(&mut doc, "OCProperties", Object::Null);

    // Before scrub: the surface is present, so the absence gate must fail.
    let before = verify_scrub_absence(&doc, &ScrubOptions::default());
    assert!(matches!(before, Err(ScrubError::GateFailed { .. })));

    // After scrub: it is gone, so the gate passes.
    sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();
    assert!(verify_scrub_absence(&doc, &ScrubOptions::default()).is_ok());

    // If the caller opted out of optional_content, a surviving surface is allowed.
    let mut doc2 = base_doc();
    set_on_catalog(&mut doc2, "OCProperties", Object::Null);
    let opts = ScrubOptions { optional_content: false, ..ScrubOptions::default() };
    assert!(verify_scrub_absence(&doc2, &opts).is_ok());
}
```

Append to the `tests` module in **`redact.rs`**:

```rust
#[test]
fn logical_scan_finds_string_in_a_compressed_stream() {
    // A string hidden in a Flate-compressed stream is invisible to a raw-byte
    // scan but must be found by the logical-content scan.
    let mut doc = lopdf::Document::with_version("1.5");
    let mut stream = lopdf::Stream::new(lopdf::Dictionary::new(), b"top-secret-payload".to_vec());
    stream.compress().unwrap(); // FlateDecode — bytes no longer literal
    let id = doc.add_object(stream);
    let _ = id;
    // The literal must NOT survive in the serialized bytes...
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    assert!(!bytes.windows(6).any(|w| w == b"secret"));
    // ...but the logical scan decompresses and finds it.
    assert_eq!(
        scan_logical_content(&doc, &["secret".to_string()]),
        Some("secret".to_string())
    );
    // A string that is absent returns None (the scan is not a no-op the other way).
    assert_eq!(scan_logical_content(&doc, &["absent".to_string()]), None);
    // Empty needles are ignored.
    assert_eq!(scan_logical_content(&doc, &[]), None);
}
```

- [ ] **Step 2: Run, verify they fail**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core verify_scrub_absence logical_scan_finds_string_in_a_compressed_stream`
Expected: FAIL — `verify_scrub_absence` / `scan_logical_content` not defined.

- [ ] **Step 3a: Implement the absence gate** — add to `scrub.rs`:

```rust
/// Assert that every surface the caller chose to scrub is structurally absent
/// from the document. Surfaces the caller opted out of are not checked.
pub(crate) fn verify_scrub_absence(doc: &Document, opts: &ScrubOptions) -> Result<(), ScrubError> {
    let fail = |detail: &str| {
        Err(ScrubError::GateFailed {
            detail: detail.to_string(),
        })
    };
    let catalog = doc.catalog().ok();
    let catalog_has = |key: &[u8]| catalog.map(|c| c.has(key)).unwrap_or(false);

    if opts.metadata {
        if doc.trailer.has(b"Info") {
            return fail("Info dictionary survived scrub");
        }
        if catalog_has(b"Metadata") {
            return fail("XMP /Metadata survived scrub");
        }
    }
    if opts.structure_tree && (catalog_has(b"StructTreeRoot") || catalog_has(b"MarkInfo")) {
        return fail("structure tree survived scrub");
    }
    if opts.outlines && catalog_has(b"Outlines") {
        return fail("/Outlines survived scrub");
    }
    if opts.optional_content && catalog_has(b"OCProperties") {
        return fail("/OCProperties survived scrub");
    }
    if opts.xfa && catalog_subdict(doc, b"AcroForm").map(|a| a.has(b"XFA")).unwrap_or(false) {
        return fail("AcroForm /XFA survived scrub");
    }
    if opts.attachments {
        if catalog_subdict(doc, b"Names").map(|n| n.has(b"EmbeddedFiles")).unwrap_or(false) {
            return fail("/Names/EmbeddedFiles survived scrub");
        }
        if catalog_has(b"Collection") {
            return fail("/Collection survived scrub");
        }
    }
    if opts.form_field_values {
        let any_value = collect_field_ids(doc).into_iter().any(|id| {
            doc.get_object(id)
                .and_then(|o| o.as_dict())
                .map(|d| d.has(b"V") || d.has(b"DV"))
                .unwrap_or(false)
        });
        if any_value {
            return fail("a form field value survived scrub");
        }
    }
    Ok(())
}
```

- [ ] **Step 3b: Implement the logical-content scan** — add to `redact.rs` (outside the test module; `redact.rs` already imports `lopdf::{Dictionary, Object, Stream}`):

```rust
fn match_in_bytes(bytes: &[u8], needles: &[String]) -> Option<String> {
    needles
        .iter()
        .find(|s| !s.is_empty() && bytes.windows(s.len()).any(|w| w == s.as_bytes()))
        .cloned()
}

fn match_in_object(obj: &Object, needles: &[String]) -> Option<String> {
    match obj {
        Object::String(bytes, _) => match_in_bytes(bytes, needles),
        Object::Name(bytes) => match_in_bytes(bytes, needles),
        Object::Array(items) => items.iter().find_map(|o| match_in_object(o, needles)),
        Object::Dictionary(dict) => dict.iter().find_map(|(_, o)| match_in_object(o, needles)),
        Object::Stream(stream) => {
            if let Some(hit) = stream.dict.iter().find_map(|(_, o)| match_in_object(o, needles)) {
                return Some(hit);
            }
            if let Some(hit) = match_in_bytes(&stream.content, needles) {
                return Some(hit);
            }
            if let Ok(decoded) = stream.decompressed_content() {
                if let Some(hit) = match_in_bytes(&decoded, needles) {
                    return Some(hit);
                }
            }
            None
        }
        _ => None,
    }
}

/// Scan the document's *logical* content — every decoded string/name and every
/// decompressed stream — for any supplied needle. Immune to how bytes are stored
/// (Flate, object streams, cross-reference streams). Returns the first survivor.
pub(crate) fn scan_logical_content(doc: &lopdf::Document, needles: &[String]) -> Option<String> {
    if needles.is_empty() {
        return None;
    }
    doc.trailer
        .iter()
        .find_map(|(_, o)| match_in_object(o, needles))
        .or_else(|| doc.objects.values().find_map(|o| match_in_object(o, needles)))
}
```

- [ ] **Step 3c: Wire the scan into the redaction gate** — in `redact.rs`, inside `verify_gate`, after the existing whole-document `extract_text` content check and before `Ok(())`, add:

```rust
    if let Some(hit) = scan_logical_content(doc, redacted_text) {
        return Err(RedactError::GateFailed {
            detail: format!("redacted text present in document content: {hit}"),
        });
    }
```

- [ ] **Step 4: Run, verify they pass**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core`
Expected: PASS (all scrub + redaction tests). `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean.

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/scrub.rs crates/pdf-core/src/redact.rs
git commit -m "feat(pdf-core): scrub absence gate and logical-content decompress scan"
```

---

### Task 5: Standalone `sanitize` + compose scrub into `redact`

**Files:**
- Modify: `crates/pdf-core/src/scrub.rs` (add the `sanitize` free function)
- Modify: `crates/pdf-core/src/redact.rs` (`RedactionOptions.scrub`; run scrub inside `redact`)

**Interfaces:**
- Consumes: `sanitize_document`, `verify_scrub_absence`, `ScrubOptions`, `ScrubError` (Tasks 1–4).
- Produces: `pub fn sanitize(bytes: Vec<u8>, opts: &ScrubOptions) -> Result<Vec<u8>, ScrubError>`; `RedactionOptions` gains `pub scrub: ScrubOptions` (default all-true); `redact` runs `sanitize_document` + `verify_scrub_absence`.

- [ ] **Step 1: Write the failing tests** — append to the `tests` module in **`scrub.rs`**:

```rust
#[test]
fn sanitize_round_trips_and_strips_metadata() {
    let mut doc = base_doc();
    let info_id = doc.add_object(Object::Dictionary({
        let mut d = Dictionary::new();
        d.set("Author", Object::string_literal("Jane Doe"));
        d
    }));
    doc.trailer.set("Info", Object::Reference(info_id));
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();

    let out = sanitize(bytes, &ScrubOptions::default()).expect("sanitize succeeds");

    let reloaded = Document::load_mem(&out).unwrap();
    assert!(!reloaded.trailer.has(b"Info"));
    assert!(!out.windows(8).any(|w| w == b"Jane Doe"));
}
```

Append to the `tests` module in **`redact.rs`**:

```rust
#[test]
fn redact_scrubs_metadata_by_default() {
    // The hello fixture, given an Info dictionary, must come back scrubbed after redaction.
    let mut lo = lopdf::Document::load_mem(&hello_bytes()).unwrap();
    let info_id = lo.add_object(lopdf::Object::Dictionary({
        let mut d = lopdf::Dictionary::new();
        d.set("Author", lopdf::Object::string_literal("Jane Doe"));
        d
    }));
    lo.trailer.set("Info", lopdf::Object::Reference(info_id));
    let mut seeded = Vec::new();
    lo.save_to(&mut seeded).unwrap();

    let regions = [RedactionRegion {
        page: 0,
        rect: Rect { x0: 0.0, y0: 0.0, x1: 1000.0, y1: 1000.0 },
        reason: None,
    }];
    let outcome = redact(seeded, &regions, &RedactionOptions::default()).unwrap();

    let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
    assert!(!reloaded.trailer.has(b"Info"));
    assert!(!outcome.pdf.windows(8).any(|w| w == b"Jane Doe"));
}
```

- [ ] **Step 2: Run, verify they fail**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core sanitize_round_trips redact_scrubs_metadata_by_default`
Expected: FAIL — `sanitize` not defined; `RedactionOptions` has no `scrub` field / `redact` does not scrub.

- [ ] **Step 3a: Add the standalone `sanitize`** — add to `scrub.rs`:

```rust
/// Load a PDF, scrub the selected document-level surfaces, drop the orphaned
/// objects, verify their structural absence, and re-serialize. Standalone — no
/// page redaction. Returns `GateFailed` (emitting nothing) if a surface survives.
pub fn sanitize(bytes: Vec<u8>, opts: &ScrubOptions) -> Result<Vec<u8>, ScrubError> {
    let mut doc = Document::load_mem(&bytes).map_err(|_| ScrubError::Parse)?;
    sanitize_document(&mut doc, opts)?;
    doc.prune_objects();
    verify_scrub_absence(&doc, opts)?;
    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|_| ScrubError::Reassemble)?;
    Ok(out)
}
```

- [ ] **Step 3b: Add `scrub` to `RedactionOptions`** — in `redact.rs`, extend the struct and its `Default`:

```rust
// In `pub struct RedactionOptions { ... }`, add the field:
    /// Which document-level surfaces to scrub. Defaults to all (sanitized-by-default).
    pub scrub: crate::ScrubOptions,
```

```rust
// In `impl Default for RedactionOptions`, add to the constructed value:
            scrub: crate::ScrubOptions::default(),
```

- [ ] **Step 3c: Run scrub inside `redact`** — in `redact.rs`, in `redact`, replace the block:

```rust
    // Replacing /Contents only unlinks the original streams. Physically drop
    // every now-unreferenced object (the original content streams, fonts, and
    // image resources) so their bytes — including the original text operators —
    // are not written to the output, where a raw-byte scan could recover them.
    lo.prune_objects();

    let affected_1based: Vec<u32> = redacted.iter().map(|p| (*p + 1) as u32).collect();
    verify_gate(&lo, &affected_1based, &opts.redacted_text)?;
```

with:

```rust
    // Remove document-level surfaces where redacted content can hide (metadata,
    // attachments, form values, structure tree, outlines, optional-content),
    // then physically drop every now-unreferenced object — the original content
    // streams plus the scrubbed surfaces — so nothing survives in the output.
    crate::sanitize_document(&mut lo, &opts.scrub).map_err(map_scrub_err)?;
    lo.prune_objects();
    crate::verify_scrub_absence(&lo, &opts.scrub).map_err(map_scrub_err)?;

    let affected_1based: Vec<u32> = redacted.iter().map(|p| (*p + 1) as u32).collect();
    verify_gate(&lo, &affected_1based, &opts.redacted_text)?;
```

and add this mapping helper to `redact.rs` (outside the test module):

```rust
fn map_scrub_err(e: crate::ScrubError) -> RedactError {
    match e {
        crate::ScrubError::Parse => RedactError::Parse,
        crate::ScrubError::Reassemble => RedactError::Reassemble,
        crate::ScrubError::GateFailed { detail } => RedactError::GateFailed { detail },
    }
}
```

- [ ] **Step 4: Run, verify they pass**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core`
Expected: PASS (all tests, including the existing redaction tests — confirm none regressed). `cargo clippy --manifest-path crates/Cargo.toml -p pdf-core -- -D warnings` — clean.

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/scrub.rs crates/pdf-core/src/redact.rs
git commit -m "feat(pdf-core): standalone sanitize and sanitized-by-default redaction"
```

---

### Task 6: WASM edge + `@magna-carta/pdf` wrapper

**Files:**
- Modify: `crates/pdf-core/src/wasm.rs`
- Modify: `packages/pdf/src/index.ts`
- Test: `packages/pdf/test/sanitize.test.ts`

**Interfaces:**
- Consumes: `sanitize`, `ScrubOptions` (Task 5); the existing `redactDocument` edge + `redact`.
- Produces (JS): `sanitizeDocument(bytes: Uint8Array, opts?: ScrubOptions): { pdf: Uint8Array }`; `ScrubOptions = { metadata?, attachments?, xfa?, formFieldValues?, structureTree?, outlines?, optionalContent?: boolean }`; `redactDocument` opts gain `scrub?: ScrubOptions`.

- [ ] **Step 1: Add the wasm edge** — add to `crates/pdf-core/src/wasm.rs`:

```rust
use crate::{sanitize, ScrubOptions};

impl From<crate::ScrubError> for JsError {
    fn from(e: crate::ScrubError) -> Self {
        match e {
            crate::ScrubError::Parse => JsError::new("failed to parse PDF"),
            crate::ScrubError::Reassemble => JsError::new("failed to reassemble PDF"),
            crate::ScrubError::GateFailed { detail } => {
                JsError::new(&format!("sanitize verification failed: {detail}"))
            }
        }
    }
}

#[derive(serde::Deserialize)]
struct JsScrubOptions {
    metadata: Option<bool>,
    attachments: Option<bool>,
    xfa: Option<bool>,
    #[serde(rename = "formFieldValues")]
    form_field_values: Option<bool>,
    #[serde(rename = "structureTree")]
    structure_tree: Option<bool>,
    outlines: Option<bool>,
    #[serde(rename = "optionalContent")]
    optional_content: Option<bool>,
}

fn scrub_options_from_js(value: &JsValue) -> Result<ScrubOptions, JsError> {
    if value.is_undefined() || value.is_null() {
        return Ok(ScrubOptions::default());
    }
    let js: JsScrubOptions = serde_wasm_bindgen::from_value(value.clone())?;
    let d = ScrubOptions::default();
    Ok(ScrubOptions {
        metadata: js.metadata.unwrap_or(d.metadata),
        attachments: js.attachments.unwrap_or(d.attachments),
        xfa: js.xfa.unwrap_or(d.xfa),
        form_field_values: js.form_field_values.unwrap_or(d.form_field_values),
        structure_tree: js.structure_tree.unwrap_or(d.structure_tree),
        outlines: js.outlines.unwrap_or(d.outlines),
        optional_content: js.optional_content.unwrap_or(d.optional_content),
    })
}

#[wasm_bindgen(js_name = sanitizeDocument)]
pub fn sanitize_document_edge(bytes: Vec<u8>, opts: JsValue) -> Result<JsValue, JsError> {
    let options = scrub_options_from_js(&opts)?;
    let out = sanitize(bytes, &options)?;
    let result = js_sys::Object::new();
    js_sys::Reflect::set(&result, &"pdf".into(), &js_sys::Uint8Array::from(&out[..]))
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    Ok(result.into())
}
```

Then wire the optional `scrub` field into the existing `redact_document`. Adding `scrub` to `RedactionOptions` (Task 5) makes the current `RedactionOptions { dpi, redacted_text }` construction fail to compile (missing field), so this edit is required. The function's `opts: JsValue` is consumed by `serde_wasm_bindgen::from_value(opts)?`, so read the `scrub` sub-value **before** that move.

In `redact_document`, replace this block (currently lines ~128–150):

```rust
    let js_opts: JsOpts = if opts.is_undefined() || opts.is_null() {
        JsOpts::default()
    } else {
        serde_wasm_bindgen::from_value(opts)?
    };

    let regions: Vec<RedactionRegion> = js_regions
        .into_iter()
        .map(|r| RedactionRegion {
            page: r.page,
            rect: Rect {
                x0: r.rect.x0,
                y0: r.rect.y0,
                x1: r.rect.x1,
                y1: r.rect.y1,
            },
            reason: r.reason,
        })
        .collect();
    let options = RedactionOptions {
        dpi: js_opts.dpi.unwrap_or(300.0),
        redacted_text: js_opts.redacted_text,
    };
```

with:

```rust
    // Read the optional `scrub` sub-object before `opts` is consumed below.
    let scrub_value = if opts.is_undefined() || opts.is_null() {
        JsValue::UNDEFINED
    } else {
        js_sys::Reflect::get(&opts, &"scrub".into()).unwrap_or(JsValue::UNDEFINED)
    };
    let js_opts: JsOpts = if opts.is_undefined() || opts.is_null() {
        JsOpts::default()
    } else {
        serde_wasm_bindgen::from_value(opts)?
    };

    let regions: Vec<RedactionRegion> = js_regions
        .into_iter()
        .map(|r| RedactionRegion {
            page: r.page,
            rect: Rect {
                x0: r.rect.x0,
                y0: r.rect.y0,
                x1: r.rect.x1,
                y1: r.rect.y1,
            },
            reason: r.reason,
        })
        .collect();
    let options = RedactionOptions {
        dpi: js_opts.dpi.unwrap_or(300.0),
        redacted_text: js_opts.redacted_text,
        scrub: scrub_options_from_js(&scrub_value)?,
    };
```

- [ ] **Step 2: Build the wasm to verify it compiles**

Run: `cargo build --manifest-path crates/Cargo.toml -p pdf-core --target wasm32-unknown-unknown`
Expected: compiles. (If `wasm32-unknown-unknown` is missing: `rustup target add wasm32-unknown-unknown`.)

- [ ] **Step 3: Add the TS wrapper** — append to `packages/pdf/src/index.ts`:

```ts
export interface ScrubOptions {
  /** Info dictionary + XMP metadata. Default true. */
  metadata?: boolean;
  /** Embedded files, file-attachment annotations, portfolio. Default true. */
  attachments?: boolean;
  /** AcroForm XFA dataset. Default true. */
  xfa?: boolean;
  /** Clear form field values (keeps a blank form). Default true. */
  formFieldValues?: boolean;
  /** Tagged-PDF structure tree (ActualText/Alt). Default true. */
  structureTree?: boolean;
  /** Bookmarks and named destinations. Default true. */
  outlines?: boolean;
  /** Optional-content (layer) configuration. Default true. */
  optionalContent?: boolean;
}

export interface SanitizeResult {
  pdf: Uint8Array;
}

import { sanitizeDocument as wasmSanitize } from "./pkg/pdf_core.js";

/**
 * Remove document-level surfaces where sensitive content can hide (metadata,
 * attachments, form values, structure tree, bookmarks, optional-content). Every
 * surface is removed by default; pass `false` for a surface to retain it. Throws
 * if verification finds a scrubbed surface surviving (no document is returned).
 */
export async function sanitizeDocument(
  bytes: Uint8Array,
  opts: ScrubOptions = {},
): Promise<SanitizeResult> {
  await ensureReady();
  return wasmSanitize(bytes, opts) as SanitizeResult;
}
```

Also extend the existing `RedactionOptions` interface in `index.ts` with `scrub?: ScrubOptions;` (add the property to the interface; no other change).

- [ ] **Step 4: Write the failing JS test** — create `packages/pdf/test/sanitize.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, sanitizeDocument, loadDocument } from "../src/index.js";

const hello = new Uint8Array(
  readFileSync(fileURLToPath(new URL("./fixtures/hello.pdf", import.meta.url))),
);

describe("sanitizeDocument", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("returns a still-loadable PDF", async () => {
    const result = await sanitizeDocument(hello);
    const doc = await loadDocument(result.pdf);
    expect(doc.pageCount).toBeGreaterThanOrEqual(1);
    doc.free();
  });

  it("accepts per-surface opt-outs", async () => {
    const result = await sanitizeDocument(hello, { metadata: false });
    expect(result.pdf.byteLength).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Build wasm, run the test**

```bash
pnpm --filter @magna-carta/pdf run build:wasm
pnpm --filter @magna-carta/pdf test
```
Expected: PASS (the slice-1 render tests + the redaction tests + the 2 new sanitize tests). If `pnpm` fails for an environment reason (not a code error), capture the exact error and report it — do not fake green.

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-core/src/wasm.rs packages/pdf/src/index.ts packages/pdf/test/sanitize.test.ts
git commit -m "feat(pdf): sanitizeDocument wasm edge, scrub option on redactDocument"
```

---

### Task 7: `pdf-eval` sanitize smoke + CI + docs

**Files:**
- Modify: `crates/pdf-eval/src/main.rs`
- Modify: `.github/workflows/ci.yml`
- Modify: `packages/pdf/README.md` (append a Sanitize section)
- Create: `docs/decisions/pending/pdf-document-scrub.md`
- Create: `changelog.d/pdf-document-scrub.md`
- Modify: `ROADMAP.md`, `STATUS.md` (own slice row only)

**Interfaces:**
- Consumes: `pdf_core::{sanitize, ScrubOptions}`.
- Produces: a `pdf-eval sanitize-smoke <pdf>` mode that sanitizes a corpus file with default options and asserts the absence gate passes.

- [ ] **Step 1: Add the sanitize-smoke mode** — in `crates/pdf-eval/src/main.rs`, add to the `match` in `main()`:

```rust
        Some("sanitize-smoke") => sanitize_smoke_mode(args.next().expect("usage: sanitize-smoke <pdf>")),
```

and add the function (ungated — uses only `pdf-core`, no pdfium):

```rust
fn sanitize_smoke_mode(path: String) {
    let bytes = std::fs::read(&path).unwrap();
    match pdf_core::sanitize(bytes, &pdf_core::ScrubOptions::default()) {
        Ok(out) => {
            println!("ok   sanitized {} bytes -> {} bytes", std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0), out.len());
        }
        Err(e) => {
            eprintln!("FAIL sanitize gate: {e:?}");
            std::process::exit(1);
        }
    }
}
```

Also update the usage/help text in the fallback `match` arm to mention `sanitize-smoke`.

- [ ] **Step 2: Verify the smoke passes on a corpus file**

Run: `cargo run --manifest-path crates/Cargo.toml -p pdf-eval --release -- sanitize-smoke crates/pdf-eval/corpus-ci/basicapi.pdf`
Expected: `ok sanitized N bytes -> M bytes`, exit 0. (If `crates/pdf-eval/corpus-ci/basicapi.pdf` is absent, list `crates/pdf-eval/corpus-ci/` and use an available file, noting the substitution.) Run `cargo clippy --manifest-path crates/Cargo.toml -p pdf-eval -- -D warnings` — clean.

- [ ] **Step 3: Add a CI sanitize-smoke step** — in `.github/workflows/ci.yml`, in the `rust-pdf-core` job after the existing `redact-smoke` step, add (match the neighboring step's form, and give it a `name:`):

```yaml
      - name: pdf-eval sanitize-smoke (default features — no pdfium)
        run: cargo run --manifest-path crates/Cargo.toml -p pdf-eval --release -- sanitize-smoke crates/pdf-eval/corpus-ci/basicapi.pdf
```

- [ ] **Step 4: Write the docs**
  - Append a "Sanitize" section to `packages/pdf/README.md`: document `sanitizeDocument(bytes, opts?)`, the seven `ScrubOptions` flags (each defaulting `true`), and that redaction is sanitized-by-default (with `redactDocument` accepting `scrub?`). State plainly the two honest boundaries: optional-content scrub is config-level (the decompress-scan still catches supplied strings), and removing the structure tree drops accessibility tagging. NO process references.
  - Create `docs/decisions/pending/pdf-document-scrub.md` — match the frontmatter of the existing `docs/decisions/pending/pdf-redaction-rasterize-route.md`. Record: sanitize-by-default with per-surface opt-outs; the five-layer hard gate including the logical-content decompress-and-scan that closes compressed survival; OCG content-level excision and selective metadata retention deferred.
  - Create `changelog.d/pdf-document-scrub.md` — match the format of `changelog.d/pdf-redaction.md`, `category: Added`.
  - Add an additive row/bullet to `ROADMAP.md` and `STATUS.md` for the scrub work (do not modify other rows).

- [ ] **Step 5: Verify the gates locally**

Run: `cargo test --manifest-path crates/Cargo.toml -p pdf-core && cargo clippy --manifest-path crates/Cargo.toml --all-targets -- -D warnings && cargo fmt --manifest-path crates/Cargo.toml --all --check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-eval/src/main.rs .github/workflows/ci.yml packages/pdf/README.md docs/decisions/pending/pdf-document-scrub.md changelog.d/pdf-document-scrub.md ROADMAP.md STATUS.md
git commit -m "feat(pdf-eval): sanitize smoke gate, CI, and docs"
```

---

## Self-Review

**Spec coverage:** §1 dependency pin (Global Constraints + Task 1 keeps lopdf 0.41). §2 architecture: `scrub.rs` module (T1), `sanitize_document` composed by `redact` (T5), standalone `sanitize`/`sanitizeDocument` (T5/T6), `ScrubError`→`RedactError` mapping (T5 `map_scrub_err`). §3 per-surface semantics: metadata/xfa/structure/outlines/optional-content (T1), attachments incl. FileAttachment annots (T2), form-field values (T3); `prune_objects` after scrub (T5 redact path, T5 `sanitize`). §4 hardened gate: structural-absence (T4 `verify_scrub_absence`), logical-content decompress-scan (T4 `scan_logical_content` wired into `verify_gate`), negative test (T4 `logical_scan_finds_string_in_a_compressed_stream` asserts both find and not-find; `absence_gate_passes_after_scrub_and_fails_when_surface_survives` proves the absence gate can fail). §5 wasm/TS (T6). §6 testing: per-surface both-ways toggles (T1–T3), logical scan on a compressed stream (T4), composition (T5), smoke (T7). §7 deferred seams: untouched (OCG content-level, selective metadata, unaffected-page text) — recorded in the ADR (T7).

**Placeholder scan:** every code step shows complete code. The Task 6 note about `redact_document`'s opts shape is conditional guidance with the exact `Reflect::get` fallback given, not a blank. The Task 7 fixture-substitution note gives an exact fallback action.

**Type consistency:** `ScrubOptions` (7 named bool fields) and `ScrubError` (`Parse`/`Reassemble`/`GateFailed`) defined in T1, consumed unchanged in T2–T7; `catalog_subdict`/`catalog_subdict_mut` (T1) reused in T2–T4; `collect_field_ids` (T3) reused in T4; `verify_scrub_absence`/`scan_logical_content` (T4) consumed by T5; `sanitize` (T5) consumed by T6/T7; JS `sanitizeDocument(bytes, opts)` (T6) matches the wasm `#[wasm_bindgen(js_name = sanitizeDocument)]` export; `RedactionOptions.scrub` (T5) marshaled by T6. The redaction `verify_gate` signature is unchanged (T4 only adds a call inside its body); `RedactionOptions` gains one field with a Default, so existing `RedactionOptions::default()` callers are unaffected.

**Refinement noted vs the spec:** the design's `optional_content` is realized as `/OCProperties` removal (config-level) exactly as the spec's §3 note states; no scope drift. Per-surface tests build documents programmatically with lopdf (deterministic) rather than hunting corpus fixtures — a cleaner realization of the spec's testing intent.
