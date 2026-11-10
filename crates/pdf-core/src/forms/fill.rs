//! Filling: setting each field's value and giving its widgets an appearance that shows it.

use super::appearance::{multiline_text_appearance, text_appearance};
use super::*;

// ── Widget rect resolution ────────────────────────────────────────────────────

/// Resolve the /Rect of a widget annotation.
/// Returns `None` when the widget has no /Rect or when it cannot be parsed.
fn get_widget_rect(doc: &Document, widget_id: ObjectId) -> Option<[f32; 4]> {
    let dict = doc.get_object(widget_id).ok()?.as_dict().ok()?;
    let arr = dict.get(b"Rect").ok()?.as_array().ok()?;
    let nums: Vec<f32> = arr
        .iter()
        .filter_map(|o| match o {
            Object::Integer(n) => Some(*n as f32),
            Object::Real(r) => Some(*r),
            _ => None,
        })
        .collect();
    if nums.len() >= 4 {
        Some([nums[0], nums[1], nums[2], nums[3]])
    } else {
        None
    }
}

/// Find the on-state name for a checkbox — the first non-"Off" key in the
/// widget's /AP /N dictionary. Returns `None` when no such key exists.
fn get_checkbox_on_state(doc: &Document, widget_ids: &[ObjectId]) -> Option<String> {
    widget_ids.iter().find_map(|&widget_id| {
        let widget_dict = doc.get_object(widget_id).ok()?.as_dict().ok()?;
        let ap_dict = widget_dict
            .get(b"AP")
            .ok()
            .and_then(|o| resolve_dict(doc, o))?;
        let n_dict = ap_dict.get(b"N").ok().and_then(|o| resolve_dict(doc, o))?;
        n_dict.iter().find_map(|(key, _)| {
            if key != b"Off" {
                Some(String::from_utf8_lossy(key).into_owned())
            } else {
                None
            }
        })
    })
}

/// Return `true` when the widget's /AP /N dictionary contains `state` as a key.
fn widget_has_ap_n_key(doc: &Document, widget_id: ObjectId, state: &str) -> bool {
    let widget_dict = match doc
        .get_object(widget_id)
        .ok()
        .and_then(|o| o.as_dict().ok())
    {
        Some(d) => d,
        None => return false,
    };
    let ap_obj = match widget_dict.get(b"AP").ok() {
        Some(o) => o,
        None => return false,
    };
    let ap_dict = match resolve_dict(doc, ap_obj) {
        Some(d) => d,
        None => return false,
    };
    let n_obj = match ap_dict.get(b"N").ok() {
        Some(o) => o,
        None => return false,
    };
    match resolve_dict(doc, n_obj) {
        Some(n_dict) => n_dict.has(state.as_bytes()),
        None => false,
    }
}

// ── Public entry point: fill ───────────────────────────────────────────────────

/// Fill interactive AcroForm fields with the provided values.
///
/// For each `(name, FieldValue)` entry in `values` that names a terminal field
/// in the document, the field's stored value and widget appearances are updated:
///
/// - **Text / Choice** — `/V` set to the string; a Form XObject appearance is
///   generated for each widget and written to `/AP /N`.
/// - **Checkbox** — `/V` and each widget `/AS` set to the on-state name (the
///   first non-"Off" key in `/AP /N`, defaulting to "Yes") or "Off".
/// - **Radio** — `/V` set to the chosen state; each kid widget `/AS` set to
///   that state if the kid's `/AP /N` carries it, otherwise "Off".
/// - **PushButton / Signature / Unknown**, or a name absent from the form —
///   silently ignored.
///
/// When `opts.flatten` is true, the filled document is flattened in the same
/// pass: appearances are baked into page content and the interactive form is
/// dropped. The returned bytes carry no AcroForm.
///
/// Returns `FormError::NoAcroForm` when the document has no AcroForm.
pub fn fill_form(
    bytes: &[u8],
    values: &BTreeMap<String, FieldValue>,
    opts: &FormFillOptions,
) -> Result<Vec<u8>, FormError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| FormError::Rejected)?;
    let mut doc = Document::load_mem(bytes).map_err(|e| FormError::Parse(e.to_string()))?;
    if crate::guard::is_locked(&doc) {
        return Err(FormError::Encrypted);
    }

    if catalog_subdict(&doc, b"AcroForm").is_none() {
        return Err(FormError::NoAcroForm);
    }

    // Add one shared Helvetica font object for text-field appearance streams.
    let font_id = doc.add_object(Object::Dictionary(dictionary! {
        "Type" => Object::Name(b"Font".to_vec()),
        "Subtype" => Object::Name(b"Type1".to_vec()),
        "BaseFont" => Object::Name(b"Helvetica".to_vec()),
        "Encoding" => Object::Name(b"WinAnsiEncoding".to_vec()),
    }));

    // Build a name → TerminalField index for fast lookup.
    let field_index: BTreeMap<String, TerminalField> = terminal_fields(&doc)
        .into_iter()
        .map(|f| (f.name.clone(), f))
        .collect();

    for (name, value) in values {
        let field = match field_index.get(name) {
            Some(f) => f,
            None => continue,
        };
        let field_id = field.id;
        let kind = field.kind;
        let da_size = field.da_size;
        let quadding = field.quadding;
        let multiline = field.multiline;
        let widget_ids: Vec<ObjectId> = field.widgets.clone();

        match kind {
            FieldKind::Text | FieldKind::Choice => {
                let text = match value {
                    FieldValue::Text(s) | FieldValue::Choice(s) => s.as_str(),
                    FieldValue::Bool(_) => continue,
                };
                // Set /V on the field dict.
                if let Ok(obj) = doc.get_object_mut(field_id) {
                    if let Ok(dict) = obj.as_dict_mut() {
                        // A text string: plain bytes while it is ASCII, UTF-16 otherwise.
                        // Writing UTF-8 bytes here makes a viewer show "José" as "JosÃ©".
                        dict.set(
                            b"V",
                            Object::String(
                                crate::sign::pdf_text_string(text),
                                lopdf::StringFormat::Literal,
                            ),
                        );
                    }
                }
                // Generate an appearance stream for each widget.
                for widget_id in &widget_ids {
                    let rect = match get_widget_rect(&doc, *widget_id) {
                        Some(r) => r,
                        None => continue,
                    };
                    let appearance_id = if multiline {
                        multiline_text_appearance(&mut doc, rect, da_size, quadding, font_id, text)
                    } else {
                        text_appearance(&mut doc, rect, da_size, quadding, font_id, text)
                    };
                    let ap_dict = dictionary! { "N" => Object::Reference(appearance_id) };
                    if let Ok(obj) = doc.get_object_mut(*widget_id) {
                        if let Ok(dict) = obj.as_dict_mut() {
                            dict.set(b"AP", Object::Dictionary(ap_dict));
                        }
                    }
                }
            }
            FieldKind::Checkbox => {
                let checked = match value {
                    FieldValue::Bool(b) => *b,
                    _ => continue,
                };
                let on_state =
                    get_checkbox_on_state(&doc, &widget_ids).unwrap_or_else(|| "Yes".to_string());
                let state_bytes: Vec<u8> = if checked {
                    on_state.into_bytes()
                } else {
                    b"Off".to_vec()
                };
                // Set /V on the field dict.
                if let Ok(obj) = doc.get_object_mut(field_id) {
                    if let Ok(dict) = obj.as_dict_mut() {
                        dict.set(b"V", Object::Name(state_bytes.clone()));
                    }
                }
                // Set /AS on each widget.
                for widget_id in &widget_ids {
                    if let Ok(obj) = doc.get_object_mut(*widget_id) {
                        if let Ok(dict) = obj.as_dict_mut() {
                            dict.set(b"AS", Object::Name(state_bytes.clone()));
                        }
                    }
                }
            }
            FieldKind::Radio => {
                let state = match value {
                    FieldValue::Choice(s) => s.as_str(),
                    _ => continue,
                };
                // Set /V on the field dict.
                if let Ok(obj) = doc.get_object_mut(field_id) {
                    if let Ok(dict) = obj.as_dict_mut() {
                        dict.set(b"V", Object::Name(state.as_bytes().to_vec()));
                    }
                }
                // Set /AS on each kid widget to the chosen state or "Off".
                for widget_id in &widget_ids {
                    let has_state = widget_has_ap_n_key(&doc, *widget_id, state);
                    let as_bytes: Vec<u8> = if has_state {
                        state.as_bytes().to_vec()
                    } else {
                        b"Off".to_vec()
                    };
                    if let Ok(obj) = doc.get_object_mut(*widget_id) {
                        if let Ok(dict) = obj.as_dict_mut() {
                            dict.set(b"AS", Object::Name(as_bytes));
                        }
                    }
                }
            }
            FieldKind::PushButton | FieldKind::Signature | FieldKind::Unknown => {
                // Not fillable; silently skip.
            }
        }
    }

    // Clear /NeedAppearances so viewers render the appearances we generated.
    // The catalog's /AcroForm may be an indirect reference or an inline dict;
    // both reach the fill path through the NoAcroForm gate, so both must clear.
    {
        let catalog_id: Option<ObjectId> = doc
            .trailer
            .get(b"Root")
            .ok()
            .and_then(|o| o.as_reference().ok());
        if let Some(catalog_id) = catalog_id {
            let acroform_ref: Option<ObjectId> = doc
                .get_object(catalog_id)
                .ok()
                .and_then(|o| o.as_dict().ok())
                .and_then(|cat| cat.get(b"AcroForm").ok())
                .and_then(|o| o.as_reference().ok());
            match acroform_ref {
                // Indirect reference: mutate the referenced AcroForm object.
                Some(acro_id) => {
                    if let Ok(dict) = doc.get_object_mut(acro_id).and_then(|o| o.as_dict_mut()) {
                        dict.set(b"NeedAppearances", Object::Boolean(false));
                    }
                }
                // Inline dict: mutate /AcroForm in place within the catalog.
                None => {
                    if let Ok(cat) = doc.get_object_mut(catalog_id).and_then(|o| o.as_dict_mut()) {
                        if let Ok(Object::Dictionary(d)) = cat.get_mut(b"AcroForm") {
                            d.set(b"NeedAppearances", Object::Boolean(false));
                        }
                    }
                }
            }
        }
    }

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|e| FormError::Reassemble(e.to_string()))?;
    if opts.flatten {
        return flatten_form(&output);
    }
    Ok(output)
}
