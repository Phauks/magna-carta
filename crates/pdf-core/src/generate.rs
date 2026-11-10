//! PDF assembly primitives — merge, split, and rotate. Pure lopdf model work (no
//! rendering): pages are reorganised, never re-rasterised, and their content is left
//! untouched. These are visible, reversible document operations — they do not remove
//! hidden content or metadata; use `redact`/`sanitize` for that.

use crate::annotations::{page_annotation_entries, set_page_annotations};
use crate::surgery::{resolve_inherited_resources, resolve_mediabox, resolve_rotate};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, StringFormat};
use std::collections::BTreeSet;

/// What an assembly operation can fail at. No logging here — the caller owns that.
#[derive(Debug, PartialEq, Eq)]
pub enum GenerateError {
    /// The document is locked with a password and was not opened: nothing in it can be
    /// read, so there is nothing to work on until [`crate::decrypt`] has unlocked it.
    Encrypted,
    /// Input rejected by the decompression-bomb guard (oversize or a bomb).
    Rejected,
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
    /// A text watermark holds a character its font cannot draw (anything outside
    /// Windows-1252).
    UnsupportedCharacter,
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
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| GenerateError::Rejected)?;
    let mut doc = Document::load_mem(bytes).map_err(|_| GenerateError::Parse)?;
    if crate::guard::is_locked(&doc) {
        return Err(GenerateError::Encrypted);
    }
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

/// Every object reachable from `roots`, following references through dictionaries,
/// arrays, and stream dictionaries.
///
/// Traversal never enters an object listed in `stop` and never follows a dictionary key
/// listed in `skip`. Both exist because a page's graph is not a tree: `/Parent` climbs
/// back to the page-tree root and from there reaches every other page, so a walk that
/// followed it would report "everything" from any starting point. The visited set makes
/// a cyclic or shared graph terminate and be walked once.
fn reachable(
    doc: &Document,
    roots: &[ObjectId],
    skip: &[&[u8]],
    stop: &BTreeSet<ObjectId>,
) -> BTreeSet<ObjectId> {
    let mut seen: BTreeSet<ObjectId> = BTreeSet::new();
    let mut stack: Vec<ObjectId> = roots.to_vec();
    let mut refs = Vec::new();
    while let Some(id) = stack.pop() {
        if stop.contains(&id) || !seen.insert(id) {
            continue;
        }
        let Ok(object) = doc.get_object(id) else {
            continue;
        };
        refs.clear();
        collect_references(object, skip, &mut refs);
        stack.extend(refs.iter().copied());
    }
    seen
}

/// Append every indirect reference `object` holds, skipping the values of dictionary
/// keys named in `skip` (at any nesting depth — the keys this is used with, `/Parent`
/// and `/Annots`, only carry their page-tree meaning on a page or annotation dictionary,
/// and skipping a same-named key deeper in costs nothing).
fn collect_references(object: &Object, skip: &[&[u8]], out: &mut Vec<ObjectId>) {
    let from_dict = |dict: &Dictionary, out: &mut Vec<ObjectId>| {
        for (key, value) in dict.iter() {
            if !skip.contains(&key.as_slice()) {
                collect_references(value, skip, out);
            }
        }
    };
    match object {
        Object::Reference(id) => out.push(*id),
        Object::Array(items) => {
            for item in items {
                collect_references(item, skip, out);
            }
        }
        Object::Dictionary(dict) => from_dict(dict, out),
        Object::Stream(stream) => from_dict(&stream.dict, out),
        _ => {}
    }
}

/// The objects a split output must not carry: everything reachable from a dropped page
/// that the kept pages' own content does not also use. A font or an XObject shared with
/// a kept page is reached from both and is not in this set; a dropped page's dictionary,
/// its content streams, and its private resources are only reached from it, and are.
///
/// The kept-page walk deliberately excludes `/Annots`: an annotation reaching a dropped
/// page is the leak being measured, so counting it as legitimate kept-page content would
/// define the problem away.
fn dropped_page_objects(
    doc: &Document,
    kept: &[ObjectId],
    dropped: &[ObjectId],
) -> BTreeSet<ObjectId> {
    let kept_set: BTreeSet<ObjectId> = kept.iter().copied().collect();
    let dropped_set: BTreeSet<ObjectId> = dropped.iter().copied().collect();
    let kept_content = reachable(doc, kept, &[b"Parent", b"Annots"], &dropped_set);
    reachable(doc, dropped, &[b"Parent"], &kept_set)
        .into_iter()
        .filter(|id| !kept_content.contains(id))
        .collect()
}

/// Annotation keys that point at another object rather than describing this annotation:
/// the page it belongs to, the popup window and markup thread it is part of, and where
/// activating it navigates to. Each can name a dropped page, and each can be removed on
/// its own — an annotation with no popup, no thread parent, and no destination is still
/// a valid annotation, where one carrying a reference to a page that is not in the
/// document is not.
const ANNOTATION_LINK_KEYS: &[&[u8]] = &[
    b"P", b"Popup", b"Parent", b"IRT", b"Dest", b"A", b"AA", b"Next",
];

/// The objects one `/Annots` entry reaches, stopping at the kept pages (an annotation
/// naming its own page is ordinary, not a leak).
fn annotation_reach(
    doc: &Document,
    entry: &Object,
    kept: &BTreeSet<ObjectId>,
) -> BTreeSet<ObjectId> {
    let mut roots = Vec::new();
    collect_references(entry, &[], &mut roots);
    reachable(doc, &roots, &[], kept)
}

/// Sever every path from a kept page's annotations into the dropped pages, and report
/// the objects that must not survive.
///
/// Stripping the catalog's document-level entries is not enough on its own: the object
/// graph is walked from what remains, so a kept page's annotation that still names a
/// dropped page — through `/Popup`, `/Parent`, a `/Dest` link target, or the page it
/// claims to belong to — pulls that page's dictionary, content streams, and resources
/// into the output, where they are invisible to a reader and fully recoverable from the
/// bytes. A link whose target left the document is broken either way; dropping the
/// reference is the honest repair. An annotation that cannot be repaired that way is
/// removed whole, because what remains of it is a fragment of a page that was excluded.
fn prune_dropped_page_annotations(
    doc: &mut Document,
    kept: &[ObjectId],
    dropped: &[ObjectId],
) -> BTreeSet<ObjectId> {
    let leaked = dropped_page_objects(doc, kept, dropped);
    if leaked.is_empty() {
        return leaked;
    }
    let kept_set: BTreeSet<ObjectId> = kept.iter().copied().collect();
    let leaks = |reach: &BTreeSet<ObjectId>| reach.iter().any(|id| leaked.contains(id));

    for &page in kept {
        let entries = page_annotation_entries(doc, page);
        if entries.is_empty() {
            continue;
        }
        let mut survivors: Vec<Object> = Vec::with_capacity(entries.len());
        for entry in entries {
            if !leaks(&annotation_reach(doc, &entry, &kept_set)) {
                survivors.push(entry);
                continue;
            }
            // Try the narrow repair first: drop only the linking keys that reach a
            // dropped page, keeping the annotation itself.
            let Ok(annotation) = entry.as_reference() else {
                continue; // An inline annotation dictionary is dropped whole.
            };
            let doomed_keys: Vec<&[u8]> = ANNOTATION_LINK_KEYS
                .iter()
                .copied()
                .filter(|key| {
                    doc.get_dictionary(annotation)
                        .ok()
                        .and_then(|dict| dict.get(key).ok())
                        .map(|value| leaks(&annotation_reach(doc, value, &kept_set)))
                        .unwrap_or(false)
                })
                .collect();
            if let Ok(dict) = doc.get_object_mut(annotation).and_then(|o| o.as_dict_mut()) {
                for key in doomed_keys {
                    dict.remove(key);
                }
            }
            if !leaks(&annotation_reach(doc, &entry, &kept_set)) {
                survivors.push(entry);
            }
        }
        set_page_annotations(doc, page, survivors);
    }
    leaked
}

/// Split a document into one output PDF per page range (inclusive, 0-based).
///
/// Each output is an independent single document containing only its range's pages.
/// Inherited `/MediaBox`, `/Resources`, and `/Rotate` are flattened onto the kept pages
/// so they stay correct after the page tree is rebuilt. Document-level interactive and
/// structural entries (outlines, named destinations, AcroForm, open action, page labels,
/// the structure tree, …) are dropped — a subset cannot preserve them — and so are the
/// kept pages' annotation references into pages the range excludes, which would
/// otherwise carry those pages' content into the output. An inverted or out-of-range
/// range is [`GenerateError::PageOutOfRange`].
pub fn split(bytes: &[u8], ranges: &[PageRange]) -> Result<Vec<Vec<u8>>, GenerateError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| GenerateError::Rejected)?;
    let source = Document::load_mem(bytes).map_err(|_| GenerateError::Parse)?;
    if crate::guard::is_locked(&source) {
        return Err(GenerateError::Encrypted);
    }
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
        let all: Vec<ObjectId> = page_ids(&doc);
        let kept: Vec<ObjectId> = all[range.start..=range.end].to_vec();
        let dropped: Vec<ObjectId> = all
            .iter()
            .copied()
            .filter(|id| !kept.contains(id))
            .collect();

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

        // Document-level interactive/structural entries reference pages across the whole
        // document; a subset cannot preserve them, and leaving one in resurrects a dropped
        // page (prune follows every reference) and leaves a target outside the page tree.
        if let Ok(catalog) = doc.get_object_mut(catalog_id).and_then(|o| o.as_dict_mut()) {
            for key in [
                b"Outlines".as_slice(),
                b"Names",
                b"AcroForm",
                b"Dests",
                b"OpenAction",
                b"StructTreeRoot",
                b"PageLabels",
                b"AA",
                b"Threads",
            ] {
                catalog.remove(key);
            }
        }

        let leaked = prune_dropped_page_annotations(&mut doc, &kept, &dropped);
        doc.prune_objects();
        // Fail closed on the property that matters: a page the caller excluded must be
        // absent from the bytes, not merely unreachable through the page tree. If one of
        // its objects is still here, some reference the repair above did not model kept
        // it alive — so drop the kept pages' annotations wholesale and re-prune, and
        // refuse to emit the range at all if even that leaves the page behind.
        let survives = |doc: &Document| leaked.iter().any(|id| doc.objects.contains_key(id));
        if survives(&doc) {
            for &page in &kept {
                set_page_annotations(&mut doc, page, Vec::new());
            }
            doc.prune_objects();
            if survives(&doc) {
                return Err(GenerateError::Reassemble);
            }
        }

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
    for doc in documents {
        crate::guard::guard_input(doc, &crate::guard::GuardLimits::default())
            .map_err(|_| GenerateError::Rejected)?;
    }
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
        if crate::guard::is_locked(&doc) {
            return Err(GenerateError::Encrypted);
        }
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
                let mut visited = BTreeSet::new();
                collect_dest_tree(doc, dests, &mut visited, &mut entries);
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
    let mut named: Vec<(Vec<u8>, Object)> = Vec::with_capacity(entries.len());
    for (name, dest) in entries {
        let unique = unique_name(&name, &seen);
        seen.insert(unique.clone());
        named.push((unique, dest));
    }
    // A destination name tree's /Names array must be ordered by key: spec-compliant
    // readers binary-search it, so an unsorted array (the natural collection order across
    // several inputs) makes lookups silently fail.
    named.sort_by(|a, b| a.0.cmp(&b.0));
    let mut flat: Vec<Object> = Vec::with_capacity(named.len() * 2);
    for (name, dest) in named {
        flat.push(Object::String(name, StringFormat::Literal));
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

/// Collect `(name, dest)` pairs from a destination name-tree node.
///
/// `visited` guards against a malicious `/Kids` graph (shared or cyclic node references
/// would otherwise re-walk exponentially); collection also stops at a hard entry cap.
fn collect_dest_tree(
    doc: &Document,
    node: ObjectId,
    visited: &mut BTreeSet<ObjectId>,
    out: &mut Vec<(Vec<u8>, Object)>,
) {
    if out.len() >= 100_000 || !visited.insert(node) {
        return;
    }
    let Ok(dict) = doc.get_dictionary(node) else {
        return;
    };
    collect_dest_node(dict, out);
    if let Ok(Object::Array(kids)) = dict.get(b"Kids") {
        let kid_ids: Vec<ObjectId> = kids.iter().filter_map(|k| k.as_reference().ok()).collect();
        for kid in kid_ids {
            collect_dest_tree(doc, kid, visited, out);
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

    /// A two-page document where page 0 carries a link annotation pointing into page 1:
    /// the link's `/Dest` names page 1, and its `/Popup` is an annotation that lives on
    /// page 1 and claims page 1 as its `/P`. Page 1's content stream and its annotation
    /// each carry a distinctive literal string, so a split that keeps only page 0 can be
    /// checked at the byte level for page 1's content.
    fn doc_with_cross_page_annotation() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let link_id = doc.new_object_id();
        let popup_id = doc.new_object_id();

        let kept_content = doc.add_object(Object::Stream(Stream::new(
            dictionary! {},
            b"BT (kept page) Tj ET".to_vec(),
        )));
        let kept_page = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Page".to_vec()),
            b"Parent" => Object::Reference(pages_id),
            b"MediaBox" => Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(612), Object::Integer(792),
            ]),
            b"Contents" => Object::Reference(kept_content),
            b"Resources" => Object::Dictionary(dictionary! { b"Font" => Object::Dictionary(dictionary! {}) }),
            b"Annots" => Object::Array(vec![Object::Reference(link_id)]),
        });

        let dropped_content = doc.add_object(Object::Stream(Stream::new(
            dictionary! {},
            b"BT (DroppedPageContentSecret) Tj ET".to_vec(),
        )));
        let dropped_page = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Page".to_vec()),
            b"Parent" => Object::Reference(pages_id),
            b"MediaBox" => Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(612), Object::Integer(792),
            ]),
            b"Contents" => Object::Reference(dropped_content),
            b"Resources" => Object::Dictionary(dictionary! { b"Font" => Object::Dictionary(dictionary! {}) }),
            b"Annots" => Object::Array(vec![Object::Reference(popup_id)]),
        });

        doc.objects.insert(
            link_id,
            Object::Dictionary(dictionary! {
                b"Type" => Object::Name(b"Annot".to_vec()),
                b"Subtype" => Object::Name(b"Link".to_vec()),
                b"Rect" => Object::Array(vec![
                    Object::Integer(10), Object::Integer(10),
                    Object::Integer(90), Object::Integer(30),
                ]),
                b"P" => Object::Reference(kept_page),
                b"Popup" => Object::Reference(popup_id),
                b"Dest" => Object::Array(vec![
                    Object::Reference(dropped_page), Object::Name(b"Fit".to_vec()),
                ]),
            }),
        );
        doc.objects.insert(
            popup_id,
            Object::Dictionary(dictionary! {
                b"Type" => Object::Name(b"Annot".to_vec()),
                b"Subtype" => Object::Name(b"Popup".to_vec()),
                b"Rect" => Object::Array(vec![
                    Object::Integer(10), Object::Integer(40),
                    Object::Integer(90), Object::Integer(80),
                ]),
                b"P" => Object::Reference(dropped_page),
                b"Contents" => Object::String(
                    b"DroppedAnnotationSecret".to_vec(), StringFormat::Literal,
                ),
            }),
        );

        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                b"Type" => Object::Name(b"Pages".to_vec()),
                b"Kids" => Object::Array(vec![
                    Object::Reference(kept_page), Object::Reference(dropped_page),
                ]),
                b"Count" => Object::Integer(2),
            }),
        );
        finish(
            &mut doc,
            dictionary! {
                b"Type" => Object::Name(b"Catalog".to_vec()),
                b"Pages" => Object::Reference(pages_id),
            },
        )
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn split_does_not_carry_a_dropped_page_through_an_annotation() {
        // The kept page's link names the dropped page as its destination and shares a
        // popup that lives on it. The object-graph walk that decides what to keep follows
        // every reference, so leaving those in place carries the dropped page's dictionary,
        // its content stream, and its own annotation into the output — invisible to a
        // reader, plainly readable in the bytes. Splitting out page 0 must leave nothing of
        // page 1 behind.
        let bytes = doc_with_cross_page_annotation();
        assert!(
            contains(&bytes, b"DroppedPageContentSecret"),
            "fixture must actually contain the dropped page's content"
        );

        let outs = split(&bytes, &[PageRange { start: 0, end: 0 }]).unwrap();
        assert_eq!(page_count(&outs[0]), 1);
        assert!(
            !contains(&outs[0], b"DroppedPageContentSecret"),
            "the dropped page's content stream survived in the split output"
        );
        assert!(
            !contains(&outs[0], b"DroppedAnnotationSecret"),
            "the dropped page's annotation survived in the split output"
        );
        // The kept page's own content is untouched, and the output still loads.
        assert!(contains(&outs[0], b"kept page"));
        assert_eq!(
            crate::Document::load(outs[0].clone()).unwrap().page_count(),
            1
        );
    }

    #[test]
    fn split_keeps_an_annotation_whose_targets_are_all_kept() {
        // Pruning is targeted, not a blanket strip: keep both pages and the link survives
        // with its destination and popup intact, because nothing it names left the range.
        let outs = split(
            &doc_with_cross_page_annotation(),
            &[PageRange { start: 0, end: 1 }],
        )
        .unwrap();
        let out_doc = Document::load_mem(&outs[0]).unwrap();
        let first_page = page_ids(&out_doc)[0];
        let annots = out_doc
            .get_dictionary(first_page)
            .unwrap()
            .get(b"Annots")
            .and_then(Object::as_array)
            .expect("the kept page keeps its annotation");
        let link = out_doc
            .get_dictionary(annots[0].as_reference().unwrap())
            .unwrap();
        assert!(link.has(b"Dest"), "an in-range destination is kept");
        assert!(link.has(b"Popup"), "an in-range popup is kept");
    }

    #[test]
    fn split_drops_only_the_out_of_range_annotation_links() {
        // A link whose destination left the document is broken however it is handled;
        // dropping the reference is the repair that does not smuggle the target along.
        // The annotation itself — its rectangle, its subtype, its own page — stays.
        let outs = split(
            &doc_with_cross_page_annotation(),
            &[PageRange { start: 0, end: 0 }],
        )
        .unwrap();
        let out_doc = Document::load_mem(&outs[0]).unwrap();
        let kept_page = page_ids(&out_doc)[0];
        let annots = out_doc
            .get_dictionary(kept_page)
            .unwrap()
            .get(b"Annots")
            .and_then(Object::as_array)
            .expect("the link annotation itself is kept");
        let link = out_doc
            .get_dictionary(annots[0].as_reference().unwrap())
            .unwrap();
        assert!(
            !link.has(b"Dest"),
            "the out-of-range destination is dropped"
        );
        assert!(
            !link.has(b"Popup"),
            "the popup on a dropped page is dropped"
        );
        assert_eq!(
            link.get(b"P").and_then(Object::as_reference).unwrap(),
            kept_page,
            "the annotation still belongs to the page it is on"
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

    #[test]
    fn merge_named_dests_are_sorted() {
        // The /Names array must be lexically ordered — readers binary-search it. The
        // inputs' names interleave (delta then alpha) so unsorted output would be wrong.
        let a = doc_with_named_dest("delta");
        let b = doc_with_named_dest("alpha");
        let out = merge(&[a.as_slice(), b.as_slice()]).unwrap();
        let names = dest_names(&out);
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted);
    }

    #[test]
    fn generate_ops_reject_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        assert_eq!(split(&big, &[]), Err(GenerateError::Rejected));
        assert_eq!(
            rotate(&big, Rotation::Cw90, &PageSelection::All),
            Err(GenerateError::Rejected)
        );
        assert_eq!(merge(&[&big]), Err(GenerateError::Rejected));
    }

    #[test]
    fn split_flattens_inherited_attributes() {
        // A page that inherits MediaBox + Resources from the root /Pages node.
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let content_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"".to_vec())));
        let page_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Page".to_vec()),
            b"Parent" => Object::Reference(pages_id),
            b"Contents" => Object::Reference(content_id),
            // No MediaBox / Resources here — both inherited from the parent.
        });
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! {
            b"Type" => Object::Name(b"Pages".to_vec()),
            b"Kids" => Object::Array(vec![Object::Reference(page_id)]),
            b"Count" => Object::Integer(1),
            b"MediaBox" => Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(300), Object::Integer(400),
            ]),
            b"Resources" => Object::Dictionary(dictionary! { b"Font" => Object::Dictionary(dictionary! {}) }),
        }));
        let catalog_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Catalog".to_vec()),
            b"Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set(b"Root", Object::Reference(catalog_id));
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();

        let outs = split(&bytes, &[PageRange { start: 0, end: 0 }]).unwrap();
        // The kept page now carries its OWN MediaBox (flattened), correct value, and loads.
        let out_doc = Document::load_mem(&outs[0]).unwrap();
        let kept = page_ids(&out_doc)[0];
        let mb = out_doc
            .get_object(kept)
            .and_then(|o| o.as_dict())
            .unwrap()
            .get(b"MediaBox");
        assert!(matches!(mb, Ok(Object::Array(_))));
        assert!((mediabox_width(&outs[0], 0) - 300.0).abs() < 1.0);
        assert_eq!(
            crate::Document::load(outs[0].clone()).unwrap().page_count(),
            1
        );
    }
}
