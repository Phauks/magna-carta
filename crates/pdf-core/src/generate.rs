//! PDF assembly primitives — merge, split, and rotate. Pure lopdf model work (no
//! rendering): pages are reorganised, never re-rasterised, and their content is left
//! untouched. These are visible, reversible document operations — they do not remove
//! hidden content or metadata; use `redact`/`sanitize` for that.

use crate::surgery::{resolve_inherited_resources, resolve_mediabox, resolve_rotate};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, StringFormat};
use std::collections::BTreeSet;

/// What an assembly operation can fail at. No logging here — the caller owns that.
#[derive(Debug, PartialEq, Eq)]
pub enum GenerateError {
    /// The bytes are not a parseable PDF.
    Parse,
    /// The document has no pages.
    NoPages,
    /// A requested page index (or range bound) is outside the document.
    PageOutOfRange,
    /// `merge` was given no documents.
    EmptyInput,
    /// The result could not be re-serialised.
    Reassemble,
    /// An image watermark's bytes could not be decoded (see `watermark`).
    Image,
}

/// An inclusive, 0-based range of pages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageRange {
    pub start: usize,
    pub end: usize,
}

/// Which pages an operation applies to (0-based).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PageSelection {
    All,
    Pages(Vec<usize>),
}

/// A clockwise rotation, applied relative to a page's existing `/Rotate`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rotation {
    Cw90,
    Cw180,
    Cw270,
}

impl Rotation {
    fn degrees(self) -> i64 {
        match self {
            Rotation::Cw90 => 90,
            Rotation::Cw180 => 180,
            Rotation::Cw270 => 270,
        }
    }
}

/// The page object ids of a document in reading order.
fn page_ids(doc: &Document) -> Vec<ObjectId> {
    doc.get_pages().into_values().collect()
}

/// Rotate selected pages clockwise, composing with each page's existing rotation.
///
/// `Rotation` is relative — a page already at `/Rotate 90` rotated `Cw270` normalises to
/// `0`. `PageSelection::All` rotates every page; `Pages` rotates the listed 0-based
/// indices (an index outside the document is [`GenerateError::PageOutOfRange`]).
pub fn rotate(
    bytes: &[u8],
    rotation: Rotation,
    pages: &PageSelection,
) -> Result<Vec<u8>, GenerateError> {
    let mut doc = Document::load_mem(bytes).map_err(|_| GenerateError::Parse)?;
    let ids = page_ids(&doc);
    if ids.is_empty() {
        return Err(GenerateError::NoPages);
    }
    let targets: Vec<ObjectId> = match pages {
        PageSelection::All => ids,
        PageSelection::Pages(indices) => indices
            .iter()
            .map(|&i| ids.get(i).copied().ok_or(GenerateError::PageOutOfRange))
            .collect::<Result<_, _>>()?,
    };
    let delta = rotation.degrees();
    for id in targets {
        let dict = doc
            .get_object_mut(id)
            .and_then(|o| o.as_dict_mut())
            .map_err(|_| GenerateError::Reassemble)?;
        let current = dict.get(b"Rotate").and_then(|o| o.as_i64()).unwrap_or(0);
        let normalised = ((current + delta) % 360 + 360) % 360;
        dict.set("Rotate", normalised);
    }
    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|_| GenerateError::Reassemble)?;
    Ok(out)
}

/// Flatten a page's inherited `/MediaBox`, `/Resources`, and `/Rotate` onto the page
/// itself, then re-parent it to `new_parent`. Resolving first (against the page's
/// existing `/Parent` chain) keeps the page correct after the tree is rebuilt and its
/// old ancestors are pruned.
fn reparent_self_contained(
    doc: &mut Document,
    page: ObjectId,
    new_parent: ObjectId,
) -> Result<(), GenerateError> {
    let mediabox = resolve_mediabox(doc, page);
    let resources = resolve_inherited_resources(doc, page).cloned();
    let rotation = resolve_rotate(doc, page);
    let dict = doc
        .get_object_mut(page)
        .and_then(|o| o.as_dict_mut())
        .map_err(|_| GenerateError::Reassemble)?;
    if let Some(mb) = mediabox {
        dict.set(
            "MediaBox",
            Object::Array(mb.iter().map(|&v| Object::Real(v)).collect()),
        );
    }
    if let Some(res) = resources {
        dict.set("Resources", Object::Dictionary(res));
    }
    dict.set("Rotate", Object::Integer(rotation));
    dict.set("Parent", Object::Reference(new_parent));
    Ok(())
}

/// The catalog id and the page-tree root id of a document.
fn catalog_and_pages_root(doc: &Document) -> Result<(ObjectId, ObjectId), GenerateError> {
    let root = doc
        .trailer
        .get(b"Root")
        .and_then(Object::as_reference)
        .map_err(|_| GenerateError::Reassemble)?;
    let pages = doc
        .get_dictionary(root)
        .and_then(|c| c.get(b"Pages"))
        .and_then(Object::as_reference)
        .map_err(|_| GenerateError::Reassemble)?;
    Ok((root, pages))
}

/// Split a document into one output PDF per page range (inclusive, 0-based).
///
/// Each output is an independent single document containing only its range's pages.
/// Inherited `/MediaBox`, `/Resources`, and `/Rotate` are flattened onto the kept pages
/// so they stay correct after the page tree is rebuilt. The combined document's
/// outlines, named destinations, and AcroForm are dropped (subset preservation of those
/// is not attempted). An inverted or out-of-range range is [`GenerateError::PageOutOfRange`].
pub fn split(bytes: &[u8], ranges: &[PageRange]) -> Result<Vec<Vec<u8>>, GenerateError> {
    let source = Document::load_mem(bytes).map_err(|_| GenerateError::Parse)?;
    let total = page_ids(&source).len();
    if total == 0 {
        return Err(GenerateError::NoPages);
    }

    let mut outputs = Vec::with_capacity(ranges.len());
    for range in ranges {
        if range.start > range.end || range.end >= total {
            return Err(GenerateError::PageOutOfRange);
        }
        let mut doc = source.clone();
        let (catalog_id, pages_root) = catalog_and_pages_root(&doc)?;
        let kept: Vec<ObjectId> = page_ids(&doc)[range.start..=range.end].to_vec();

        // Make each kept page self-contained, then re-parent it to the root.
        for &page in &kept {
            reparent_self_contained(&mut doc, page, pages_root)?;
        }

        let kids: Vec<Object> = kept.iter().map(|&id| Object::Reference(id)).collect();
        let count = kids.len() as i64;
        let root_dict = doc
            .get_object_mut(pages_root)
            .and_then(|o| o.as_dict_mut())
            .map_err(|_| GenerateError::Reassemble)?;
        root_dict.set("Kids", Object::Array(kids));
        root_dict.set("Count", Object::Integer(count));

        // Document-level interactive structure does not survive a subset; drop it.
        if let Ok(catalog) = doc.get_object_mut(catalog_id).and_then(|o| o.as_dict_mut()) {
            catalog.remove(b"Outlines");
            catalog.remove(b"Names");
            catalog.remove(b"AcroForm");
        }
        doc.prune_objects();

        let mut out = Vec::new();
        doc.save_to(&mut out)
            .map_err(|_| GenerateError::Reassemble)?;
        outputs.push(out);
    }
    Ok(outputs)
}

/// Merge the pages of multiple PDFs into one document, in order.
///
/// Each input's objects are renumbered to avoid id collisions, its pages are collected
/// and made self-contained, and one fresh page tree + catalog is built over them — pages
/// of different sizes coexist. Each input's outlines, AcroForm fields, and named
/// destinations are folded in too (see the interactive-merge step). An empty list is
/// [`GenerateError::EmptyInput`]; inputs with no pages at all is [`GenerateError::NoPages`].
pub fn merge(documents: &[&[u8]]) -> Result<Vec<u8>, GenerateError> {
    if documents.is_empty() {
        return Err(GenerateError::EmptyInput);
    }
    let mut combined = Document::with_version("1.5");
    let mut next_id = 1u32;
    let mut page_order: Vec<ObjectId> = Vec::new();
    // Each input's original catalog id (after renumbering) — its interactive structure
    // is folded into the merged document before the orphaned originals are pruned.
    let mut source_catalogs: Vec<ObjectId> = Vec::new();
    for bytes in documents {
        let mut doc = Document::load_mem(bytes).map_err(|_| GenerateError::Parse)?;
        doc.renumber_objects_with(next_id);
        next_id = doc.max_id + 1;
        page_order.extend(doc.get_pages().into_values());
        if let Ok(catalog) = doc.trailer.get(b"Root").and_then(Object::as_reference) {
            source_catalogs.push(catalog);
        }
        combined.objects.extend(doc.objects);
    }
    if page_order.is_empty() {
        return Err(GenerateError::NoPages);
    }
    combined.max_id = next_id - 1;

    let pages_id = combined.new_object_id();
    for &page in &page_order {
        reparent_self_contained(&mut combined, page, pages_id)?;
    }
    let kids: Vec<Object> = page_order.iter().map(|&id| Object::Reference(id)).collect();
    let count = kids.len() as i64;
    combined.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            b"Type" => Object::Name(b"Pages".to_vec()),
            b"Kids" => Object::Array(kids),
            b"Count" => Object::Integer(count),
        }),
    );
    let catalog_id = combined.add_object(dictionary! {
        b"Type" => Object::Name(b"Catalog".to_vec()),
        b"Pages" => Object::Reference(pages_id),
    });
    combined.trailer.set("Root", Object::Reference(catalog_id));

    merge_interactive(&mut combined, &source_catalogs, catalog_id);

    combined.prune_objects();
    let mut out = Vec::new();
    combined
        .save_to(&mut out)
        .map_err(|_| GenerateError::Reassemble)?;
    Ok(out)
}

/// Fold the inputs' outlines, AcroForm fields, and named destinations into the merged
/// document. Every input was renumbered before its objects were combined, so the inputs'
/// destinations and field references already point at the correct (renumbered) objects in
/// the combined map — no remapping is needed, only grafting.
fn merge_interactive(doc: &mut Document, source_catalogs: &[ObjectId], new_catalog: ObjectId) {
    merge_outlines(doc, source_catalogs, new_catalog);
    merge_acroform(doc, source_catalogs, new_catalog);
    merge_named_dests(doc, source_catalogs, new_catalog);
}

/// The dictionary named by `key` in `owner`, cloned, whether it is inline or a reference.
fn cloned_dict_entry(doc: &Document, owner: ObjectId, key: &[u8]) -> Option<Dictionary> {
    match doc.get_dictionary(owner).ok()?.get(key).ok()? {
        Object::Dictionary(dict) => Some(dict.clone()),
        Object::Reference(id) => doc.get_dictionary(*id).ok().cloned(),
        _ => None,
    }
}

fn entry_ref(doc: &Document, owner: ObjectId, key: &[u8]) -> Option<ObjectId> {
    doc.get_dictionary(owner)
        .ok()?
        .get(key)
        .ok()?
        .as_reference()
        .ok()
}

/// Chain every input's top-level outline items under one merged `/Outlines` root.
fn merge_outlines(doc: &mut Document, source_catalogs: &[ObjectId], new_catalog: ObjectId) {
    let mut items: Vec<ObjectId> = Vec::new();
    let mut total_count = 0i64;
    for &catalog in source_catalogs {
        let Some(outlines) = entry_ref(doc, catalog, b"Outlines") else {
            continue;
        };
        let Ok(root) = doc.get_dictionary(outlines) else {
            continue;
        };
        total_count += root
            .get(b"Count")
            .and_then(|o| o.as_i64())
            .unwrap_or(0)
            .abs();
        let mut current = root.get(b"First").ok().and_then(|o| o.as_reference().ok());
        let mut guard = 0;
        while let Some(id) = current {
            items.push(id);
            guard += 1;
            if guard > 100_000 {
                break;
            }
            current = doc
                .get_dictionary(id)
                .ok()
                .and_then(|d| d.get(b"Next").ok())
                .and_then(|o| o.as_reference().ok());
        }
    }
    if items.is_empty() {
        return;
    }
    let outlines_id = doc.new_object_id();
    for i in 0..items.len() {
        let prev = i.checked_sub(1).map(|j| items[j]);
        let next = items.get(i + 1).copied();
        if let Ok(item) = doc.get_object_mut(items[i]).and_then(|o| o.as_dict_mut()) {
            item.set("Parent", Object::Reference(outlines_id));
            match prev {
                Some(p) => item.set("Prev", Object::Reference(p)),
                None => {
                    item.remove(b"Prev");
                }
            }
            match next {
                Some(n) => item.set("Next", Object::Reference(n)),
                None => {
                    item.remove(b"Next");
                }
            }
        }
    }
    let (first, last) = (items[0], *items.last().expect("non-empty"));
    doc.objects.insert(
        outlines_id,
        Object::Dictionary(dictionary! {
            b"Type" => Object::Name(b"Outlines".to_vec()),
            b"First" => Object::Reference(first),
            b"Last" => Object::Reference(last),
            b"Count" => Object::Integer(total_count.max(items.len() as i64)),
        }),
    );
    if let Ok(catalog) = doc
        .get_object_mut(new_catalog)
        .and_then(|o| o.as_dict_mut())
    {
        catalog.set("Outlines", Object::Reference(outlines_id));
    }
}

/// Union every input's AcroForm `/Fields` into one `/AcroForm`, renaming top-level field
/// names on collision and merging `/DR` and `/NeedAppearances`.
fn merge_acroform(doc: &mut Document, source_catalogs: &[ObjectId], new_catalog: ObjectId) {
    let mut fields: Vec<ObjectId> = Vec::new();
    let mut seen_names: BTreeSet<Vec<u8>> = BTreeSet::new();
    let mut need_appearances = false;
    let mut dr_fonts: Vec<(Vec<u8>, Object)> = Vec::new();

    for &catalog in source_catalogs {
        let Some(acroform) = cloned_dict_entry(doc, catalog, b"AcroForm") else {
            continue;
        };
        if matches!(acroform.get(b"NeedAppearances"), Ok(Object::Boolean(true))) {
            need_appearances = true;
        }
        if let Some(dr) = acroform.get(b"DR").ok().and_then(|o| match o {
            Object::Dictionary(d) => Some(d.clone()),
            _ => None,
        }) {
            if let Ok(Object::Dictionary(font)) = dr.get(b"Font") {
                for (key, value) in font.iter() {
                    dr_fonts.push((key.clone(), value.clone()));
                }
            }
        }
        let Ok(Object::Array(field_refs)) = acroform.get(b"Fields") else {
            continue;
        };
        for field in field_refs {
            let Ok(field_id) = field.as_reference() else {
                continue;
            };
            // Resolve the top-level field name and rename it if it collides.
            let name = match doc
                .get_dictionary(field_id)
                .ok()
                .and_then(|f| f.get(b"T").ok())
            {
                Some(Object::String(bytes, _)) => Some(bytes.clone()),
                _ => None,
            };
            if let Some(name) = name {
                let unique = unique_name(&name, &seen_names);
                seen_names.insert(unique.clone());
                if unique != name {
                    if let Ok(dict) = doc.get_object_mut(field_id).and_then(|o| o.as_dict_mut()) {
                        dict.set("T", Object::String(unique, StringFormat::Literal));
                    }
                }
            }
            fields.push(field_id);
        }
    }

    if fields.is_empty() {
        return;
    }
    let mut acroform = Dictionary::new();
    acroform.set(
        "Fields",
        Object::Array(fields.iter().map(|&id| Object::Reference(id)).collect()),
    );
    if need_appearances {
        acroform.set("NeedAppearances", Object::Boolean(true));
    }
    if !dr_fonts.is_empty() {
        let mut font = Dictionary::new();
        for (key, value) in dr_fonts {
            if font.get(&key).is_err() {
                font.set(key, value);
            }
        }
        let mut dr = Dictionary::new();
        dr.set("Font", Object::Dictionary(font));
        acroform.set("DR", Object::Dictionary(dr));
    }
    let acroform_id = doc.add_object(Object::Dictionary(acroform));
    if let Ok(catalog) = doc
        .get_object_mut(new_catalog)
        .and_then(|o| o.as_dict_mut())
    {
        catalog.set("AcroForm", Object::Reference(acroform_id));
    }
}

/// Merge every input's named destinations into one flat `/Names /Dests`, suffixing
/// colliding names.
fn merge_named_dests(doc: &mut Document, source_catalogs: &[ObjectId], new_catalog: ObjectId) {
    let mut entries: Vec<(Vec<u8>, Object)> = Vec::new();
    for &catalog in source_catalogs {
        // Modern: /Names /Dests is a name tree.
        if let Some(names) = cloned_dict_entry(doc, catalog, b"Names") {
            if let Some(dests) = names.get(b"Dests").ok().and_then(|o| o.as_reference().ok()) {
                collect_dest_tree(doc, dests, 0, &mut entries);
            } else if let Ok(Object::Dictionary(dests)) = names.get(b"Dests") {
                collect_dest_node(dests, &mut entries);
            }
        }
        // Legacy: catalog /Dests is a name → destination dictionary.
        if let Some(legacy) = cloned_dict_entry(doc, catalog, b"Dests") {
            for (key, value) in legacy.iter() {
                entries.push((key.clone(), value.clone()));
            }
        }
    }
    if entries.is_empty() {
        return;
    }
    let mut seen: BTreeSet<Vec<u8>> = BTreeSet::new();
    let mut flat: Vec<Object> = Vec::with_capacity(entries.len() * 2);
    for (name, dest) in entries {
        let unique = unique_name(&name, &seen);
        seen.insert(unique.clone());
        flat.push(Object::String(unique, StringFormat::Literal));
        flat.push(dest);
    }
    let dests_id = doc.add_object(Object::Dictionary(dictionary! {
        b"Names" => Object::Array(flat),
    }));
    let names_id = doc.add_object(Object::Dictionary(dictionary! {
        b"Dests" => Object::Reference(dests_id),
    }));
    if let Ok(catalog) = doc
        .get_object_mut(new_catalog)
        .and_then(|o| o.as_dict_mut())
    {
        catalog.set("Names", Object::Reference(names_id));
    }
}

/// Collect `(name, dest)` pairs from a destination name-tree node (bounded recursion).
fn collect_dest_tree(doc: &Document, node: ObjectId, depth: u8, out: &mut Vec<(Vec<u8>, Object)>) {
    if depth > 32 {
        return;
    }
    let Ok(dict) = doc.get_dictionary(node) else {
        return;
    };
    collect_dest_node(dict, out);
    if let Ok(Object::Array(kids)) = dict.get(b"Kids") {
        let kid_ids: Vec<ObjectId> = kids.iter().filter_map(|k| k.as_reference().ok()).collect();
        for kid in kid_ids {
            collect_dest_tree(doc, kid, depth + 1, out);
        }
    }
}

fn collect_dest_node(dict: &Dictionary, out: &mut Vec<(Vec<u8>, Object)>) {
    if let Ok(Object::Array(names)) = dict.get(b"Names") {
        let mut i = 0;
        while i + 1 < names.len() {
            if let Object::String(name, _) = &names[i] {
                out.push((name.clone(), names[i + 1].clone()));
            }
            i += 2;
        }
    }
}

/// `name` if unused, else `name_2`, `name_3`, … until one is free.
fn unique_name(name: &[u8], seen: &BTreeSet<Vec<u8>>) -> Vec<u8> {
    if !seen.contains(name) {
        return name.to_vec();
    }
    let mut suffix = 2;
    loop {
        let mut candidate = name.to_vec();
        candidate.extend_from_slice(format!("_{suffix}").as_bytes());
        if !seen.contains(&candidate) {
            return candidate;
        }
        suffix += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    /// A minimal multi-page document (each page a blank Letter page), serialised. Built
    /// programmatically so lopdf re-loads its own output cleanly and hayro renders it.
    fn multi_page_doc(count: usize) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let mut kids = Vec::new();
        for _ in 0..count {
            let content_id =
                doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"".to_vec())));
            let page_id = doc.add_object(dictionary! {
                b"Type" => Object::Name(b"Page".to_vec()),
                b"Parent" => Object::Reference(pages_id),
                b"MediaBox" => Object::Array(vec![
                    Object::Integer(0), Object::Integer(0),
                    Object::Integer(612), Object::Integer(792),
                ]),
                b"Contents" => Object::Reference(content_id),
                b"Resources" => Object::Dictionary(dictionary! { b"Font" => Object::Dictionary(dictionary! {}) }),
            });
            kids.push(Object::Reference(page_id));
        }
        let count_i = kids.len() as i64;
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                b"Type" => Object::Name(b"Pages".to_vec()),
                b"Kids" => Object::Array(kids),
                b"Count" => Object::Integer(count_i),
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Catalog".to_vec()),
            b"Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set(b"Root", Object::Reference(catalog_id));
        let mut out = Vec::new();
        doc.save_to(&mut out).expect("serialise multi-page doc");
        out
    }

    fn rotation_of(bytes: &[u8], page_index: usize) -> i64 {
        let doc = Document::load_mem(bytes).unwrap();
        let id = page_ids(&doc)[page_index];
        doc.get_object(id)
            .and_then(|o| o.as_dict())
            .unwrap()
            .get(b"Rotate")
            .and_then(|o| o.as_i64())
            .unwrap_or(0)
    }

    #[test]
    fn rotate_all_sets_90() {
        let out = rotate(&multi_page_doc(2), Rotation::Cw90, &PageSelection::All).unwrap();
        assert_eq!(rotation_of(&out, 0), 90);
        assert_eq!(rotation_of(&out, 1), 90);
    }

    #[test]
    fn rotate_composes_with_existing_and_normalises() {
        // Start one page at /Rotate 90, then rotate Cw270 → 360 → normalised 0.
        let pre = rotate(&multi_page_doc(1), Rotation::Cw90, &PageSelection::All).unwrap();
        assert_eq!(rotation_of(&pre, 0), 90);
        let out = rotate(&pre, Rotation::Cw270, &PageSelection::All).unwrap();
        assert_eq!(rotation_of(&out, 0), 0);
    }

    #[test]
    fn rotate_selected_pages_only() {
        let out = rotate(
            &multi_page_doc(3),
            Rotation::Cw180,
            &PageSelection::Pages(vec![1]),
        )
        .unwrap();
        assert_eq!(rotation_of(&out, 0), 0);
        assert_eq!(rotation_of(&out, 1), 180);
        assert_eq!(rotation_of(&out, 2), 0);
    }

    #[test]
    fn rotate_out_of_range_errs() {
        assert_eq!(
            rotate(
                &multi_page_doc(2),
                Rotation::Cw90,
                &PageSelection::Pages(vec![5])
            ),
            Err(GenerateError::PageOutOfRange)
        );
    }

    fn page_count(bytes: &[u8]) -> usize {
        Document::load_mem(bytes).unwrap().get_pages().len()
    }

    #[test]
    fn split_one_range() {
        let outs = split(&multi_page_doc(3), &[PageRange { start: 1, end: 2 }]).unwrap();
        assert_eq!(outs.len(), 1);
        assert_eq!(page_count(&outs[0]), 2);
        // The output is an independent, renderable document.
        assert_eq!(
            crate::Document::load(outs[0].clone()).unwrap().page_count(),
            2
        );
    }

    #[test]
    fn split_multiple_ranges() {
        let outs = split(
            &multi_page_doc(3),
            &[
                PageRange { start: 0, end: 0 },
                PageRange { start: 1, end: 2 },
            ],
        )
        .unwrap();
        assert_eq!(outs.len(), 2);
        assert_eq!(page_count(&outs[0]), 1);
        assert_eq!(page_count(&outs[1]), 2);
    }

    #[test]
    fn split_full_range_roundtrips() {
        let outs = split(&multi_page_doc(3), &[PageRange { start: 0, end: 2 }]).unwrap();
        assert_eq!(page_count(&outs[0]), 3);
    }

    #[test]
    fn split_out_of_range_errs() {
        assert_eq!(
            split(&multi_page_doc(2), &[PageRange { start: 0, end: 5 }]),
            Err(GenerateError::PageOutOfRange)
        );
    }

    #[test]
    fn split_inverted_range_errs() {
        assert_eq!(
            split(&multi_page_doc(3), &[PageRange { start: 2, end: 1 }]),
            Err(GenerateError::PageOutOfRange)
        );
    }

    /// A one-page document with a given MediaBox size.
    fn sized_doc(width: i64, height: i64) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let content_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"".to_vec())));
        let page_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Page".to_vec()),
            b"Parent" => Object::Reference(pages_id),
            b"MediaBox" => Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(width), Object::Integer(height),
            ]),
            b"Contents" => Object::Reference(content_id),
            b"Resources" => Object::Dictionary(dictionary! { b"Font" => Object::Dictionary(dictionary! {}) }),
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                b"Type" => Object::Name(b"Pages".to_vec()),
                b"Kids" => Object::Array(vec![Object::Reference(page_id)]),
                b"Count" => Object::Integer(1),
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Catalog".to_vec()),
            b"Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set(b"Root", Object::Reference(catalog_id));
        let mut out = Vec::new();
        doc.save_to(&mut out).expect("serialise sized doc");
        out
    }

    fn mediabox_width(bytes: &[u8], page_index: usize) -> f32 {
        let doc = Document::load_mem(bytes).unwrap();
        let id = page_ids(&doc)[page_index];
        resolve_mediabox(&doc, id).unwrap()[2]
    }

    #[test]
    fn merge_two_docs_sums_pages() {
        let a = multi_page_doc(1);
        let b = multi_page_doc(2);
        let out = merge(&[a.as_slice(), b.as_slice()]).unwrap();
        assert_eq!(page_count(&out), 3);
        assert_eq!(crate::Document::load(out).unwrap().page_count(), 3);
    }

    #[test]
    fn merge_preserves_each_mediabox() {
        let letter = sized_doc(612, 792);
        let a4 = sized_doc(595, 842);
        let out = merge(&[letter.as_slice(), a4.as_slice()]).unwrap();
        assert!((mediabox_width(&out, 0) - 612.0).abs() < 1.0);
        assert!((mediabox_width(&out, 1) - 595.0).abs() < 1.0);
    }

    #[test]
    fn merge_renumbers_without_collision() {
        // Two freshly-built docs share overlapping low object ids; all 4 pages must survive.
        let a = multi_page_doc(2);
        let b = multi_page_doc(2);
        let out = merge(&[a.as_slice(), b.as_slice()]).unwrap();
        assert_eq!(page_count(&out), 4);
    }

    #[test]
    fn merge_single_doc_roundtrips() {
        let a = multi_page_doc(3);
        assert_eq!(page_count(&merge(&[a.as_slice()]).unwrap()), 3);
    }

    #[test]
    fn merge_empty_list_errs() {
        assert_eq!(merge(&[]), Err(GenerateError::EmptyInput));
    }

    // ── Interactive-merge fixtures + helpers ────────────────────────────────────

    fn base_page(doc: &mut Document, pages_id: ObjectId, annots: Option<Object>) -> ObjectId {
        let content_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"".to_vec())));
        let mut page = dictionary! {
            b"Type" => Object::Name(b"Page".to_vec()),
            b"Parent" => Object::Reference(pages_id),
            b"MediaBox" => Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(612), Object::Integer(792),
            ]),
            b"Contents" => Object::Reference(content_id),
            b"Resources" => Object::Dictionary(dictionary! { b"Font" => Object::Dictionary(dictionary! {}) }),
        };
        if let Some(annots) = annots {
            page.set("Annots", annots);
        }
        doc.add_object(page)
    }

    fn finish(doc: &mut Document, catalog: Dictionary) -> Vec<u8> {
        let catalog_id = doc.add_object(Object::Dictionary(catalog));
        doc.trailer.set(b"Root", Object::Reference(catalog_id));
        let mut out = Vec::new();
        doc.save_to(&mut out).expect("serialise fixture");
        out
    }

    fn doc_with_bookmark(title: &str) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let outlines_id = doc.new_object_id();
        let page_id = base_page(&mut doc, pages_id, None);
        let item_id = doc.add_object(dictionary! {
            b"Title" => Object::String(title.as_bytes().to_vec(), StringFormat::Literal),
            b"Parent" => Object::Reference(outlines_id),
            b"Dest" => Object::Array(vec![Object::Reference(page_id), Object::Name(b"Fit".to_vec())]),
        });
        doc.objects.insert(
            outlines_id,
            Object::Dictionary(dictionary! {
                b"Type" => Object::Name(b"Outlines".to_vec()),
                b"First" => Object::Reference(item_id),
                b"Last" => Object::Reference(item_id),
                b"Count" => Object::Integer(1),
            }),
        );
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                b"Type" => Object::Name(b"Pages".to_vec()),
                b"Kids" => Object::Array(vec![Object::Reference(page_id)]),
                b"Count" => Object::Integer(1),
            }),
        );
        finish(
            &mut doc,
            dictionary! {
                b"Type" => Object::Name(b"Catalog".to_vec()),
                b"Pages" => Object::Reference(pages_id),
                b"Outlines" => Object::Reference(outlines_id),
            },
        )
    }

    fn doc_with_form_field(name: &str) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let field_id = doc.new_object_id();
        let page_id = base_page(
            &mut doc,
            pages_id,
            Some(Object::Array(vec![Object::Reference(field_id)])),
        );
        // A terminal text field that is also its own widget annotation.
        doc.objects.insert(
            field_id,
            Object::Dictionary(dictionary! {
                b"FT" => Object::Name(b"Tx".to_vec()),
                b"T" => Object::String(name.as_bytes().to_vec(), StringFormat::Literal),
                b"Subtype" => Object::Name(b"Widget".to_vec()),
                b"Rect" => Object::Array(vec![
                    Object::Integer(100), Object::Integer(100),
                    Object::Integer(300), Object::Integer(120),
                ]),
                b"P" => Object::Reference(page_id),
            }),
        );
        let acroform_id = doc.add_object(dictionary! {
            b"Fields" => Object::Array(vec![Object::Reference(field_id)]),
            b"NeedAppearances" => Object::Boolean(true),
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                b"Type" => Object::Name(b"Pages".to_vec()),
                b"Kids" => Object::Array(vec![Object::Reference(page_id)]),
                b"Count" => Object::Integer(1),
            }),
        );
        finish(
            &mut doc,
            dictionary! {
                b"Type" => Object::Name(b"Catalog".to_vec()),
                b"Pages" => Object::Reference(pages_id),
                b"AcroForm" => Object::Reference(acroform_id),
            },
        )
    }

    fn doc_with_named_dest(name: &str) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let page_id = base_page(&mut doc, pages_id, None);
        let dests_id = doc.add_object(dictionary! {
            b"Names" => Object::Array(vec![
                Object::String(name.as_bytes().to_vec(), StringFormat::Literal),
                Object::Array(vec![Object::Reference(page_id), Object::Name(b"Fit".to_vec())]),
            ]),
        });
        let names_id = doc.add_object(dictionary! { b"Dests" => Object::Reference(dests_id) });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                b"Type" => Object::Name(b"Pages".to_vec()),
                b"Kids" => Object::Array(vec![Object::Reference(page_id)]),
                b"Count" => Object::Integer(1),
            }),
        );
        finish(
            &mut doc,
            dictionary! {
                b"Type" => Object::Name(b"Catalog".to_vec()),
                b"Pages" => Object::Reference(pages_id),
                b"Names" => Object::Reference(names_id),
            },
        )
    }

    fn outline_titles(bytes: &[u8]) -> Vec<Vec<u8>> {
        let doc = Document::load_mem(bytes).unwrap();
        let root = doc
            .trailer
            .get(b"Root")
            .and_then(Object::as_reference)
            .unwrap();
        let outlines = entry_ref(&doc, root, b"Outlines").unwrap();
        let mut titles = Vec::new();
        let mut cur = doc
            .get_dictionary(outlines)
            .unwrap()
            .get(b"First")
            .ok()
            .and_then(|o| o.as_reference().ok());
        while let Some(id) = cur {
            let d = doc.get_dictionary(id).unwrap();
            if let Ok(Object::String(t, _)) = d.get(b"Title") {
                titles.push(t.clone());
            }
            cur = d.get(b"Next").ok().and_then(|o| o.as_reference().ok());
        }
        titles
    }

    fn field_names(bytes: &[u8]) -> Vec<Vec<u8>> {
        let doc = Document::load_mem(bytes).unwrap();
        let root = doc
            .trailer
            .get(b"Root")
            .and_then(Object::as_reference)
            .unwrap();
        let acroform = entry_ref(&doc, root, b"AcroForm").unwrap();
        let mut names = Vec::new();
        if let Ok(Object::Array(fields)) = doc.get_dictionary(acroform).unwrap().get(b"Fields") {
            for f in fields {
                if let Ok(id) = f.as_reference() {
                    if let Ok(Object::String(t, _)) = doc.get_dictionary(id).unwrap().get(b"T") {
                        names.push(t.clone());
                    }
                }
            }
        }
        names
    }

    fn dest_names(bytes: &[u8]) -> Vec<Vec<u8>> {
        let doc = Document::load_mem(bytes).unwrap();
        let root = doc
            .trailer
            .get(b"Root")
            .and_then(Object::as_reference)
            .unwrap();
        let names = entry_ref(&doc, root, b"Names").unwrap();
        let dests = entry_ref(&doc, names, b"Dests").unwrap();
        let mut out = Vec::new();
        if let Ok(Object::Array(arr)) = doc.get_dictionary(dests).unwrap().get(b"Names") {
            let mut i = 0;
            while i < arr.len() {
                if let Object::String(n, _) = &arr[i] {
                    out.push(n.clone());
                }
                i += 2;
            }
        }
        out
    }

    #[test]
    fn merge_outline_one_node_per_doc() {
        let a = doc_with_bookmark("Doc A");
        let b = doc_with_bookmark("Doc B");
        let out = merge(&[a.as_slice(), b.as_slice()]).unwrap();
        assert_eq!(
            outline_titles(&out),
            vec![b"Doc A".to_vec(), b"Doc B".to_vec()]
        );
        assert_eq!(crate::Document::load(out).unwrap().page_count(), 2);
    }

    #[test]
    fn merge_unions_form_fields() {
        let a = doc_with_form_field("alpha");
        let b = doc_with_form_field("beta");
        let out = merge(&[a.as_slice(), b.as_slice()]).unwrap();
        let names = field_names(&out);
        assert!(names.contains(&b"alpha".to_vec()));
        assert!(names.contains(&b"beta".to_vec()));
    }

    #[test]
    fn merge_renames_colliding_field() {
        let a = doc_with_form_field("Name");
        let b = doc_with_form_field("Name");
        let out = merge(&[a.as_slice(), b.as_slice()]).unwrap();
        let names = field_names(&out);
        assert!(names.contains(&b"Name".to_vec()));
        assert!(names.contains(&b"Name_2".to_vec()));
    }

    #[test]
    fn merge_merges_named_dests() {
        let a = doc_with_named_dest("intro");
        let b = doc_with_named_dest("summary");
        let out = merge(&[a.as_slice(), b.as_slice()]).unwrap();
        let names = dest_names(&out);
        assert!(names.contains(&b"intro".to_vec()));
        assert!(names.contains(&b"summary".to_vec()));
    }
}
