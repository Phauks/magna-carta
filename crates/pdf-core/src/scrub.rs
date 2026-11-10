//! Whole-document scrub: remove document-level surfaces where redacted content
//! can hide (metadata, attachments, form data, structure tree, outlines,
//! optional-content), so a sanitized document carries nothing off-page.

use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::surgery::resolve_array;

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
    /// Clear each form field's value (`/V`, `/DV`, `/RV`) and the rendered appearance (`/AP`)
    /// of every field that is not a button. A button keeps its appearance, reset to off.
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
    /// The document is locked with a password and was not opened: nothing in it can be
    /// read, so there is nothing to work on until [`crate::decrypt`] has unlocked it.
    Encrypted,
    /// Input rejected by the decompression-bomb guard (oversize or a bomb).
    Rejected,
    Parse,
    Reassemble,
    GateFailed {
        detail: String,
    },
}

/// A mutable handle to a sub-dictionary of the catalog, whether it is stored
/// inline or behind an indirect reference. `None` if absent or not a dictionary.
pub(crate) fn catalog_subdict_mut<'a>(
    doc: &'a mut Document,
    key: &[u8],
) -> Option<&'a mut Dictionary> {
    let target = doc
        .catalog()
        .ok()
        .and_then(|c| c.get(key).ok())
        .and_then(|o| o.as_reference().ok());
    match target {
        Some(id) => doc
            .get_object_mut(id)
            .ok()
            .and_then(|o| o.as_dict_mut().ok()),
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

/// How deep a field tree or a `/Parent` chain is followed before it is treated as a cycle.
const MAX_FIELD_DEPTH: usize = 64;

/// Whether a dictionary is a form field or a widget, judged from the object alone: it
/// declares a field type, is a widget annotation, or is a named node with children.
fn is_field_like(dict: &Dictionary) -> bool {
    dict.has(b"FT")
        || matches!(dict.get(b"Subtype"), Ok(Object::Name(name)) if name == b"Widget")
        || (dict.has(b"T") && dict.has(b"Kids"))
}

/// Every field or widget dictionary in the document, found by scanning the objects
/// themselves instead of walking down from `AcroForm /Fields`. A widget a page lists but
/// the field tree does not, or a tree the walk cannot follow, is still found here, which
/// is what lets the gate check the scrub without repeating the scrub's own walk.
fn scan_field_like_ids(doc: &Document) -> Vec<ObjectId> {
    doc.objects
        .iter()
        .filter(|(_, object)| object.as_dict().map(is_field_like).unwrap_or(false))
        .map(|(id, _)| *id)
        .collect()
}

/// Every field/widget object: those reachable from `AcroForm /Fields` (depth-first
/// through `/Kids`, each stored inline or behind a reference) together with every
/// field-like object the document holds. Used to clear values and to report them.
pub(crate) fn collect_field_ids(doc: &Document) -> Vec<ObjectId> {
    let mut stack: Vec<ObjectId> = catalog_subdict(doc, b"AcroForm")
        .and_then(|acro| acro.get(b"Fields").ok())
        .and_then(|o| resolve_array(doc, o))
        .map(|arr| arr.iter().filter_map(|o| o.as_reference().ok()).collect())
        .unwrap_or_default();
    let mut seen = std::collections::BTreeSet::new();
    while let Some(id) = stack.pop() {
        if !seen.insert(id) {
            continue;
        }
        if let Some(kids) = doc
            .get_object(id)
            .and_then(|o| o.as_dict())
            .and_then(|d| d.get(b"Kids"))
            .ok()
            .and_then(|o| resolve_array(doc, o))
        {
            for kid in kids {
                if let Ok(kid_id) = kid.as_reference() {
                    stack.push(kid_id);
                }
            }
        }
    }
    seen.extend(scan_field_like_ids(doc));
    seen.into_iter().collect()
}

/// Whether a field or widget is a button (checkbox, radio button or push button). The
/// field type is inheritable, so a widget with none of its own takes its parent's.
fn is_button_field(doc: &Document, id: ObjectId) -> bool {
    let mut current = Some(id);
    for _ in 0..MAX_FIELD_DEPTH {
        let Some(dict) = current
            .and_then(|id| doc.get_object(id).ok())
            .and_then(|o| o.as_dict().ok())
        else {
            return false;
        };
        if let Ok(field_type) = dict.get(b"FT").and_then(|o| o.as_name()) {
            return field_type == b"Btn";
        }
        current = dict.get(b"Parent").and_then(|o| o.as_reference()).ok();
    }
    false
}

fn scrub_form_field_values(doc: &mut Document) {
    for id in collect_field_ids(doc) {
        let is_button = is_button_field(doc, id);
        if let Ok(field) = doc.get_object_mut(id).and_then(|o| o.as_dict_mut()) {
            field.remove(b"V");
            field.remove(b"DV");
            field.remove(b"RV");
            if is_button {
                // A button's appearance is the drawing of its states (the tick, the dot),
                // not anything the person entered, and it is the only place the name of
                // the "on" state is recorded. Removing it leaves a checkbox that can never
                // be ticked again, so it stays and the widget is reset to its off state.
                if field.has(b"AS") {
                    field.set("AS", Object::Name(b"Off".to_vec()));
                }
            } else {
                field.remove(b"AP");
            }
        }
    }
    if let Some(acroform) = catalog_subdict_mut(doc, b"AcroForm") {
        acroform.set("NeedAppearances", Object::Boolean(true));
    }
}

fn scrub_xfa(doc: &mut Document) {
    if let Some(acroform) = catalog_subdict_mut(doc, b"AcroForm") {
        acroform.remove(b"XFA");
    }
}

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
        let annots = crate::annotations::page_annotation_entries(doc, page_id);
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
    if opts.outlines {
        if catalog_has(b"Outlines") {
            return fail("/Outlines survived scrub");
        }
        if catalog_subdict(doc, b"Names")
            .map(|n| n.has(b"Dests"))
            .unwrap_or(false)
        {
            return fail("/Names/Dests survived scrub");
        }
    }
    if opts.optional_content && catalog_has(b"OCProperties") {
        return fail("/OCProperties survived scrub");
    }
    if opts.xfa
        && catalog_subdict(doc, b"AcroForm")
            .map(|a| a.has(b"XFA"))
            .unwrap_or(false)
    {
        return fail("AcroForm /XFA survived scrub");
    }
    if opts.attachments {
        if catalog_subdict(doc, b"Names")
            .map(|n| n.has(b"EmbeddedFiles"))
            .unwrap_or(false)
        {
            return fail("/Names/EmbeddedFiles survived scrub");
        }
        if catalog_has(b"Collection") {
            return fail("/Collection survived scrub");
        }
        if catalog_has(b"AF") {
            return fail("catalog /AF survived scrub");
        }
        for page_id in doc.get_pages().values().copied().collect::<Vec<_>>() {
            let page = match doc.get_object(page_id).and_then(|o| o.as_dict()) {
                Ok(page) => page,
                Err(_) => continue,
            };
            if page.has(b"AF") {
                return fail("a page /AF survived scrub");
            }
            let annots = crate::annotations::page_annotation_entries(doc, page_id);
            for annot in &annots {
                let is_file_attachment = annot
                    .as_reference()
                    .ok()
                    .and_then(|id| doc.get_object(id).ok())
                    .and_then(|o| o.as_dict().ok())
                    .and_then(|d| d.get(b"Subtype").ok())
                    .and_then(|o| o.as_name().ok())
                    .map(|name| name == b"FileAttachment")
                    .unwrap_or(false);
                if is_file_attachment {
                    return fail("a FileAttachment annotation survived scrub");
                }
            }
        }
    }
    if opts.form_field_values {
        // Deliberately the object scan and not the field-tree walk the scrub used: a
        // check that repeats the scrub's walk passes whenever that walk finds nothing.
        let any_value = scan_field_like_ids(doc).into_iter().any(|id| {
            doc.get_object(id)
                .and_then(|o| o.as_dict())
                .map(|d| d.has(b"V") || d.has(b"DV") || d.has(b"RV"))
                .unwrap_or(false)
        });
        if any_value {
            return fail("a form field value survived scrub");
        }
    }
    Ok(())
}

/// Load a PDF, scrub the selected document-level surfaces, drop the orphaned
/// objects, verify their structural absence, and re-serialize. Standalone — no
/// page redaction. Returns `GateFailed` (emitting nothing) if a surface survives.
pub fn sanitize(bytes: Vec<u8>, opts: &ScrubOptions) -> Result<Vec<u8>, ScrubError> {
    crate::guard::guard_input(&bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| ScrubError::Rejected)?;
    let mut doc = Document::load_mem(&bytes).map_err(|_| ScrubError::Parse)?;
    if crate::guard::is_locked(&doc) {
        return Err(ScrubError::Encrypted);
    }
    sanitize_document(&mut doc, opts)?;
    doc.prune_objects();
    verify_scrub_absence(&doc, opts)?;
    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|_| ScrubError::Reassemble)?;
    Ok(out)
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
    if opts.attachments {
        scrub_attachments(doc);
    }
    if opts.form_field_values {
        scrub_form_field_values(doc);
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
        let opts = ScrubOptions {
            metadata: false,
            ..ScrubOptions::default()
        };

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
        assert!(acro.get(b"NeedAppearances").unwrap().as_bool().unwrap());
    }

    /// A one-checkbox form: a merged field and widget, ticked, with an on-state named `Agree`.
    fn checkbox_form(fields_behind_a_reference: bool) -> (Document, ObjectId) {
        let mut doc = base_doc();
        let on_id = doc.add_object(Stream::new(Dictionary::new(), b"q Q".to_vec()));
        let off_id = doc.add_object(Stream::new(Dictionary::new(), b"q Q".to_vec()));
        let mut states = Dictionary::new();
        states.set("Agree", Object::Reference(on_id));
        states.set("Off", Object::Reference(off_id));
        let mut appearance = Dictionary::new();
        appearance.set("N", Object::Dictionary(states));
        let mut field = Dictionary::new();
        field.set("FT", Object::Name(b"Btn".to_vec()));
        field.set("Subtype", Object::Name(b"Widget".to_vec()));
        field.set("T", Object::string_literal("agree"));
        field.set("V", Object::Name(b"Agree".to_vec()));
        field.set("AS", Object::Name(b"Agree".to_vec()));
        field.set("AP", Object::Dictionary(appearance));
        let field_id = doc.add_object(Object::Dictionary(field));
        let fields = Object::Array(vec![Object::Reference(field_id)]);
        let mut acro = Dictionary::new();
        if fields_behind_a_reference {
            let fields_id = doc.add_object(fields);
            acro.set("Fields", Object::Reference(fields_id));
        } else {
            acro.set("Fields", fields);
        }
        let acro_id = doc.add_object(Object::Dictionary(acro));
        set_on_catalog(&mut doc, "AcroForm", Object::Reference(acro_id));
        (doc, field_id)
    }

    #[test]
    fn a_button_keeps_its_appearance_and_is_reset_to_off() {
        let (mut doc, field_id) = checkbox_form(false);

        sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();

        let field = doc.get_object(field_id).unwrap().as_dict().unwrap();
        assert!(!field.has(b"V"));
        assert_eq!(field.get(b"AS").unwrap().as_name().unwrap(), b"Off");
        // The on-state name survives, so the box can be ticked again after the scrub.
        let states = field
            .get(b"AP")
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"N")
            .unwrap()
            .as_dict()
            .unwrap();
        assert!(states.has(b"Agree"));
        verify_scrub_absence(&doc, &ScrubOptions::default()).unwrap();
    }

    #[test]
    fn a_widget_inherits_button_from_its_parent_and_a_text_field_loses_its_appearance() {
        let mut doc = base_doc();
        let parent_id = doc.new_object_id();
        let mut widget = Dictionary::new();
        widget.set("Subtype", Object::Name(b"Widget".to_vec()));
        widget.set("Parent", Object::Reference(parent_id));
        widget.set("AS", Object::Name(b"Yes".to_vec()));
        widget.set("AP", Object::Dictionary(Dictionary::new()));
        let widget_id = doc.add_object(Object::Dictionary(widget));
        let mut parent = Dictionary::new();
        parent.set("FT", Object::Name(b"Btn".to_vec()));
        parent.set("T", Object::string_literal("choice"));
        parent.set("V", Object::Name(b"Yes".to_vec()));
        parent.set("Kids", Object::Array(vec![Object::Reference(widget_id)]));
        doc.objects.insert(parent_id, Object::Dictionary(parent));
        let mut text = Dictionary::new();
        text.set("FT", Object::Name(b"Tx".to_vec()));
        text.set("T", Object::string_literal("name"));
        text.set("V", Object::string_literal("Jane Doe"));
        text.set("RV", Object::string_literal("<p>Jane Doe</p>"));
        text.set("AP", Object::Dictionary(Dictionary::new()));
        let text_id = doc.add_object(Object::Dictionary(text));
        let mut acro = Dictionary::new();
        acro.set(
            "Fields",
            Object::Array(vec![
                Object::Reference(parent_id),
                Object::Reference(text_id),
            ]),
        );
        set_on_catalog(&mut doc, "AcroForm", Object::Dictionary(acro));

        sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();

        let widget = doc.get_object(widget_id).unwrap().as_dict().unwrap();
        assert!(widget.has(b"AP"));
        assert_eq!(widget.get(b"AS").unwrap().as_name().unwrap(), b"Off");
        let text = doc.get_object(text_id).unwrap().as_dict().unwrap();
        assert!(!text.has(b"V"));
        assert!(!text.has(b"RV"));
        assert!(!text.has(b"AP"));
    }

    #[test]
    fn a_field_list_behind_a_reference_is_still_cleared() {
        let (mut doc, field_id) = checkbox_form(true);

        sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();

        let field = doc.get_object(field_id).unwrap().as_dict().unwrap();
        assert!(!field.has(b"V"));
        verify_scrub_absence(&doc, &ScrubOptions::default()).unwrap();
    }

    #[test]
    fn a_widget_outside_the_field_tree_is_cleared_and_the_gate_sees_one_that_was_not() {
        let mut doc = base_doc();
        let mut stray = Dictionary::new();
        stray.set("Subtype", Object::Name(b"Widget".to_vec()));
        stray.set("FT", Object::Name(b"Tx".to_vec()));
        stray.set("V", Object::string_literal("left behind"));
        let stray_id = doc.add_object(Object::Dictionary(stray.clone()));
        set_on_catalog(&mut doc, "AcroForm", Object::Dictionary(Dictionary::new()));

        // The gate finds the value although no field tree leads to it.
        assert!(matches!(
            verify_scrub_absence(&doc, &ScrubOptions::default()),
            Err(ScrubError::GateFailed { .. })
        ));

        sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();

        let stray = doc.get_object(stray_id).unwrap().as_dict().unwrap();
        assert!(!stray.has(b"V"));
        verify_scrub_absence(&doc, &ScrubOptions::default()).unwrap();
    }

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
        let opts = ScrubOptions {
            optional_content: false,
            ..ScrubOptions::default()
        };
        assert!(verify_scrub_absence(&doc2, &opts).is_ok());
    }

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
            Object::Array(vec![
                Object::Reference(file_annot_id),
                Object::Reference(text_annot_id),
            ]),
        );
        let page_id = doc.add_object(Object::Dictionary(page));
        // Attach the page to the base Pages tree so get_pages() finds it.
        let pages_id = doc
            .catalog()
            .unwrap()
            .get(b"Pages")
            .unwrap()
            .as_reference()
            .unwrap();
        let pages = doc.get_object_mut(pages_id).unwrap().as_dict_mut().unwrap();
        pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
        pages.set("Count", Object::Integer(1));
        doc.get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Parent", Object::Reference(pages_id));

        sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();

        let cat = doc.catalog().unwrap();
        assert!(!cat.has(b"Collection"));
        assert!(!catalog_subdict(&doc, b"Names").is_some_and(|n| n.has(b"EmbeddedFiles")));
        // The FileAttachment annotation is gone; the Text annotation is kept.
        let annots = doc
            .get_object(page_id)
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Annots")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(annots.len(), 1);
        assert_eq!(annots[0].as_reference().unwrap(), text_annot_id);
    }

    #[test]
    fn sanitize_rejects_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        assert!(matches!(
            sanitize(big, &ScrubOptions::default()),
            Err(ScrubError::Rejected)
        ));
    }

    #[test]
    fn absence_gate_flags_a_surviving_file_attachment_annotation() {
        let mut doc = base_doc();
        let mut annot = Dictionary::new();
        annot.set("Subtype", Object::Name(b"FileAttachment".to_vec()));
        let annot_id = doc.add_object(Object::Dictionary(annot));
        let mut page = Dictionary::new();
        page.set("Type", Object::Name(b"Page".to_vec()));
        page.set("Annots", Object::Array(vec![Object::Reference(annot_id)]));
        let page_id = doc.add_object(Object::Dictionary(page));
        let pages_id = doc
            .catalog()
            .unwrap()
            .get(b"Pages")
            .unwrap()
            .as_reference()
            .unwrap();
        let pages = doc.get_object_mut(pages_id).unwrap().as_dict_mut().unwrap();
        pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
        pages.set("Count", Object::Integer(1));

        // A surviving FileAttachment annotation must fail the absence gate.
        assert!(matches!(
            verify_scrub_absence(&doc, &ScrubOptions::default()),
            Err(ScrubError::GateFailed { .. })
        ));
        // After scrub it is gone, so the gate passes.
        sanitize_document(&mut doc, &ScrubOptions::default()).unwrap();
        assert!(verify_scrub_absence(&doc, &ScrubOptions::default()).is_ok());
    }
}
