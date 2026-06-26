//! AcroForm field enumeration and appearance generation.
//!
//! Reads interactive form fields from a PDF, resolving the attribute-inheritance
//! rules defined in the PDF specification (/FT, /Ff, /DA, /V cascade from
//! parent field nodes to their terminal descendants).
//!
//! This module handles read and appearance generation. Fill and flatten are
//! separate operations built on top of this enumeration.

use std::collections::{BTreeMap, BTreeSet};

use lopdf::{dictionary, Document, Object, ObjectId, Stream};

use crate::scrub::catalog_subdict;
use crate::standard_fonts_data::{HELVETICA, WIN_ANSI_ENCODING};
use crate::surgery::resolve_dict;

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
    /// The bytes could not be parsed as a valid PDF.
    Parse(String),
    /// The modified document could not be serialised.
    Reassemble(String),
    /// No AcroForm is present; only returned by fill/flatten, not read.
    NoAcroForm,
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
    let kids: Vec<Object> = match dict.get(b"Kids").ok() {
        Some(Object::Array(a)) => a.clone(),
        _ => return vec![],
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
        .and_then(|o| o.as_array().ok())
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
        let all_kids: Vec<ObjectId> = match dict.get(b"Kids").ok() {
            Some(Object::Array(arr)) => arr.iter().filter_map(|o| o.as_reference().ok()).collect(),
            _ => vec![],
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
            let quadding = dict
                .get(b"Q")
                .ok()
                .and_then(|o| match o {
                    Object::Integer(n) => Some(*n),
                    Object::Real(r) => Some(*r as i64),
                    _ => None,
                })
                .unwrap_or(0);
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
            widgets: w.widgets,
        })
        .collect()
}

// ── Helvetica glyph-width measurement ─────────────────────────────────────────

/// Advance width in glyph-space units (1000 = 1 em) for `ch` in Helvetica via
/// the WinAnsi code-to-glyph-name mapping.
///
/// Returns 0.0 for code-points ≥ 256, slots with no glyph name assigned, and
/// glyph names absent from the Helvetica metrics table.
fn helvetica_advance(ch: char) -> f32 {
    let code = ch as u32;
    if code >= 256 {
        return 0.0;
    }
    let name = WIN_ANSI_ENCODING[code as usize];
    if name.is_empty() {
        return 0.0;
    }
    // HELVETICA is sorted by glyph name; binary search is correct and O(log n).
    match HELVETICA.binary_search_by_key(&name, |&(n, _)| n) {
        Ok(index) => HELVETICA[index].1 as f32,
        Err(_) => 0.0,
    }
}

/// Width in points of `text` rendered in Helvetica at `size_pt`.
///
/// Each character is looked up via the WinAnsi encoding. Characters outside the
/// WinAnsi range or absent from the metrics table contribute 0.0.
pub(crate) fn helvetica_text_width(text: &str, size_pt: f32) -> f32 {
    let glyph_units: f32 = text.chars().map(helvetica_advance).sum();
    (glyph_units / 1000.0) * size_pt
}

// ── Appearance stream generation ───────────────────────────────────────────────

/// Build a Form XObject appearance stream for a text field.
///
/// The returned `ObjectId` references a `/Type /XObject /Subtype /Form` stream
/// whose content paints `value` horizontally aligned per `quadding`:
/// 0 = left, 1 = centre, 2 = right.
///
/// `da_size` is the font size from the field's `/DA` entry; pass `0.0` to let
/// the function derive the size from the widget height (clamped to [6, 12] pt).
/// `font_id` must be the `ObjectId` of a Type 1 font object already added to
/// `doc` — the caller creates this once per document and passes it here so all
/// appearance streams can share it.
pub(crate) fn text_appearance(
    doc: &mut Document,
    rect: [f32; 4],
    da_size: f32,
    quadding: i64,
    font_id: ObjectId,
    value: &str,
) -> ObjectId {
    let w = rect[2] - rect[0];
    let h = rect[3] - rect[1];
    let size = if da_size > 0.0 {
        da_size
    } else {
        (h * 0.6).clamp(6.0, 12.0)
    };

    let text_width = helvetica_text_width(value, size);

    let tx: f32 = match quadding {
        0 => 2.0,
        1 => ((w - text_width) / 2.0).max(2.0),
        2 => (w - text_width - 2.0).max(2.0),
        _ => 2.0,
    };
    let ty = ((h - size) / 2.0 + size * 0.2).max(2.0);

    let escaped = crate::bates::escape_pdf_literal(value);
    let content = format!(
        "/Tx BMC q BT /MagnaCartaFormFont {size:.2} Tf 0 g {tx:.2} {ty:.2} Td ({escaped}) Tj ET Q EMC"
    );

    let font_resources = dictionary! {
        "MagnaCartaFormFont" => Object::Reference(font_id),
    };
    let resources = dictionary! {
        "Font" => Object::Dictionary(font_resources),
    };
    let stream_dict = dictionary! {
        "Type" => Object::Name(b"XObject".to_vec()),
        "Subtype" => Object::Name(b"Form".to_vec()),
        "FormType" => Object::Integer(1),
        "BBox" => Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(w),
            Object::Real(h),
        ]),
        "Resources" => Object::Dictionary(resources),
    };
    let stream = Stream::new(stream_dict, content.into_bytes());
    doc.add_object(Object::Stream(stream))
}

// ── Public entry point ─────────────────────────────────────────────────────────

/// Read all interactive AcroForm fields from a PDF document.
///
/// Returns an empty vec (not an error) when the document carries no AcroForm.
/// Returns `FormError::Parse` when the bytes are not a valid PDF.
pub fn read_form(bytes: &[u8]) -> Result<Vec<FormField>, FormError> {
    let doc = Document::load_mem(bytes).map_err(|e| FormError::Parse(e.to_string()))?;

    if catalog_subdict(&doc, b"AcroForm").is_none() {
        return Ok(vec![]);
    }

    let walked = walk_acroform_fields(&doc);
    let mut fields = Vec::with_capacity(walked.len());

    for w in walked {
        let read_only = w.effective_flags & 0x1 != 0;

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
            value,
            options,
            page,
            rect,
            widgets: w.widgets,
        });
    }

    Ok(fields)
}

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
/// Returns `FormError::NoAcroForm` when the document has no AcroForm.
pub fn fill_form(
    bytes: &[u8],
    values: &BTreeMap<String, FieldValue>,
    _opts: &FormFillOptions,
) -> Result<Vec<u8>, FormError> {
    let mut doc = Document::load_mem(bytes).map_err(|e| FormError::Parse(e.to_string()))?;

    if catalog_subdict(&doc, b"AcroForm").is_none() {
        return Err(FormError::NoAcroForm);
    }

    // Add one shared Helvetica font object for text-field appearance streams.
    let font_id = doc.add_object(Object::Dictionary(dictionary! {
        "Type" => Object::Name(b"Font".to_vec()),
        "Subtype" => Object::Name(b"Type1".to_vec()),
        "BaseFont" => Object::Name(b"Helvetica".to_vec()),
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
                        dict.set(b"V", Object::string_literal(text));
                    }
                }
                // Generate an appearance stream for each widget.
                for widget_id in &widget_ids {
                    let rect = match get_widget_rect(&doc, *widget_id) {
                        Some(r) => r,
                        None => continue,
                    };
                    let appearance_id =
                        text_appearance(&mut doc, rect, da_size, quadding, font_id, text);
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
    {
        let acroform_id: Option<ObjectId> = (|| -> Option<ObjectId> {
            let root_obj = doc.trailer.get(b"Root").ok()?;
            let catalog_id = root_obj.as_reference().ok()?;
            let catalog = doc.get_object(catalog_id).ok()?.as_dict().ok()?;
            catalog.get(b"AcroForm").ok()?.as_reference().ok()
        })();
        if let Some(acro_id) = acroform_id {
            if let Ok(obj) = doc.get_object_mut(acro_id) {
                if let Ok(dict) = obj.as_dict_mut() {
                    dict.set(b"NeedAppearances", Object::Boolean(false));
                }
            }
        }
    }

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|e| FormError::Reassemble(e.to_string()))?;
    Ok(output)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Dictionary, Document, Object};

    // ── Test helpers ──────────────────────────────────────────────────────────

    /// Minimal document: catalog + pages tree + one page.
    fn base_doc() -> (Document, ObjectId) {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let catalog_id = doc.add_object(Object::Dictionary(dictionary! {
            "Type" => "Catalog",
            "Pages" => Object::Reference(pages_id),
        }));
        doc.trailer.set("Root", Object::Reference(catalog_id));
        let page_id = doc.new_object_id();
        let pages = dictionary! {
            "Type" => "Pages",
            "Kids" => vec![Object::Reference(page_id)],
            "Count" => 1i64,
        };
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let page = dictionary! {
            "Type" => "Page",
            "Parent" => Object::Reference(pages_id),
            "MediaBox" => vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(612), Object::Integer(792),
            ],
        };
        doc.objects.insert(page_id, Object::Dictionary(page));
        (doc, page_id)
    }

    /// Serialise a `Document` to bytes.
    fn to_bytes(doc: &mut Document) -> Vec<u8> {
        let mut out = Vec::new();
        doc.save_to(&mut out).expect("serialise");
        out
    }

    /// Add a field dict to the page /Annots and return its object ID.
    fn add_annot(doc: &mut Document, page_id: ObjectId, field: Dictionary) -> ObjectId {
        let field_id = doc.add_object(Object::Dictionary(field));
        let page = doc.get_object_mut(page_id).unwrap().as_dict_mut().unwrap();
        let annots = match page.get(b"Annots").ok().cloned() {
            Some(Object::Array(mut a)) => {
                a.push(Object::Reference(field_id));
                a
            }
            _ => vec![Object::Reference(field_id)],
        };
        page.set("Annots", Object::Array(annots));
        field_id
    }

    /// Wire an AcroForm pointing to `field_ids` into the catalog.
    fn add_acroform(doc: &mut Document, field_ids: &[ObjectId]) {
        let fields: Vec<Object> = field_ids.iter().map(|&id| Object::Reference(id)).collect();
        let acro = dictionary! {
            "Fields" => Object::Array(fields),
        };
        let acro_id = doc.add_object(Object::Dictionary(acro));
        doc.catalog_mut()
            .unwrap()
            .set("AcroForm", Object::Reference(acro_id));
    }

    /// Standard /Rect array for a small field in the upper-left of the page.
    fn rect_obj() -> Object {
        Object::Array(vec![
            Object::Integer(50),
            Object::Integer(700),
            Object::Integer(200),
            Object::Integer(720),
        ])
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    #[test]
    fn empty_pdf_returns_empty_vec() {
        let (mut doc, _page_id) = base_doc();
        let bytes = to_bytes(&mut doc);
        let fields = read_form(&bytes).expect("read_form");
        assert!(fields.is_empty());
    }

    #[test]
    fn single_text_field() {
        let (mut doc, page_id) = base_doc();
        let field = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Tx",
            "T" => Object::string_literal("FirstName"),
            "V" => Object::string_literal("Alice"),
            "Rect" => rect_obj(),
        };
        let fid = add_annot(&mut doc, page_id, field);
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        let f = &fields[0];
        assert_eq!(f.name, "FirstName");
        assert_eq!(f.kind, FieldKind::Text);
        assert!(!f.read_only);
        assert_eq!(f.value, Some(FieldValue::Text("Alice".into())));
    }

    #[test]
    fn checkbox_field_checked() {
        let (mut doc, page_id) = base_doc();
        let field = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Btn",
            "T" => Object::string_literal("Agree"),
            "Ff" => Object::Integer(0),
            "V" => Object::Name(b"Yes".to_vec()),
            "Rect" => rect_obj(),
        };
        let fid = add_annot(&mut doc, page_id, field);
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        let f = &fields[0];
        assert_eq!(f.kind, FieldKind::Checkbox);
        assert_eq!(f.value, Some(FieldValue::Bool(true)));
    }

    #[test]
    fn checkbox_field_unchecked() {
        let (mut doc, page_id) = base_doc();
        let field = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Btn",
            "T" => Object::string_literal("Accept"),
            "Ff" => Object::Integer(0),
            "V" => Object::Name(b"Off".to_vec()),
            "Rect" => rect_obj(),
        };
        let fid = add_annot(&mut doc, page_id, field);
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].kind, FieldKind::Checkbox);
        assert_eq!(fields[0].value, Some(FieldValue::Bool(false)));
    }

    #[test]
    fn radio_group() {
        let (mut doc, page_id) = base_doc();

        // Build two widget kids with /AP /N dicts.
        let ap_n_a_id = doc.add_object(Object::Dictionary(dictionary! {
            "A" => Object::Null,
            "Off" => Object::Null,
        }));
        let ap_a_id = doc.add_object(Object::Dictionary(dictionary! {
            "N" => Object::Reference(ap_n_a_id),
        }));
        let widget_a = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "AP" => Object::Reference(ap_a_id),
            "Rect" => rect_obj(),
        };
        let widget_a_id = add_annot(&mut doc, page_id, widget_a);

        let ap_n_b_id = doc.add_object(Object::Dictionary(dictionary! {
            "B" => Object::Null,
            "Off" => Object::Null,
        }));
        let ap_b_id = doc.add_object(Object::Dictionary(dictionary! {
            "N" => Object::Reference(ap_n_b_id),
        }));
        let widget_b = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "AP" => Object::Reference(ap_b_id),
            "Rect" => Object::Array(vec![
                Object::Integer(50), Object::Integer(660),
                Object::Integer(200), Object::Integer(680),
            ]),
        };
        let widget_b_id = add_annot(&mut doc, page_id, widget_b);

        // Radio group field: /Btn with bit 16, kids = the two widgets.
        let radio_flags: i64 = 0x8000;
        let field = dictionary! {
            "FT" => "Btn",
            "T" => Object::string_literal("Color"),
            "Ff" => Object::Integer(radio_flags),
            "Kids" => vec![
                Object::Reference(widget_a_id),
                Object::Reference(widget_b_id),
            ],
        };
        let fid = doc.add_object(Object::Dictionary(field));
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        let f = &fields[0];
        assert_eq!(f.kind, FieldKind::Radio);
        // Options should contain "A" and "B" but not "Off".
        assert!(f.options.contains(&"A".to_string()));
        assert!(f.options.contains(&"B".to_string()));
        assert!(!f.options.contains(&"Off".to_string()));
    }

    #[test]
    fn pushbutton_field() {
        let (mut doc, page_id) = base_doc();
        let pushbutton_flags: i64 = 0x10000;
        let field = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Btn",
            "T" => Object::string_literal("Submit"),
            "Ff" => Object::Integer(pushbutton_flags),
            "Rect" => rect_obj(),
        };
        let fid = add_annot(&mut doc, page_id, field);
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].kind, FieldKind::PushButton);
    }

    #[test]
    fn choice_field_with_options() {
        let (mut doc, page_id) = base_doc();
        // /Opt with [export, display] pairs.
        let opts = vec![
            Object::Array(vec![
                Object::string_literal("us"),
                Object::string_literal("United States"),
            ]),
            Object::Array(vec![
                Object::string_literal("ca"),
                Object::string_literal("Canada"),
            ]),
        ];
        let field = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Ch",
            "T" => Object::string_literal("Country"),
            "Opt" => Object::Array(opts),
            "Rect" => rect_obj(),
        };
        let fid = add_annot(&mut doc, page_id, field);
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        let f = &fields[0];
        assert_eq!(f.kind, FieldKind::Choice);
        assert_eq!(f.options, vec!["United States", "Canada"]);
    }

    #[test]
    fn inherited_ft_from_parent() {
        let (mut doc, page_id) = base_doc();

        // Child field: has /T but no /FT — should inherit /FT Tx from parent.
        let child = dictionary! {
            "T" => Object::string_literal("Child"),
            "Rect" => rect_obj(),
        };
        let child_id = add_annot(&mut doc, page_id, child);

        // Parent field: has /FT but no /T itself (it acts only as an inheritance node).
        let parent = dictionary! {
            "FT" => "Tx",
            "T" => Object::string_literal("Parent"),
            "Kids" => vec![Object::Reference(child_id)],
        };
        let parent_id = doc.add_object(Object::Dictionary(parent));
        add_acroform(&mut doc, &[parent_id]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        let f = &fields[0];
        assert_eq!(
            f.kind,
            FieldKind::Text,
            "child must inherit /FT Tx from parent"
        );
        assert_eq!(f.name, "Parent.Child");
    }

    #[test]
    fn inherited_v_from_parent() {
        let (mut doc, page_id) = base_doc();

        let child = dictionary! {
            "T" => Object::string_literal("Child"),
            "FT" => "Tx",
            "Rect" => rect_obj(),
        };
        let child_id = add_annot(&mut doc, page_id, child);

        let parent = dictionary! {
            "T" => Object::string_literal("Parent"),
            "V" => Object::string_literal("inherited value"),
            "Kids" => vec![Object::Reference(child_id)],
        };
        let parent_id = doc.add_object(Object::Dictionary(parent));
        add_acroform(&mut doc, &[parent_id]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        assert_eq!(
            fields[0].value,
            Some(FieldValue::Text("inherited value".into()))
        );
    }

    #[test]
    fn read_only_field() {
        let (mut doc, page_id) = base_doc();
        // /Ff bit 1 (0x1) = ReadOnly.
        let field = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Tx",
            "T" => Object::string_literal("ReadMe"),
            "Ff" => Object::Integer(1i64),
            "Rect" => rect_obj(),
        };
        let fid = add_annot(&mut doc, page_id, field);
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        assert!(fields[0].read_only);
    }

    #[test]
    fn utf16be_field_name() {
        let (mut doc, page_id) = base_doc();
        // UTF-16BE BOM + "Name" → [0xFE,0xFF, 0x00,0x4E, 0x00,0x61, 0x00,0x6D, 0x00,0x65]
        let utf16_name: Vec<u8> = [
            0xFE_u8, 0xFF, 0x00, 0x4E, 0x00, 0x61, 0x00, 0x6D, 0x00, 0x65,
        ]
        .to_vec();
        let field = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Tx",
            "T" => Object::String(utf16_name, lopdf::StringFormat::Literal),
            "Rect" => rect_obj(),
        };
        let fid = add_annot(&mut doc, page_id, field);
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, "Name");
    }

    #[test]
    fn hierarchy_name_dot_join() {
        let (mut doc, page_id) = base_doc();

        let child = dictionary! {
            "T" => Object::string_literal("Child"),
            "FT" => "Tx",
            "Rect" => rect_obj(),
        };
        let child_id = add_annot(&mut doc, page_id, child);

        let parent = dictionary! {
            "T" => Object::string_literal("Parent"),
            "FT" => "Tx",
            "Kids" => vec![Object::Reference(child_id)],
        };
        let parent_id = doc.add_object(Object::Dictionary(parent));
        add_acroform(&mut doc, &[parent_id]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, "Parent.Child");
    }

    #[test]
    fn widget_rect_and_page() {
        let (mut doc, page_id) = base_doc();
        let specific_rect = Object::Array(vec![
            Object::Integer(10),
            Object::Integer(20),
            Object::Integer(110),
            Object::Integer(40),
        ]);
        let field = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Tx",
            "T" => Object::string_literal("Location"),
            "Rect" => specific_rect,
        };
        let fid = add_annot(&mut doc, page_id, field);
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        let f = &fields[0];
        assert_eq!(f.page, Some(0), "should be on page 0 (0-based)");
        let rect = f.rect.expect("rect must be present");
        assert!((rect[0] - 10.0).abs() < 0.01);
        assert!((rect[1] - 20.0).abs() < 0.01);
        assert!((rect[2] - 110.0).abs() < 0.01);
        assert!((rect[3] - 40.0).abs() < 0.01);
    }

    #[test]
    fn multiple_widgets_per_field() {
        let (mut doc, page_id) = base_doc();

        // Two pure widget annotations (no /T, have /Subtype Widget and /Rect).
        let widget1 = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "Rect" => rect_obj(),
        };
        let w1_id = add_annot(&mut doc, page_id, widget1);

        let widget2 = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "Rect" => Object::Array(vec![
                Object::Integer(50), Object::Integer(650),
                Object::Integer(200), Object::Integer(670),
            ]),
        };
        let w2_id = add_annot(&mut doc, page_id, widget2);

        // Field references the two widgets as /Kids but has no /Rect itself.
        let field = dictionary! {
            "FT" => "Tx",
            "T" => Object::string_literal("MultiWidget"),
            "Kids" => vec![
                Object::Reference(w1_id),
                Object::Reference(w2_id),
            ],
        };
        let fid = doc.add_object(Object::Dictionary(field));
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1);
        let f = &fields[0];
        assert_eq!(f.widgets.len(), 2, "should have two widget IDs");
    }

    #[test]
    fn reads_field_when_annots_is_indirect_reference() {
        let (mut doc, page_id) = base_doc();

        // Build the widget annotation and register it directly (no page wiring yet).
        let widget = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Tx",
            "T" => Object::string_literal("IndirectAnnotsField"),
            "Rect" => rect_obj(),
        };
        let widget_id = doc.add_object(Object::Dictionary(widget));

        // Store /Annots as an Object::Reference to a separately-added array object,
        // exercising the indirect-deref branch in page_annotation_ids that the
        // inline-array tests do not reach.
        let annots_array_id = doc.add_object(Object::Array(vec![Object::Reference(widget_id)]));
        let page = doc.get_object_mut(page_id).unwrap().as_dict_mut().unwrap();
        page.set("Annots", Object::Reference(annots_array_id));

        add_acroform(&mut doc, &[widget_id]);
        let bytes = to_bytes(&mut doc);

        let fields = read_form(&bytes).expect("read_form");
        assert_eq!(fields.len(), 1, "one field expected");
        let field = &fields[0];
        assert_eq!(field.name, "IndirectAnnotsField");
        assert_eq!(
            field.page,
            Some(0),
            "field must be located on page 0 (0-based)"
        );
        assert!(
            field.rect.is_some(),
            "rect must be populated from widget /Rect"
        );
    }

    // ── Appearance generation tests ───────────────────────────────────────────

    /// Build a minimal font object and return its ObjectId.
    fn add_font(doc: &mut Document) -> ObjectId {
        doc.add_object(Object::Dictionary(dictionary! {
            "Type" => Object::Name(b"Font".to_vec()),
            "Subtype" => Object::Name(b"Type1".to_vec()),
            "BaseFont" => Object::Name(b"Helvetica".to_vec()),
        }))
    }

    #[test]
    fn appearance_has_value_and_font() {
        let mut doc = Document::with_version("1.5");
        let font_id = add_font(&mut doc);
        // rect: llx=0, lly=0, urx=100, ury=20  →  w=100, h=20
        let rect = [0.0_f32, 0.0, 100.0, 20.0];
        let xobj_id = text_appearance(&mut doc, rect, 10.0, 0, font_id, "Hello");

        let stream = match doc.get_object(xobj_id).expect("XObject must exist") {
            Object::Stream(s) => s,
            _ => panic!("expected a Stream object"),
        };

        // BBox must be [0 0 100 20].
        let bbox_arr = stream
            .dict
            .get(b"BBox")
            .expect("BBox")
            .as_array()
            .expect("BBox must be array");
        let bbox_nums: Vec<f32> = bbox_arr
            .iter()
            .map(|o| match o {
                Object::Real(r) => *r,
                Object::Integer(i) => *i as f32,
                _ => panic!("non-numeric BBox element"),
            })
            .collect();
        assert_eq!(bbox_nums.len(), 4);
        assert!((bbox_nums[0]).abs() < 0.01);
        assert!((bbox_nums[1]).abs() < 0.01);
        assert!(
            (bbox_nums[2] - 100.0).abs() < 0.01,
            "BBox width must be 100"
        );
        assert!((bbox_nums[3] - 20.0).abs() < 0.01, "BBox height must be 20");

        // Content must reference the font and paint the value.
        let content = std::str::from_utf8(&stream.content).expect("content must be UTF-8");
        assert!(
            content.contains("(Hello) Tj"),
            "content must contain (Hello) Tj; got: {content}"
        );
        assert!(
            content.contains("/MagnaCartaFormFont"),
            "content must reference /MagnaCartaFormFont; got: {content}"
        );
    }

    #[test]
    fn appearance_auto_sizes_when_da_zero() {
        let mut doc = Document::with_version("1.5");
        let font_id = add_font(&mut doc);
        // height = 20 → auto size = (20 × 0.6).clamp(6, 12) = 12.0
        let rect = [0.0_f32, 0.0, 100.0, 20.0];
        let xobj_id = text_appearance(&mut doc, rect, 0.0, 0, font_id, "Test");

        let stream = match doc.get_object(xobj_id).expect("XObject must exist") {
            Object::Stream(s) => s,
            _ => panic!("expected a Stream object"),
        };
        let content = std::str::from_utf8(&stream.content).expect("content must be UTF-8");

        // Extract the Tf size from the content stream.
        // Format: "... /MagnaCartaFormFont <size> Tf ..."
        let tf_pos = content.find("Tf").expect("content must have Tf operator");
        let before_tf = content[..tf_pos].trim_end();
        let size_str = before_tf
            .split_whitespace()
            .last()
            .expect("size token must precede Tf");
        let tf_size: f32 = size_str.parse().expect("size must be a float");

        assert!(
            (tf_size - 12.0).abs() < 0.01,
            "auto-fitted size for a 20-pt-tall rect must be ≈ 12.0; got {tf_size}"
        );
    }

    #[test]
    fn appearance_right_aligns() {
        let mut doc = Document::with_version("1.5");
        let font_id = add_font(&mut doc);
        let rect = [0.0_f32, 0.0, 100.0, 20.0];
        let xobj_id = text_appearance(&mut doc, rect, 10.0, 2, font_id, "Hello");

        let stream = match doc.get_object(xobj_id).expect("XObject must exist") {
            Object::Stream(s) => s,
            _ => panic!("expected a Stream object"),
        };
        let content = std::str::from_utf8(&stream.content).expect("content must be UTF-8");

        // Extract tx from "... <tx> <ty> Td ...".
        let td_pos = content.find("Td").expect("content must have Td operator");
        let before_td = content[..td_pos].trim_end();
        let tokens: Vec<&str> = before_td.split_whitespace().collect();
        // The last two tokens before Td are ty then tx... wait: "tx ty Td" so tx is second-to-last.
        let tx: f32 = tokens[tokens.len() - 2]
            .parse()
            .expect("tx must parse as float");

        // For right-alignment: tx ≈ w − measured_width − 2
        let expected_tx = (100.0_f32 - helvetica_text_width("Hello", 10.0) - 2.0).max(2.0);
        assert!(
            (tx - expected_tx).abs() < 0.1,
            "right-aligned tx should be ≈ {expected_tx:.2}, got {tx:.2}"
        );
        assert!(
            tx > 2.0,
            "right-aligned tx must be distinctly greater than the left-pad default 2.0"
        );
    }

    #[test]
    fn appearance_escapes_parens() {
        let mut doc = Document::with_version("1.5");
        let font_id = add_font(&mut doc);
        let rect = [0.0_f32, 0.0, 100.0, 20.0];
        let xobj_id = text_appearance(&mut doc, rect, 10.0, 0, font_id, "a(b)");

        let stream = match doc.get_object(xobj_id).expect("XObject must exist") {
            Object::Stream(s) => s,
            _ => panic!("expected a Stream object"),
        };
        let content = std::str::from_utf8(&stream.content).expect("content must be UTF-8");

        assert!(
            content.contains("a\\(b\\)"),
            "parentheses in value must be escaped; got: {content}"
        );
    }

    // ── Fill tests ────────────────────────────────────────────────────────────

    /// Follow a widget's /AP /N to its appearance stream and return its content
    /// as a string. Panics if the chain is missing or not a stream.
    fn ap_n_content(doc: &Document, widget_id: ObjectId) -> String {
        let widget = doc.get_object(widget_id).unwrap().as_dict().unwrap();
        let ap = resolve_dict(doc, widget.get(b"AP").unwrap()).expect("/AP dict");
        let n_id = ap.get(b"N").unwrap().as_reference().expect("/N reference");
        let stream = match doc.get_object(n_id).unwrap() {
            Object::Stream(s) => s,
            _ => panic!("/AP /N must be a stream"),
        };
        String::from_utf8(stream.content.clone()).expect("appearance content must be UTF-8")
    }

    #[test]
    fn fills_text_field_value_renders() {
        let (mut doc, page_id) = base_doc();
        let field = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Tx",
            "T" => Object::string_literal("FirstName"),
            "Rect" => rect_obj(),
        };
        let fid = add_annot(&mut doc, page_id, field);
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let mut values = std::collections::BTreeMap::new();
        values.insert("FirstName".to_string(), FieldValue::Text("Bob".into()));
        let out =
            fill_form(&bytes, &values, &FormFillOptions { flatten: false }).expect("fill_form");

        // /V is updated and a /AP /N appearance painting the value is generated.
        let filled = read_form(&out).expect("read_form");
        assert_eq!(filled.len(), 1);
        assert_eq!(filled[0].value, Some(FieldValue::Text("Bob".into())));

        // The field dict is its own widget (merged), so /AP lives on it.
        let doc2 = Document::load_mem(&out).expect("reload");
        let content = ap_n_content(&doc2, fid);
        assert!(
            content.contains("(Bob) Tj"),
            "generated appearance must paint the value; got: {content}"
        );
    }

    #[test]
    fn checks_checkbox_sets_state() {
        let (mut doc, page_id) = base_doc();
        // Checkbox widget carries an /AP /N with an on-state ("Yes") and "Off".
        let ap_n_id = doc.add_object(Object::Dictionary(dictionary! {
            "Yes" => Object::Null,
            "Off" => Object::Null,
        }));
        let ap_id = doc.add_object(Object::Dictionary(dictionary! {
            "N" => Object::Reference(ap_n_id),
        }));
        let field = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Btn",
            "T" => Object::string_literal("Agree"),
            "Ff" => Object::Integer(0),
            "AS" => Object::Name(b"Off".to_vec()),
            "AP" => Object::Reference(ap_id),
            "Rect" => rect_obj(),
        };
        let fid = add_annot(&mut doc, page_id, field);
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let mut values = std::collections::BTreeMap::new();
        values.insert("Agree".to_string(), FieldValue::Bool(true));
        let out =
            fill_form(&bytes, &values, &FormFillOptions { flatten: false }).expect("fill_form");

        // Both /V and the widget /AS must read the on-state name.
        let doc2 = Document::load_mem(&out).expect("reload");
        let dict = doc2.get_object(fid).unwrap().as_dict().unwrap();
        assert_eq!(dict.get(b"V").unwrap().as_name().unwrap(), b"Yes");
        assert_eq!(dict.get(b"AS").unwrap().as_name().unwrap(), b"Yes");
    }

    #[test]
    fn selects_radio_kid() {
        let (mut doc, page_id) = base_doc();

        let ap_n_a_id = doc.add_object(Object::Dictionary(dictionary! {
            "A" => Object::Null, "Off" => Object::Null,
        }));
        let ap_a_id = doc.add_object(Object::Dictionary(dictionary! {
            "N" => Object::Reference(ap_n_a_id),
        }));
        let widget_a_id = add_annot(
            &mut doc,
            page_id,
            dictionary! {
                "Type" => "Annot", "Subtype" => "Widget",
                "AP" => Object::Reference(ap_a_id),
                "AS" => Object::Name(b"Off".to_vec()),
                "Rect" => rect_obj(),
            },
        );

        let ap_n_b_id = doc.add_object(Object::Dictionary(dictionary! {
            "B" => Object::Null, "Off" => Object::Null,
        }));
        let ap_b_id = doc.add_object(Object::Dictionary(dictionary! {
            "N" => Object::Reference(ap_n_b_id),
        }));
        let widget_b_id = add_annot(
            &mut doc,
            page_id,
            dictionary! {
                "Type" => "Annot", "Subtype" => "Widget",
                "AP" => Object::Reference(ap_b_id),
                "AS" => Object::Name(b"Off".to_vec()),
                "Rect" => Object::Array(vec![
                    Object::Integer(50), Object::Integer(660),
                    Object::Integer(200), Object::Integer(680),
                ]),
            },
        );

        let field = dictionary! {
            "FT" => "Btn",
            "T" => Object::string_literal("Color"),
            "Ff" => Object::Integer(0x8000),
            "Kids" => vec![
                Object::Reference(widget_a_id),
                Object::Reference(widget_b_id),
            ],
        };
        let fid = doc.add_object(Object::Dictionary(field));
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let mut values = std::collections::BTreeMap::new();
        values.insert("Color".to_string(), FieldValue::Choice("A".into()));
        let out =
            fill_form(&bytes, &values, &FormFillOptions { flatten: false }).expect("fill_form");

        let doc2 = Document::load_mem(&out).expect("reload");
        // Field /V is the chosen state; the matching kid is selected, the other Off.
        let field_dict = doc2.get_object(fid).unwrap().as_dict().unwrap();
        assert_eq!(field_dict.get(b"V").unwrap().as_name().unwrap(), b"A");
        let a_dict = doc2.get_object(widget_a_id).unwrap().as_dict().unwrap();
        assert_eq!(a_dict.get(b"AS").unwrap().as_name().unwrap(), b"A");
        let b_dict = doc2.get_object(widget_b_id).unwrap().as_dict().unwrap();
        assert_eq!(b_dict.get(b"AS").unwrap().as_name().unwrap(), b"Off");
    }

    #[test]
    fn unknown_field_name_is_noop() {
        let (mut doc, page_id) = base_doc();
        let field = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Tx",
            "T" => Object::string_literal("FirstName"),
            "V" => Object::string_literal("Alice"),
            "Rect" => rect_obj(),
        };
        let fid = add_annot(&mut doc, page_id, field);
        add_acroform(&mut doc, &[fid]);
        let bytes = to_bytes(&mut doc);

        let mut values = std::collections::BTreeMap::new();
        values.insert("DoesNotExist".to_string(), FieldValue::Text("x".into()));
        let out =
            fill_form(&bytes, &values, &FormFillOptions { flatten: false }).expect("fill_form");

        // The existing field is untouched and no spurious appearance is added.
        let filled = read_form(&out).expect("read_form");
        assert_eq!(filled.len(), 1);
        assert_eq!(filled[0].name, "FirstName");
        assert_eq!(filled[0].value, Some(FieldValue::Text("Alice".into())));
        let doc2 = Document::load_mem(&out).expect("reload");
        let dict = doc2.get_object(fid).unwrap().as_dict().unwrap();
        assert!(
            dict.get(b"AP").is_err(),
            "no appearance should be generated"
        );
    }
}
