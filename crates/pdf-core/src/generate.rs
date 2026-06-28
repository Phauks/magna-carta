//! PDF assembly primitives — merge, split, and rotate. Pure lopdf model work (no
//! rendering): pages are reorganised, never re-rasterised, and their content is left
//! untouched. These are visible, reversible document operations — they do not remove
//! hidden content or metadata; use `redact`/`sanitize` for that.

use lopdf::{Document, Object, ObjectId};

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
}
