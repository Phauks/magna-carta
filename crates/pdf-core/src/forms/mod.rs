//! AcroForm field enumeration and appearance generation.
//!
//! Reads interactive form fields from a PDF, resolving the attribute-inheritance
//! rules defined in the PDF specification (/FT, /Ff, /DA, /V cascade from
//! parent field nodes to their terminal descendants).
//!
//! This module handles read and appearance generation. Fill and flatten are
//! separate operations built on top of this enumeration.

use std::collections::{BTreeMap, BTreeSet};

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};

use crate::scrub::catalog_subdict;
use crate::surgery::{resolve_array, resolve_dict};

mod appearance;
mod fill;
mod flatten;
#[cfg(test)]
mod tests;

pub(crate) use appearance::helvetica_text_width;
pub use fill::fill_form;
pub use flatten::flatten_form;

/// /Ff bit 13: the text field holds several lines.
const MULTILINE_FLAG: i64 = 1 << 12;

// ── Public types ───────────────────────────────────────────────────────────────

/// The interactive role of a form field.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FieldKind {
    Text,
    Checkbox,
    Radio,
    Choice,
    PushButton,
    Signature,
    Unknown,
}

/// The current value of a form field.
#[derive(Debug, Clone, PartialEq)]
pub enum FieldValue {
    Text(String),
    Bool(bool),
    Choice(String),
}

/// A resolved interactive form field with all inherited attributes applied.
#[derive(Debug, Clone)]
pub struct FormField {
    /// Fully-qualified field name (ancestor /T values joined with ".").
    pub name: String,
    pub kind: FieldKind,
    /// True when /Ff bit 1 (0x1) is set.
    pub read_only: bool,
    /// True when /Ff bit 2 (0x2) is set — the form declares the field must be
    /// answered before submission. Inherited down the field tree like every other
    /// flag, so a required group makes its terminal descendants required.
    pub required: bool,
    /// Effective /V decoded to a Rust value.
    pub value: Option<FieldValue>,
    /// /Opt display entries for Choice; on-state names for Radio.
    pub options: Vec<String>,
    /// 0-based page index of the first widget annotation.
    pub page: Option<u32>,
    /// /Rect of the first widget annotation in display points [llx, lly, urx, ury].
    pub rect: Option<[f32; 4]>,
    /// Object IDs of widget annotations belonging to this field.
    pub widgets: Vec<ObjectId>,
}

/// Options for form-fill operations.
/// Default: no flattening.
#[derive(Debug, Clone, Default)]
pub struct FormFillOptions {
    /// When true, bake widget appearances into page content and drop AcroForm.
    pub flatten: bool,
}

/// Errors from AcroForm operations.
#[derive(Debug)]
pub enum FormError {
    /// The document is locked with a password and was not opened: nothing in it can be
    /// read, so there is nothing to work on until [`crate::decrypt`] has unlocked it.
    Encrypted,
    /// The bytes could not be parsed as a valid PDF.
    Parse(String),
    /// The modified document could not be serialised.
    Reassemble(String),
    /// No AcroForm is present; only returned by fill/flatten, not read.
    NoAcroForm,
    /// The input exceeds the size cap or contains a decompression bomb.
    Rejected,
}

// ── Crate-internal resolved field ─────────────────────────────────────────────

/// A terminal field (has an effective /FT, no field-type child nodes) as
/// produced by the depth-first walk. Used by fill to locate and update fields.
// Carries the resolved per-field data the fill logic indexes by name to locate
// and update each field's widget annotations for /V, /AS, and /AP generation.
pub(crate) struct TerminalField {
    /// Object ID of the field dictionary.
    pub id: ObjectId,
    /// Fully-qualified dot-joined name.
    pub name: String,
    pub kind: FieldKind,
    /// Font size parsed from /DA (0.0 = auto-fit to widget height).
    pub da_size: f32,
    /// Horizontal alignment from /Q: 0 left, 1 centre, 2 right.
    pub quadding: i64,
    /// Whether the field holds several lines (/Ff bit 13): its text wraps and starts at the
    /// top of the box instead of sitting on one centred line.
    pub multiline: bool,
    /// Widget annotation object IDs.
    pub widgets: Vec<ObjectId>,
}

// ── Private walk output ────────────────────────────────────────────────────────

/// Full resolved state for one terminal field, carrying everything needed by
/// both `read_form` and `terminal_fields`.
struct WalkedField {
    id: ObjectId,
    name: String,
    kind: FieldKind,
    da_size: f32,
    quadding: i64,
    widgets: Vec<ObjectId>,
    effective_flags: i64,
    effective_value: Option<Object>,
}

// ── Inheritance state ──────────────────────────────────────────────────────────

#[derive(Clone, Default)]
struct InheritedState {
    field_type: Option<Vec<u8>>,
    flags: Option<i64>,
    default_appearance: Option<Vec<u8>>,
    value: Option<Object>,
    quadding: Option<i64>,
}

impl InheritedState {
    /// Produce a new state by overlaying attributes present in `dict` on top of
    /// the current inherited values.
    fn merged_with(&self, dict: &lopdf::Dictionary) -> Self {
        Self {
            field_type: match dict.get(b"FT").ok() {
                Some(Object::Name(bytes)) => Some(bytes.clone()),
                _ => self.field_type.clone(),
            },
            flags: dict
                .get(b"Ff")
                .ok()
                .and_then(|o| match o {
                    Object::Integer(n) => Some(*n),
                    Object::Real(r) => Some(*r as i64),
                    _ => None,
                })
                .or(self.flags),
            default_appearance: match dict.get(b"DA").ok() {
                Some(Object::String(bytes, _)) => Some(bytes.clone()),
                _ => self.default_appearance.clone(),
            },
            value: dict.get(b"V").ok().cloned().or_else(|| self.value.clone()),
            quadding: dict
                .get(b"Q")
                .ok()
                .and_then(|o| match o {
                    Object::Integer(n) => Some(*n),
                    Object::Real(r) => Some(*r as i64),
                    _ => None,
                })
                .or(self.quadding),
        }
    }
}

// ── String decoding ────────────────────────────────────────────────────────────

/// Decode a PDF /T or /V byte string.
/// Strings beginning with the UTF-16BE BOM (0xFE 0xFF) are decoded as UTF-16BE;
/// all others are treated as Latin-1 (byte == Unicode scalar value).
fn decode_pdf_string(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let pairs: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|p| u16::from_be_bytes([p[0], p[1]]))
            .collect();
        String::from_utf16_lossy(&pairs)
    } else {
        bytes.iter().map(|&b| b as char).collect()
    }
}

// ── /DA size extraction ────────────────────────────────────────────────────────

/// Extract the font size from a /DA content string such as "/Helv 12 Tf 0 g".
/// Returns 0.0 when no size is present (caller treats as auto-fit).
fn parse_da_font_size(da_bytes: &[u8]) -> f32 {
    let text = std::str::from_utf8(da_bytes).unwrap_or("");
    let tokens: Vec<&str> = text.split_whitespace().collect();
    for window in tokens.windows(3) {
        if window[2] == "Tf" {
            if let Ok(size) = window[1].parse::<f32>() {
                return size;
            }
        }
    }
    0.0
}

// ── Kind mapping ───────────────────────────────────────────────────────────────

fn kind_from_type_and_flags(field_type: &[u8], flags: i64) -> FieldKind {
    match field_type {
        b"Tx" => FieldKind::Text,
        b"Ch" => FieldKind::Choice,
        b"Sig" => FieldKind::Signature,
        b"Btn" => {
            if flags & 0x10000 != 0 {
                FieldKind::PushButton
            } else if flags & 0x8000 != 0 {
                FieldKind::Radio
            } else {
                FieldKind::Checkbox
            }
        }
        _ => FieldKind::Unknown,
    }
}

// ── Options extraction ─────────────────────────────────────────────────────────

/// Extract display strings from /Opt for a Choice field.
/// Each entry is either a plain PDF string or a two-element [export, display] array.
fn choice_options(doc: &Document, dict: &lopdf::Dictionary) -> Vec<String> {
    let arr = match dict.get(b"Opt").ok() {
        Some(Object::Array(a)) => a.clone(),
        Some(Object::Reference(id)) => doc
            .get_object(*id)
            .ok()
            .and_then(|o| o.as_array().ok())
            .cloned()
            .unwrap_or_default(),
        _ => return vec![],
    };
    arr.iter()
        .filter_map(|entry| {
            let obj = match entry {
                Object::Reference(id) => doc.get_object(*id).ok()?,
                other => other,
            };
            match obj {
                Object::String(bytes, _) => Some(decode_pdf_string(bytes)),
                Object::Array(pair) => {
                    // [export, display] — prefer the display value (index 1).
                    let display = pair.get(1).or_else(|| pair.first())?;
                    match display {
                        Object::String(bytes, _) => Some(decode_pdf_string(bytes)),
                        Object::Name(bytes) => Some(decode_pdf_string(bytes)),
                        _ => None,
                    }
                }
                _ => None,
            }
        })
        .collect()
}

/// Collect non-"Off" /AP /N keys from each widget kid for a Radio group.
fn radio_options(doc: &Document, widget_ids: &[ObjectId]) -> Vec<String> {
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut options = Vec::new();
    for &widget_id in widget_ids {
        let n_dict = doc
            .get_object(widget_id)
            .ok()
            .and_then(|o| o.as_dict().ok())
            .and_then(|d| d.get(b"AP").ok())
            .and_then(|o| resolve_dict(doc, o))
            .and_then(|ap| ap.get(b"N").ok())
            .and_then(|o| resolve_dict(doc, o));
        if let Some(nd) = n_dict {
            for (key, _) in nd.iter() {
                if key != b"Off" {
                    let name = String::from_utf8_lossy(key).into_owned();
                    if seen.insert(name.clone()) {
                        options.push(name);
                    }
                }
            }
        }
    }
    options
}

// ── Widget collection ──────────────────────────────────────────────────────────

/// Collect widget annotation object IDs for a field node.
/// A merged field+widget carries its own /Rect; otherwise collect child objects
/// that have /Subtype /Widget but no /T (pure widgets, not sub-fields).
fn collect_widget_ids(
    doc: &Document,
    field_id: ObjectId,
    dict: &lopdf::Dictionary,
) -> Vec<ObjectId> {
    if dict.has(b"Rect") {
        return vec![field_id];
    }
    let kids: Vec<Object> = match dict.get(b"Kids").ok().and_then(|o| resolve_array(doc, o)) {
        Some(a) => a.clone(),
        None => return vec![],
    };
    kids.iter()
        .filter_map(|o| o.as_reference().ok())
        .filter(|&kid_id| {
            doc.get_object(kid_id)
                .ok()
                .and_then(|o| o.as_dict().ok())
                .map(|d| {
                    let is_widget = matches!(
                        d.get(b"Subtype").ok(),
                        Some(Object::Name(n)) if n == b"Widget"
                    );
                    is_widget && !d.has(b"T")
                })
                .unwrap_or(false)
        })
        .collect()
}

// ── Page / rect lookup ─────────────────────────────────────────────────────────

/// Dereference a page's /Annots, handling both inline and indirect arrays.
fn page_annotation_ids(doc: &Document, page_id: ObjectId) -> Vec<ObjectId> {
    let annots_obj = match doc
        .get_object(page_id)
        .ok()
        .and_then(|o| o.as_dict().ok())
        .and_then(|d| d.get(b"Annots").ok())
    {
        Some(o) => o.clone(),
        None => return vec![],
    };
    let arr = match annots_obj {
        Object::Array(a) => a,
        Object::Reference(id) => doc
            .get_object(id)
            .ok()
            .and_then(|o| o.as_array().ok())
            .cloned()
            .unwrap_or_default(),
        _ => vec![],
    };
    arr.iter().filter_map(|o| o.as_reference().ok()).collect()
}

/// Find the 0-based page index and /Rect of a widget annotation.
/// Scans every page's /Annots list to locate the widget.
fn widget_page_and_rect(doc: &Document, widget_id: ObjectId) -> (Option<u32>, Option<[f32; 4]>) {
    // get_pages returns a BTreeMap keyed by 1-based page number.
    let mut pages: Vec<(u32, ObjectId)> = doc
        .get_pages()
        .into_iter()
        .map(|(n, id)| (n - 1, id))
        .collect();
    pages.sort_by_key(|(n, _)| *n);

    for (page_index, page_id) in pages {
        if !page_annotation_ids(doc, page_id).contains(&widget_id) {
            continue;
        }
        let rect = doc
            .get_object(widget_id)
            .ok()
            .and_then(|o| o.as_dict().ok())
            .and_then(|d| d.get(b"Rect").ok())
            .and_then(|o| o.as_array().ok())
            .and_then(|arr| {
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
            });
        return (Some(page_index), rect);
    }
    (None, None)
}

// ── Value decoding ─────────────────────────────────────────────────────────────

fn decode_field_value(obj: &Object, kind: FieldKind) -> Option<FieldValue> {
    match obj {
        Object::String(bytes, _) => {
            let text = decode_pdf_string(bytes);
            match kind {
                FieldKind::Checkbox => Some(FieldValue::Bool(text != "Off")),
                FieldKind::Radio | FieldKind::Choice => Some(FieldValue::Choice(text)),
                _ => Some(FieldValue::Text(text)),
            }
        }
        Object::Name(bytes) => {
            let name = decode_pdf_string(bytes);
            match kind {
                FieldKind::Checkbox => Some(FieldValue::Bool(name != "Off")),
                FieldKind::Radio | FieldKind::Choice => Some(FieldValue::Choice(name)),
                _ => Some(FieldValue::Text(name)),
            }
        }
        _ => None,
    }
}

// ── Core depth-first walk ──────────────────────────────────────────────────────

/// Walk the AcroForm field tree depth-first, yielding one `WalkedField` per
/// terminal node (a node that has an effective /FT and no field-type children).
///
/// Attribute inheritance (/FT, /Ff, /DA, /V) flows from parent to child: each
/// level overlays its own values on top of what it received from its parent.
///
/// The walk is cycle-guarded via a seen-set and bounded to 64 levels of nesting.
fn walk_acroform_fields(doc: &Document) -> Vec<WalkedField> {
    let root_refs: Vec<ObjectId> = catalog_subdict(doc, b"AcroForm")
        .and_then(|acro| acro.get(b"Fields").ok())
        .and_then(|o| resolve_array(doc, o))
        .map(|arr| arr.iter().filter_map(|o| o.as_reference().ok()).collect())
        .unwrap_or_default();

    // Stack entries: (field_id, inherited_state, accumulated_name_parts, depth)
    let mut stack: Vec<(ObjectId, InheritedState, Vec<String>, usize)> = root_refs
        .into_iter()
        .map(|id| (id, InheritedState::default(), vec![], 0))
        .collect();

    let mut seen: BTreeSet<ObjectId> = BTreeSet::new();
    let mut results: Vec<WalkedField> = Vec::new();

    while let Some((field_id, inherited, mut name_parts, depth)) = stack.pop() {
        if !seen.insert(field_id) || depth > 64 {
            continue;
        }

        let dict = match doc.get_object(field_id).ok().and_then(|o| o.as_dict().ok()) {
            Some(d) => d.clone(),
            None => continue,
        };

        let effective = inherited.merged_with(&dict);

        // Accumulate /T for the qualified name.
        if let Ok(Object::String(bytes, _)) = dict.get(b"T") {
            name_parts.push(decode_pdf_string(bytes));
        }

        // Identify field-kids (children that carry /T — they are sub-fields).
        let all_kids: Vec<ObjectId> =
            match dict.get(b"Kids").ok().and_then(|o| resolve_array(doc, o)) {
                Some(arr) => arr.iter().filter_map(|o| o.as_reference().ok()).collect(),
                None => vec![],
            };

        let field_kids: Vec<ObjectId> = all_kids
            .iter()
            .copied()
            .filter(|&kid_id| {
                doc.get_object(kid_id)
                    .ok()
                    .and_then(|o| o.as_dict().ok())
                    .map(|d| d.has(b"T"))
                    .unwrap_or(false)
            })
            .collect();

        let is_terminal = effective.field_type.is_some() && field_kids.is_empty();

        if is_terminal {
            let ft = effective.field_type.as_deref().unwrap_or(b"");
            let flags = effective.flags.unwrap_or(0);
            let kind = kind_from_type_and_flags(ft, flags);
            let da_size = effective
                .default_appearance
                .as_deref()
                .map(parse_da_font_size)
                .unwrap_or(0.0);
            // Alignment is inherited like the other field attributes: a group that centres
            // its fields says so once, on the parent.
            let quadding = effective.quadding.unwrap_or(0);
            let widgets = collect_widget_ids(doc, field_id, &dict);

            results.push(WalkedField {
                id: field_id,
                name: name_parts.join("."),
                kind,
                da_size,
                quadding,
                widgets,
                effective_flags: flags,
                effective_value: effective.value,
            });
        } else {
            // Push field-kids for further traversal.
            for kid_id in field_kids {
                if !seen.contains(&kid_id) {
                    stack.push((kid_id, effective.clone(), name_parts.clone(), depth + 1));
                }
            }
        }
    }

    results
}

// ── pub(crate) helper consumed by fill ────────────────────────────────────────

/// Enumerate terminal fields in `doc`'s AcroForm tree.
/// Returns an empty vec when there is no AcroForm.
// Consumed by fill: builds the name-to-field index used to locate and update
// each field's /V, /AS, and /AP entries.
pub(crate) fn terminal_fields(doc: &Document) -> Vec<TerminalField> {
    walk_acroform_fields(doc)
        .into_iter()
        .map(|w| TerminalField {
            id: w.id,
            name: w.name,
            kind: w.kind,
            da_size: w.da_size,
            quadding: w.quadding,
            multiline: w.kind == FieldKind::Text && w.effective_flags & MULTILINE_FLAG != 0,
            widgets: w.widgets,
        })
        .collect()
}

// ── Public entry point ─────────────────────────────────────────────────────────

/// Read all interactive AcroForm fields from a PDF document.
///
/// Returns an empty vec (not an error) when the document carries no AcroForm.
/// Returns `FormError::Parse` when the bytes are not a valid PDF.
pub fn read_form(bytes: &[u8]) -> Result<Vec<FormField>, FormError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| FormError::Rejected)?;
    let doc = Document::load_mem(bytes).map_err(|e| FormError::Parse(e.to_string()))?;
    if crate::guard::is_locked(&doc) {
        return Err(FormError::Encrypted);
    }

    if catalog_subdict(&doc, b"AcroForm").is_none() {
        return Ok(vec![]);
    }

    let walked = walk_acroform_fields(&doc);
    let mut fields = Vec::with_capacity(walked.len());

    for w in walked {
        let read_only = w.effective_flags & 0x1 != 0;
        let required = w.effective_flags & 0x2 != 0;

        let value = w
            .effective_value
            .as_ref()
            .and_then(|v| decode_field_value(v, w.kind));

        // /Opt for Choice; on-state keys from widget /AP /N for Radio.
        let options = match w.kind {
            FieldKind::Choice => {
                let dict = doc
                    .get_object(w.id)
                    .ok()
                    .and_then(|o| o.as_dict().ok())
                    .cloned()
                    .unwrap_or_default();
                choice_options(&doc, &dict)
            }
            FieldKind::Radio => radio_options(&doc, &w.widgets),
            _ => vec![],
        };

        let (page, rect) = w
            .widgets
            .first()
            .map(|&widget_id| widget_page_and_rect(&doc, widget_id))
            .unwrap_or((None, None));

        fields.push(FormField {
            name: w.name,
            kind: w.kind,
            read_only,
            required,
            value,
            options,
            page,
            rect,
            widgets: w.widgets,
        });
    }

    Ok(fields)
}
