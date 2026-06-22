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
// Used in tests today; later tasks call this from non-test surface-gate code.
#[allow(dead_code)]
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
}
