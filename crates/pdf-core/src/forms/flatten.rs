//! Flattening: baking each widget's appearance into its page and removing the form.

use super::*;

// ── Public entry point: flatten ────────────────────────────────────────────────

/// Bake widget appearances into permanent page content and remove the interactive form.
///
/// For each widget annotation that carries a rendered appearance (`/AP /N`), the
/// appearance stream is added to the page as a Form XObject and a `cm`/`Do` draw
/// call is appended to the page content so the appearance is part of the static
/// page. The widget annotation is then removed from `/Annots`. Non-widget
/// annotations (e.g. `/Link`) are preserved untouched.
///
/// After all pages are processed the `/AcroForm` entry is removed from the
/// catalog, making the document non-interactive.
///
/// Returns `FormError::NoAcroForm` when the document has no AcroForm.
pub fn flatten_form(bytes: &[u8]) -> Result<Vec<u8>, FormError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| FormError::Rejected)?;
    let mut doc = Document::load_mem(bytes).map_err(|e| FormError::Parse(e.to_string()))?;
    if crate::guard::is_locked(&doc) {
        return Err(FormError::Encrypted);
    }

    if catalog_subdict(&doc, b"AcroForm").is_none() {
        return Err(FormError::NoAcroForm);
    }

    // Pages in reading order (1-based BTreeMap key → sort → visit).
    let mut pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();
    pages.sort_by_key(|(n, _)| *n);

    for (_, page_id) in &pages {
        let page_id = *page_id;

        // Dereference /Annots — it may be an inline array OR an indirect reference.
        let annots_obj: Object = match doc
            .get_object(page_id)
            .ok()
            .and_then(|o| o.as_dict().ok())
            .and_then(|d| d.get(b"Annots").ok())
        {
            Some(o) => o.clone(),
            None => continue,
        };

        let annot_refs: Vec<Object> = match annots_obj {
            Object::Array(a) => a,
            Object::Reference(id) => doc
                .get_object(id)
                .ok()
                .and_then(|o| o.as_array().ok())
                .cloned()
                .unwrap_or_default(),
            _ => continue,
        };

        let annot_ids: Vec<ObjectId> = annot_refs
            .iter()
            .filter_map(|o| o.as_reference().ok())
            .collect();

        let mut draw_ops: Vec<String> = Vec::new();
        let mut baked_widget_ids: BTreeSet<ObjectId> = BTreeSet::new();
        // Counter used to mint unique XObject names on this page (MagnaCartaFlat0, 1, …).
        let mut xobject_counter: usize = 0;

        for &widget_id in &annot_ids {
            // Clone the widget dict so we release the immutable borrow on doc.
            let widget_dict: Dictionary = match doc
                .get_object(widget_id)
                .ok()
                .and_then(|o| o.as_dict().ok())
                .cloned()
            {
                Some(d) => d,
                None => continue,
            };

            // Only process /Widget annotations.
            let is_widget = matches!(
                widget_dict.get(b"Subtype").ok(),
                Some(Object::Name(n)) if n == b"Widget"
            );
            if !is_widget {
                continue;
            }

            // Skip widgets with no /AP — nothing to bake.
            let ap_obj: Object = match widget_dict.get(b"AP").ok().cloned() {
                Some(o) => o,
                None => continue,
            };

            // Resolve /AP to its dictionary (inline or indirect).
            let ap_dict: Dictionary = match crate::surgery::resolve_dict(&doc, &ap_obj).cloned() {
                Some(d) => d,
                None => continue,
            };

            // Clone /AP /N so we can inspect it without holding a doc borrow.
            let n_obj: Object = match ap_dict.get(b"N").ok().cloned() {
                Some(o) => o,
                None => continue,
            };

            // Resolve the appearance stream ObjectId.
            // /N may be a direct stream reference, or a dict of named states (checkbox/radio).
            // For named states we look up the widget's /AS key.
            let appearance_stream_id: ObjectId = {
                // Check whether /N (if a reference) points directly at a stream.
                let direct_stream_id: Option<ObjectId> = match &n_obj {
                    Object::Reference(id) => match doc.get_object(*id).ok() {
                        Some(Object::Stream(_)) => Some(*id),
                        _ => None,
                    },
                    _ => None,
                };

                if let Some(stream_id) = direct_stream_id {
                    stream_id
                } else {
                    // Named-states dict: select the substream for the widget's /AS state.
                    let as_key: Vec<u8> = match widget_dict.get(b"AS").ok() {
                        Some(Object::Name(n)) => n.clone(),
                        _ => continue,
                    };

                    let state_ref: Option<ObjectId> = match &n_obj {
                        Object::Reference(id) => {
                            // /N is an indirect dict of named states.
                            doc.get_object(*id)
                                .ok()
                                .and_then(|o| o.as_dict().ok())
                                .and_then(|d| d.get(as_key.as_slice()).ok())
                                .and_then(|o| o.as_reference().ok())
                        }
                        Object::Dictionary(inline_dict) => {
                            // /N is an inline dict of named states.
                            inline_dict
                                .get(as_key.as_slice())
                                .ok()
                                .and_then(|o| o.as_reference().ok())
                        }
                        _ => None,
                    };

                    match state_ref {
                        Some(id) => id,
                        None => continue,
                    }
                }
            };

            // Extract /BBox and optional /Matrix from the appearance stream.
            let (bbox_obj, matrix_obj): (Option<Object>, Option<Object>) =
                match doc.get_object(appearance_stream_id).ok() {
                    Some(Object::Stream(s)) => (
                        s.dict.get(b"BBox").ok().cloned(),
                        s.dict.get(b"Matrix").ok().cloned(),
                    ),
                    _ => continue,
                };

            // Parse BBox as [bx0, by0, bx1, by1].
            let bbox_nums: Vec<f32> = match bbox_obj.as_ref().and_then(|o| o.as_array().ok()) {
                Some(arr) => arr
                    .iter()
                    .filter_map(|o| match o {
                        Object::Integer(n) => Some(*n as f32),
                        Object::Real(r) => Some(*r),
                        _ => None,
                    })
                    .collect(),
                None => continue,
            };
            if bbox_nums.len() < 4 {
                continue;
            }
            let (bx0, by0, bx1, by1) = (bbox_nums[0], bbox_nums[1], bbox_nums[2], bbox_nums[3]);
            let bbox_w = bx1 - bx0;
            let bbox_h = by1 - by0;
            // Guard against a degenerate (zero-area) BBox — skip rather than divide by zero.
            if bbox_w.abs() < 1e-6 || bbox_h.abs() < 1e-6 {
                continue;
            }

            // Parse widget /Rect as [rx0, ry0, rx1, ry1], normalising to x0<x1, y0<y1.
            let rect_nums: Vec<f32> = match widget_dict
                .get(b"Rect")
                .ok()
                .and_then(|o| o.as_array().ok())
            {
                Some(arr) => arr
                    .iter()
                    .filter_map(|o| match o {
                        Object::Integer(n) => Some(*n as f32),
                        Object::Real(r) => Some(*r),
                        _ => None,
                    })
                    .collect(),
                None => continue,
            };
            if rect_nums.len() < 4 {
                continue;
            }
            let rx0 = rect_nums[0].min(rect_nums[2]);
            let ry0 = rect_nums[1].min(rect_nums[3]);
            let rx1 = rect_nums[0].max(rect_nums[2]);
            let ry1 = rect_nums[1].max(rect_nums[3]);
            let rect_w = rx1 - rx0;
            let rect_h = ry1 - ry0;

            // Place the appearance into the widget rect. A Form XObject's /Matrix is
            // applied automatically by the `Do` operator, so the placement `cm` must map
            // the *transformed* BBox onto the rect WITHOUT re-applying /Matrix itself
            // (re-applying it here would transform the appearance twice). Transform the
            // four BBox corners by /Matrix, take their upright bounding box, and fit that
            // box to the rect with a pure translate+scale.
            let matrix: [f32; 6] = match matrix_obj.as_ref().and_then(|o| o.as_array().ok()) {
                Some(arr) => {
                    let m: Vec<f32> = arr
                        .iter()
                        .filter_map(|o| match o {
                            Object::Integer(n) => Some(*n as f32),
                            Object::Real(r) => Some(*r),
                            _ => None,
                        })
                        .collect();
                    if m.len() >= 6 {
                        [m[0], m[1], m[2], m[3], m[4], m[5]]
                    } else {
                        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
                    }
                }
                None => [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            };
            // Map a point through /Matrix (PDF row-vector convention:
            // x' = a*x + c*y + e, y' = b*x + d*y + f).
            let map_point = |x: f32, y: f32| -> (f32, f32) {
                (
                    matrix[0] * x + matrix[2] * y + matrix[4],
                    matrix[1] * x + matrix[3] * y + matrix[5],
                )
            };
            let corners = [
                map_point(bx0, by0),
                map_point(bx1, by0),
                map_point(bx1, by1),
                map_point(bx0, by1),
            ];
            let tx0 = corners.iter().map(|c| c.0).fold(f32::INFINITY, f32::min);
            let tx1 = corners
                .iter()
                .map(|c| c.0)
                .fold(f32::NEG_INFINITY, f32::max);
            let ty0 = corners.iter().map(|c| c.1).fold(f32::INFINITY, f32::min);
            let ty1 = corners
                .iter()
                .map(|c| c.1)
                .fold(f32::NEG_INFINITY, f32::max);
            let transformed_w = tx1 - tx0;
            let transformed_h = ty1 - ty0;
            // Degenerate transformed box — skip rather than divide by zero.
            if transformed_w.abs() < 1e-6 || transformed_h.abs() < 1e-6 {
                continue;
            }
            let sx = rect_w / transformed_w;
            let sy = rect_h / transformed_h;
            // The placement transform A maps the transformed box origin to the rect
            // origin and scales to fit; `Do` then applies /Matrix on top of A.
            let cm: [f32; 6] = [sx, 0.0, 0.0, sy, rx0 - tx0 * sx, ry0 - ty0 * sy];

            // Mint a unique XObject name that won't collide with existing resources.
            let xobject_name = format!("MagnaCartaFlat{xobject_counter}");
            xobject_counter += 1;

            // --- Resource merge (non-destructive, mirrors the Bates stamp pattern) ---
            // Resolve the page's effective /Resources (handles inheritance and indirect refs).
            let existing_resources: Dictionary =
                crate::surgery::resolve_inherited_resources(&doc, page_id)
                    .cloned()
                    .unwrap_or_default();

            // Clone the existing /XObject subdict so no prior XObject entry is dropped.
            let mut xobject_dict: Dictionary = match existing_resources.get(b"XObject") {
                Ok(xobject_obj) => crate::surgery::resolve_dict(&doc, xobject_obj)
                    .cloned()
                    .unwrap_or_default(),
                Err(_) => Dictionary::new(),
            };

            // Register the appearance stream under the new distinctive name.
            xobject_dict.set(
                xobject_name.as_bytes(),
                Object::Reference(appearance_stream_id),
            );

            // Write the merged /Resources back onto the page dict (all doc borrows end here).
            let mut merged_resources = existing_resources;
            merged_resources.set(b"XObject", Object::Dictionary(xobject_dict));
            if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                page_dict.set(b"Resources", Object::Dictionary(merged_resources));
            }

            // Record the draw call for this widget (accumulated per page, appended as one stream).
            let [cm_a, cm_b, cm_c, cm_d, cm_e, cm_f] = cm;
            draw_ops.push(format!(
                "q {cm_a:.6} {cm_b:.6} {cm_c:.6} {cm_d:.6} {cm_e:.6} {cm_f:.6} cm /{xobject_name} Do Q"
            ));

            baked_widget_ids.insert(widget_id);
        }

        // Append one new content stream at the end of the page's /Contents so all
        // widget appearances paint on top of existing content.
        if !draw_ops.is_empty() {
            let combined = draw_ops.join("\n");
            let new_stream = Stream::new(dictionary! {}, combined.into_bytes());
            let new_stream_id = doc.add_object(Object::Stream(new_stream));

            let contents_obj = doc
                .get_dictionary(page_id)
                .ok()
                .and_then(|d| d.get(b"Contents").ok().cloned());

            match contents_obj {
                Some(Object::Reference(old_id)) => {
                    if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                        page_dict.set(
                            b"Contents",
                            Object::Array(vec![
                                Object::Reference(old_id),
                                Object::Reference(new_stream_id),
                            ]),
                        );
                    }
                }
                Some(Object::Array(mut arr)) => {
                    arr.push(Object::Reference(new_stream_id));
                    if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                        page_dict.set(b"Contents", Object::Array(arr));
                    }
                }
                _ => {
                    if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                        page_dict.set(b"Contents", Object::Reference(new_stream_id));
                    }
                }
            }
        }

        // Rebuild /Annots retaining only the annotations that were not baked.
        // Non-widget annotations (e.g. /Link) and widgets without a bakeable
        // appearance are kept; baked widgets are dropped.
        let kept_annots: Vec<Object> = annot_refs
            .into_iter()
            .filter(|o| {
                !o.as_reference()
                    .ok()
                    .map(|id| baked_widget_ids.contains(&id))
                    .unwrap_or(false)
            })
            .collect();

        if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
            if kept_annots.is_empty() {
                page_dict.remove(b"Annots");
            } else {
                page_dict.set(b"Annots", Object::Array(kept_annots));
            }
        }
    }

    // Remove /AcroForm from the catalog. Also remove /NeedAppearances if the catalog
    // carries it directly (it normally lives inside the AcroForm dict, but guard
    // against non-conformant documents that place it at catalog level).
    {
        let catalog_id: Option<ObjectId> = doc
            .trailer
            .get(b"Root")
            .ok()
            .and_then(|o| o.as_reference().ok());
        if let Some(catalog_id) = catalog_id {
            if let Ok(Object::Dictionary(catalog_dict)) = doc.get_object_mut(catalog_id) {
                catalog_dict.remove(b"AcroForm");
                catalog_dict.remove(b"NeedAppearances");
            }
        }
    }

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|e| FormError::Reassemble(e.to_string()))?;
    Ok(output)
}
