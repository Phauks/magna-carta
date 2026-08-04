//! Page-annotation access: reading a page's `/Annots`, writing it back, and reading an
//! annotation's rectangle.
//!
//! Annotations sit beside a page's content stream rather than in it, so every operation
//! that rewrites or subsets page content has to decide what happens to them separately —
//! and each one needs the same two awkward details handled the same way: `/Annots` may be
//! an inline array or an indirect reference to one, and `/Rect` corners may be given in
//! either order.

use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::redact::Rect;

/// A page's `/Annots` entries, whether the array is stored inline or behind an indirect
/// reference. Entries are returned unresolved — an annotation is normally a reference,
/// but the array may hold a dictionary directly. Empty when the page has none.
pub(crate) fn page_annotation_entries(doc: &Document, page_id: ObjectId) -> Vec<Object> {
    match doc
        .get_object(page_id)
        .ok()
        .and_then(|o| o.as_dict().ok())
        .and_then(|page| page.get(b"Annots").ok())
    {
        Some(Object::Array(entries)) => entries.clone(),
        Some(Object::Reference(id)) => doc
            .get_object(*id)
            .ok()
            .and_then(|o| o.as_array().ok())
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// Replace a page's `/Annots` with `entries`, removing the key entirely when nothing is
/// left. The array is written inline, so an indirect array object the page no longer
/// needs becomes unreferenced and the caller's prune takes it.
pub(crate) fn set_page_annotations(doc: &mut Document, page_id: ObjectId, entries: Vec<Object>) {
    if let Ok(page) = doc.get_object_mut(page_id).and_then(|o| o.as_dict_mut()) {
        if entries.is_empty() {
            page.remove(b"Annots");
        } else {
            page.set("Annots", Object::Array(entries));
        }
    }
}

/// An annotation's `/Rect` as a display-point [`Rect`], or `None` when it is absent or is
/// not four numbers. The corners are normalised, because a PDF may give them in either
/// order and every caller wants a rectangle it can compare rather than raw corners.
pub(crate) fn annotation_rect(dict: &Dictionary) -> Option<Rect> {
    let corners: Vec<f32> = dict
        .get(b"Rect")
        .and_then(|o| o.as_array())
        .ok()?
        .iter()
        .filter_map(|o| {
            o.as_float()
                .ok()
                .or_else(|| o.as_i64().ok().map(|i| i as f32))
        })
        .collect();
    if corners.len() != 4 {
        return None;
    }
    Some(Rect {
        x0: corners[0].min(corners[2]),
        y0: corners[1].min(corners[3]),
        x1: corners[0].max(corners[2]),
        y1: corners[1].max(corners[3]),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    fn page_with_annots(annots: Object) -> (Document, ObjectId) {
        let mut doc = Document::with_version("1.5");
        let annotation = doc.add_object(dictionary! {
            b"Subtype" => Object::Name(b"Text".to_vec()),
        });
        let entries = match annots {
            Object::Null => Object::Array(vec![Object::Reference(annotation)]),
            other => other,
        };
        let page = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Page".to_vec()),
            b"Annots" => entries,
        });
        (doc, page)
    }

    #[test]
    fn reads_an_inline_annots_array() {
        let (doc, page) = page_with_annots(Object::Null);
        assert_eq!(page_annotation_entries(&doc, page).len(), 1);
    }

    #[test]
    fn reads_an_annots_array_held_behind_a_reference() {
        // A page may point at the array rather than carry it, and a reader that only
        // handles the inline form silently sees a page with no annotations at all.
        let mut doc = Document::with_version("1.5");
        let annotation =
            doc.add_object(dictionary! { b"Subtype" => Object::Name(b"Text".to_vec()) });
        let array = doc.add_object(Object::Array(vec![Object::Reference(annotation)]));
        let page = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Page".to_vec()),
            b"Annots" => Object::Reference(array),
        });
        assert_eq!(page_annotation_entries(&doc, page).len(), 1);
    }

    #[test]
    fn a_page_without_annotations_reads_as_empty() {
        let mut doc = Document::with_version("1.5");
        let page = doc.add_object(dictionary! { b"Type" => Object::Name(b"Page".to_vec()) });
        assert!(page_annotation_entries(&doc, page).is_empty());
    }

    #[test]
    fn writing_an_empty_list_removes_the_key() {
        let (mut doc, page) = page_with_annots(Object::Null);
        set_page_annotations(&mut doc, page, Vec::new());
        assert!(!doc.get_dictionary(page).unwrap().has(b"Annots"));
        assert!(page_annotation_entries(&doc, page).is_empty());
    }

    #[test]
    fn normalises_rect_corners_given_in_either_order() {
        let ordered = dictionary! {
            b"Rect" => Object::Array(vec![
                Object::Integer(10), Object::Integer(20),
                Object::Integer(30), Object::Integer(40),
            ]),
        };
        let reversed = dictionary! {
            b"Rect" => Object::Array(vec![
                Object::Real(30.0), Object::Real(40.0),
                Object::Real(10.0), Object::Real(20.0),
            ]),
        };
        for dict in [ordered, reversed] {
            let rect = annotation_rect(&dict).expect("four numbers is a rectangle");
            assert_eq!(
                (rect.x0, rect.y0, rect.x1, rect.y1),
                (10.0, 20.0, 30.0, 40.0)
            );
        }
    }

    #[test]
    fn an_unreadable_rect_is_none() {
        assert!(annotation_rect(&dictionary! {}).is_none());
        assert!(annotation_rect(&dictionary! {
            b"Rect" => Object::Array(vec![Object::Integer(1), Object::Integer(2)]),
        })
        .is_none());
    }
}
