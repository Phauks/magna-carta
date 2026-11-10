//! Tests for reading, filling and flattening forms, on documents built in memory and on a
//! real government form.

use super::appearance::*;
use super::*;
use lopdf::{dictionary, Dictionary, Document, Object, Stream};

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
    assert!(!fields[0].required);
}

#[test]
fn required_flag_is_read_and_inherited() {
    let (mut doc, page_id) = base_doc();
    // /Ff bit 2 (0x2) = Required, declared on a PARENT field node so the terminal
    // descendant has to inherit it — the flag cascade is the part worth asserting.
    let kid = dictionary! {
        "Type" => "Annot",
        "Subtype" => "Widget",
        "T" => Object::string_literal("Line1"),
        "Rect" => rect_obj(),
    };
    let kid_id = add_annot(&mut doc, page_id, kid);
    let parent = dictionary! {
        "FT" => "Tx",
        "T" => Object::string_literal("Address"),
        "Ff" => Object::Integer(2i64),
        "Kids" => Object::Array(vec![Object::Reference(kid_id)]),
    };
    let parent_id = doc.add_object(Object::Dictionary(parent));
    add_acroform(&mut doc, &[parent_id]);
    let bytes = to_bytes(&mut doc);

    let fields = read_form(&bytes).expect("read_form");
    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].name, "Address.Line1");
    assert!(fields[0].required);
    assert!(!fields[0].read_only);
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
fn appearance_draws_accents_in_the_fonts_encoding() {
    // One byte per character through WinAnsiEncoding: "é" is 0xE9, not its two UTF-8
    // bytes, which a viewer draws as "Ã©". A character outside the encoding is "?".
    let mut doc = Document::with_version("1.7");
    let font_id = doc.add_object(Object::Dictionary(Dictionary::new()));
    let id = text_appearance(
        &mut doc,
        [0.0, 0.0, 200.0, 20.0],
        10.0,
        0,
        font_id,
        "José 山",
    );
    let stream = doc.get_object(id).unwrap().as_stream().unwrap();
    let content = &stream.content;
    assert!(content.windows(5).any(|w| w == b"(Jos\xe9"), "{content:?}");
    assert!(content.windows(3).any(|w| w == b" ?)"), "{content:?}");
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

fn text_field(name: &str, rect: [i64; 4], flags: i64) -> Dictionary {
    dictionary! {
        "Type" => "Annot",
        "Subtype" => "Widget",
        "FT" => "Tx",
        "Ff" => Object::Integer(flags),
        "T" => Object::string_literal(name),
        "Rect" => Object::Array(rect.iter().map(|value| Object::Integer(*value)).collect()),
    }
}

fn fill_one(field: Dictionary, name: &str, value: &str) -> (Vec<u8>, ObjectId) {
    let (mut doc, page_id) = base_doc();
    let fid = add_annot(&mut doc, page_id, field);
    add_acroform(&mut doc, &[fid]);
    let bytes = to_bytes(&mut doc);
    let mut values = std::collections::BTreeMap::new();
    values.insert(name.to_string(), FieldValue::Text(value.into()));
    let out = fill_form(&bytes, &values, &FormFillOptions { flatten: false }).expect("fill_form");
    (out, fid)
}

#[test]
fn a_multiline_field_wraps_its_value_and_starts_at_the_top() {
    let value = "The tenant reports water damage in the north bedroom.\nSecond paragraph.";
    let (out, fid) = fill_one(
        text_field("Notes", [50, 600, 200, 700], MULTILINE_FLAG),
        "Notes",
        value,
    );
    let doc = Document::load_mem(&out).expect("reload");
    let content = ap_n_content(&doc, fid);
    let shown: Vec<&str> = content
        .lines()
        .filter(|line| line.ends_with(") Tj"))
        .collect();
    assert!(
        shown.len() >= 4,
        "the value must wrap onto several lines: {content}"
    );
    // Every word is drawn once, in order, and no line runs past the box.
    let drawn: Vec<String> = shown
        .iter()
        .map(|line| {
            let start = line.find('(').unwrap() + 1;
            line[start..line.len() - ") Tj".len()].to_string()
        })
        .collect();
    assert_eq!(
        drawn.join(" "),
        value.replace('\n', " "),
        "wrapping must lose and repeat nothing"
    );
    for line in &drawn {
        assert!(
            helvetica_text_width(line, 12.0) <= 146.0,
            "line too wide: {line}"
        );
    }
    // The first line sits near the top of the 100-point box and each one after is lower.
    let baselines: Vec<f32> = shown
        .iter()
        .map(|line| line.split(' ').nth(5).unwrap().parse().unwrap())
        .collect();
    assert!(baselines[0] > 80.0, "first baseline {}", baselines[0]);
    assert!(baselines.windows(2).all(|pair| pair[1] < pair[0]));
    // The stored value keeps its line break.
    let filled = read_form(&out).expect("read_form");
    assert_eq!(filled[0].value, Some(FieldValue::Text(value.into())));
}

#[test]
fn a_multiline_field_that_sizes_its_own_text_shrinks_it_to_fit() {
    let value = "word ".repeat(60);
    let (out, fid) = fill_one(
        text_field("Notes", [50, 600, 200, 660], MULTILINE_FLAG),
        "Notes",
        value.trim(),
    );
    let doc = Document::load_mem(&out).expect("reload");
    let content = ap_n_content(&doc, fid);
    let size: f32 = content
        .split(" Tf")
        .next()
        .and_then(|head| head.rsplit(' ').next())
        .unwrap()
        .parse()
        .unwrap();
    assert!(
        (MINIMUM_AUTOMATIC_SIZE..12.0).contains(&size),
        "size {size}"
    );
    let lines = content
        .lines()
        .filter(|line| line.ends_with(") Tj"))
        .count();
    assert!(
        4.0 + lines as f32 * size * LINE_SPACING <= 60.0,
        "{lines} lines at {size} points must fit a 60-point box"
    );
}

#[test]
fn a_word_wider_than_the_box_is_broken_instead_of_lost() {
    let lines = wrap_lines("Donaudampfschifffahrtsgesellschaft", 12.0, 60.0);
    assert!(lines.len() > 1);
    assert_eq!(lines.concat(), "Donaudampfschifffahrtsgesellschaft");
    assert!(lines
        .iter()
        .all(|line| helvetica_text_width(line, 12.0) <= 60.0));
}

#[test]
fn a_single_line_field_that_sizes_its_own_text_shrinks_a_long_value_to_its_width() {
    let value = "A considerably longer answer than this box was drawn for";
    let (out, fid) = fill_one(text_field("Name", [50, 700, 200, 720], 0), "Name", value);
    let doc = Document::load_mem(&out).expect("reload");
    let content = ap_n_content(&doc, fid);
    let size: f32 = content
        .split(" Tf")
        .next()
        .and_then(|head| head.rsplit(' ').next())
        .unwrap()
        .parse()
        .unwrap();
    assert!(size < 12.0, "size {size}");
    assert!(helvetica_text_width(value, size) <= 146.1);
}

#[test]
fn an_accented_value_is_stored_as_a_text_string_and_reads_back() {
    let (out, fid) = fill_one(
        text_field("Name", [50, 700, 200, 720], 0),
        "Name",
        "José Ünal",
    );
    let doc = Document::load_mem(&out).expect("reload");
    let stored = doc
        .get_object(fid)
        .unwrap()
        .as_dict()
        .unwrap()
        .get(b"V")
        .unwrap();
    let Object::String(bytes, _) = stored else {
        panic!("/V must be a string");
    };
    assert!(
        bytes.starts_with(&[0xFE, 0xFF]),
        "UTF-16 with its byte-order mark"
    );
    let filled = read_form(&out).expect("read_form");
    assert_eq!(filled[0].value, Some(FieldValue::Text("José Ünal".into())));
}

#[test]
fn alignment_is_inherited_from_the_parent_field() {
    let (mut doc, page_id) = base_doc();
    let kid = add_annot(
        &mut doc,
        page_id,
        text_field("Amount", [50, 700, 200, 720], 0),
    );
    let parent = doc.add_object(Object::Dictionary(dictionary! {
        "T" => Object::string_literal("Totals"),
        "Q" => Object::Integer(2),
        "Kids" => Object::Array(vec![Object::Reference(kid)]),
    }));
    doc.get_object_mut(kid)
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .set("Parent", Object::Reference(parent));
    add_acroform(&mut doc, &[parent]);
    let fields = terminal_fields(&doc);
    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].name, "Totals.Amount");
    assert_eq!(fields[0].quadding, 2);
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
    let out = fill_form(&bytes, &values, &FormFillOptions { flatten: false }).expect("fill_form");

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
    let out = fill_form(&bytes, &values, &FormFillOptions { flatten: false }).expect("fill_form");

    // Both /V and the widget /AS must read the on-state name.
    let doc2 = Document::load_mem(&out).expect("reload");
    let dict = doc2.get_object(fid).unwrap().as_dict().unwrap();
    assert_eq!(dict.get(b"V").unwrap().as_name().unwrap(), b"Yes");
    assert_eq!(dict.get(b"AS").unwrap().as_name().unwrap(), b"Yes");
}

#[test]
fn a_sanitized_template_still_ticks_its_checkbox_and_lists_its_radio_options() {
    let (mut doc, page_id) = base_doc();
    // The on-state is deliberately not "Yes": after a sanitize that removed the
    // appearance, fill would guess "Yes" and write a state the widget does not have.
    let ap_n_id = doc.add_object(Object::Dictionary(dictionary! {
        "Agree" => Object::Null,
        "Off" => Object::Null,
    }));
    let checkbox = dictionary! {
        "Type" => "Annot",
        "Subtype" => "Widget",
        "FT" => "Btn",
        "T" => Object::string_literal("Consent"),
        "Ff" => Object::Integer(0),
        "V" => Object::Name(b"Agree".to_vec()),
        "AS" => Object::Name(b"Agree".to_vec()),
        "AP" => dictionary! { "N" => Object::Reference(ap_n_id) },
        "Rect" => rect_obj(),
    };
    let checkbox_id = add_annot(&mut doc, page_id, checkbox);
    let radio_n_id = doc.add_object(Object::Dictionary(dictionary! {
        "Plaintiff" => Object::Null,
        "Off" => Object::Null,
    }));
    let radio_widget_id = add_annot(
        &mut doc,
        page_id,
        dictionary! {
            "Type" => "Annot", "Subtype" => "Widget",
            "AP" => dictionary! { "N" => Object::Reference(radio_n_id) },
            "AS" => Object::Name(b"Plaintiff".to_vec()),
            "Rect" => rect_obj(),
        },
    );
    let radio_id = doc.add_object(Object::Dictionary(dictionary! {
        "FT" => "Btn",
        "T" => Object::string_literal("Party"),
        "Ff" => Object::Integer(0x8000),
        "V" => Object::Name(b"Plaintiff".to_vec()),
        "Kids" => vec![Object::Reference(radio_widget_id)],
    }));
    doc.get_object_mut(radio_widget_id)
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .set("Parent", Object::Reference(radio_id));
    add_acroform(&mut doc, &[checkbox_id, radio_id]);
    let bytes = to_bytes(&mut doc);

    let sanitized =
        crate::scrub::sanitize(bytes, &crate::scrub::ScrubOptions::default()).expect("sanitize");

    // The template comes back blank, with the radio group's options intact.
    let fields = read_form(&sanitized).expect("read_form");
    let party = fields.iter().find(|f| f.name == "Party").expect("Party");
    assert_eq!(party.options, vec!["Plaintiff".to_string()]);
    assert!(fields
        .iter()
        .all(|f| f.value.is_none() || f.value == Some(FieldValue::Bool(false))));

    let mut values = std::collections::BTreeMap::new();
    values.insert("Consent".to_string(), FieldValue::Bool(true));
    let out =
        fill_form(&sanitized, &values, &FormFillOptions { flatten: false }).expect("fill_form");

    let filled = read_form(&out).expect("read filled");
    let consent = filled
        .iter()
        .find(|f| f.name == "Consent")
        .expect("Consent");
    assert_eq!(consent.value, Some(FieldValue::Bool(true)));
    let reloaded = Document::load_mem(&out).expect("reload");
    let widget = reloaded
        .get_object(consent.widgets[0])
        .unwrap()
        .as_dict()
        .unwrap();
    assert_eq!(widget.get(b"AS").unwrap().as_name().unwrap(), b"Agree");
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
    let out = fill_form(&bytes, &values, &FormFillOptions { flatten: false }).expect("fill_form");

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
    let out = fill_form(&bytes, &values, &FormFillOptions { flatten: false }).expect("fill_form");

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

/// Build and register a minimal Form XObject appearance stream.
/// `bbox` is `[bx0, by0, bx1, by1]` stored as PDF integers.
fn add_ap_stream(doc: &mut Document, bbox: [i64; 4], content: &[u8]) -> ObjectId {
    let ap_stream = Stream::new(
        dictionary! {
            "Type" => Object::Name(b"XObject".to_vec()),
            "Subtype" => Object::Name(b"Form".to_vec()),
            "BBox" => Object::Array(vec![
                Object::Integer(bbox[0]),
                Object::Integer(bbox[1]),
                Object::Integer(bbox[2]),
                Object::Integer(bbox[3]),
            ]),
        },
        content.to_vec(),
    );
    doc.add_object(Object::Stream(ap_stream))
}

#[test]
fn fill_clears_needappearances_for_inline_acroform() {
    let (mut doc, page_id) = base_doc();
    let field = dictionary! {
        "Type" => "Annot",
        "Subtype" => "Widget",
        "FT" => "Tx",
        "T" => Object::string_literal("FirstName"),
        "Rect" => rect_obj(),
    };
    let fid = add_annot(&mut doc, page_id, field);
    // /AcroForm as an inline dictionary (not an indirect reference).
    doc.catalog_mut().unwrap().set(
        "AcroForm",
        Object::Dictionary(dictionary! {
            "Fields" => vec![Object::Reference(fid)],
            "NeedAppearances" => Object::Boolean(true),
        }),
    );
    let bytes = to_bytes(&mut doc);

    let mut values = std::collections::BTreeMap::new();
    values.insert("FirstName".to_string(), FieldValue::Text("Bob".into()));
    let out = fill_form(&bytes, &values, &FormFillOptions { flatten: false }).expect("fill_form");

    let doc2 = Document::load_mem(&out).expect("reload");
    let acro = doc2
        .catalog()
        .unwrap()
        .get(b"AcroForm")
        .unwrap()
        .as_dict()
        .unwrap();
    assert!(
        !acro.get(b"NeedAppearances").unwrap().as_bool().unwrap(),
        "inline-AcroForm /NeedAppearances must be cleared after fill"
    );
}

// ── Flatten tests ─────────────────────────────────────────────────────────

#[test]
fn flatten_bakes_value_and_drops_form() {
    let (mut doc, page_id) = base_doc();

    // A widget with an /AP /N stream — the minimal bakeable form field.
    let ap_id = add_ap_stream(&mut doc, [0, 0, 150, 20], b"q Q");
    let field = dictionary! {
        "Type" => Object::Name(b"Annot".to_vec()),
        "Subtype" => Object::Name(b"Widget".to_vec()),
        "FT" => Object::Name(b"Tx".to_vec()),
        "T" => Object::string_literal("FullName"),
        "Rect" => rect_obj(),
        "AP" => Object::Dictionary(dictionary! {
            "N" => Object::Reference(ap_id),
        }),
    };
    let fid = add_annot(&mut doc, page_id, field);
    add_acroform(&mut doc, &[fid]);
    let bytes = to_bytes(&mut doc);

    let out = flatten_form(&bytes).expect("flatten_form");

    // AcroForm is dropped — read_form returns empty.
    let fields = read_form(&out).expect("read_form after flatten");
    assert!(
        fields.is_empty(),
        "AcroForm must be removed; got {fields:?}"
    );

    let doc2 = Document::load_mem(&out).expect("reload flattened doc");

    // No page /Annots entry may carry a /Widget subtype.
    for (_, pid) in doc2.get_pages() {
        let page_dict = doc2.get_object(pid).unwrap().as_dict().unwrap();
        if let Ok(annots_obj) = page_dict.get(b"Annots") {
            let annots: Vec<Object> = match annots_obj {
                Object::Array(a) => a.clone(),
                Object::Reference(id) => doc2
                    .get_object(*id)
                    .ok()
                    .and_then(|o| o.as_array().ok())
                    .cloned()
                    .unwrap_or_default(),
                _ => vec![],
            };
            for annot_ref in &annots {
                if let Ok(aid) = annot_ref.as_reference() {
                    let sub = doc2
                        .get_object(aid)
                        .ok()
                        .and_then(|o| o.as_dict().ok())
                        .and_then(|d| d.get(b"Subtype").ok())
                        .and_then(|o| o.as_name().ok().map(|n| n.to_vec()));
                    assert_ne!(
                        sub.as_deref(),
                        Some(b"Widget".as_ref()),
                        "baked widget must be removed from /Annots"
                    );
                }
            }
        }
    }

    // Page /Resources /XObject gained an entry for the baked appearance.
    let (_, pid) = doc2.get_pages().into_iter().next().unwrap();
    let resources = crate::surgery::resolve_inherited_resources(&doc2, pid)
        .expect("page resources must exist after flatten");
    let xobject_obj = resources
        .get(b"XObject")
        .expect("/XObject must be present in page /Resources after flatten");
    let xobject_dict = crate::surgery::resolve_dict(&doc2, xobject_obj)
        .expect("/XObject must resolve to a dictionary");
    assert!(
        !xobject_dict.is_empty(),
        "/XObject dict must contain at least one entry"
    );

    // Page content must contain a Do operator (draws the baked appearance).
    let page_dict = doc2.get_dictionary(pid).expect("page dict");
    let contents_obj = page_dict.get(b"Contents").ok().cloned();
    let stream_ids: Vec<ObjectId> = match contents_obj {
        Some(Object::Reference(id)) => vec![id],
        Some(Object::Array(arr)) => arr.iter().filter_map(|o| o.as_reference().ok()).collect(),
        _ => vec![],
    };
    let has_do = stream_ids.iter().any(|&sid| {
        doc2.get_object(sid)
            .ok()
            .and_then(|o| {
                if let Object::Stream(s) = o {
                    Some(s)
                } else {
                    None
                }
            })
            .map(|s| String::from_utf8_lossy(&s.content).contains("Do"))
            .unwrap_or(false)
    });
    assert!(
        has_do,
        "page content must contain a Do operator after flatten"
    );
}

#[test]
fn flatten_accumulates_xobjects_and_preserves_existing() {
    // Two widgets on one page must BOTH bake (their XObject names accumulate
    // in the page /Resources /XObject), and a resource the page already carried
    // must survive the per-widget non-destructive merge.
    let (mut doc, page_id) = base_doc();

    // Pre-existing page /Resources /XObject entry that must not be dropped.
    let existing_xobject = add_ap_stream(&mut doc, [0, 0, 5, 5], b"q Q");
    if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
        page_dict.set(
            b"Resources",
            Object::Dictionary(dictionary! {
                "XObject" => Object::Dictionary(dictionary! {
                    "Existing" => Object::Reference(existing_xobject),
                }),
            }),
        );
    }

    let make_widget = |doc: &mut Document, name: &str, rect: Object| -> ObjectId {
        let ap_id = add_ap_stream(doc, [0, 0, 100, 20], b"q Q");
        let widget = dictionary! {
            "Type" => Object::Name(b"Annot".to_vec()),
            "Subtype" => Object::Name(b"Widget".to_vec()),
            "FT" => Object::Name(b"Tx".to_vec()),
            "T" => Object::string_literal(name),
            "Rect" => rect,
            "AP" => Object::Dictionary(dictionary! {
                "N" => Object::Reference(ap_id),
            }),
        };
        add_annot(doc, page_id, widget)
    };
    let w1 = make_widget(&mut doc, "First", rect_obj());
    let w2 = make_widget(
        &mut doc,
        "Second",
        Object::Array(vec![
            Object::Integer(50),
            Object::Integer(600),
            Object::Integer(200),
            Object::Integer(620),
        ]),
    );
    add_acroform(&mut doc, &[w1, w2]);
    let bytes = to_bytes(&mut doc);

    let out = flatten_form(&bytes).expect("flatten_form");
    let doc2 = Document::load_mem(&out).expect("reload");
    let (_, pid) = doc2.get_pages().into_iter().next().unwrap();

    // The pre-existing entry plus one accumulated entry per baked widget.
    let resources = crate::surgery::resolve_inherited_resources(&doc2, pid)
        .expect("page resources after flatten");
    let xobject_dict =
        crate::surgery::resolve_dict(&doc2, resources.get(b"XObject").expect("/XObject"))
            .expect("/XObject dict");
    assert!(
        xobject_dict.has(b"Existing"),
        "the pre-existing /XObject entry must survive the merge"
    );
    assert!(
        xobject_dict.has(b"MagnaCartaFlat0") && xobject_dict.has(b"MagnaCartaFlat1"),
        "both baked widgets must accumulate distinct /XObject entries; got {:?}",
        xobject_dict
            .iter()
            .map(|(k, _)| k.clone())
            .collect::<Vec<_>>()
    );

    // The page content must carry one Do per baked widget (two total).
    let page_dict = doc2.get_dictionary(pid).expect("page dict");
    let stream_ids: Vec<ObjectId> = match page_dict.get(b"Contents").ok().cloned() {
        Some(Object::Reference(id)) => vec![id],
        Some(Object::Array(arr)) => arr.iter().filter_map(|o| o.as_reference().ok()).collect(),
        _ => vec![],
    };
    let do_count: usize = stream_ids
        .iter()
        .filter_map(|&sid| match doc2.get_object(sid).ok()? {
            Object::Stream(s) => Some(String::from_utf8_lossy(&s.content).matches(" Do").count()),
            _ => None,
        })
        .sum();
    assert_eq!(do_count, 2, "each baked widget contributes one Do operator");
}

#[test]
fn flatten_keeps_non_widget_annotations() {
    let (mut doc, page_id) = base_doc();

    // Widget with appearance — will be baked and removed from /Annots.
    let ap_id = add_ap_stream(&mut doc, [0, 0, 150, 20], b"q Q");
    let widget = dictionary! {
        "Type" => Object::Name(b"Annot".to_vec()),
        "Subtype" => Object::Name(b"Widget".to_vec()),
        "FT" => Object::Name(b"Tx".to_vec()),
        "T" => Object::string_literal("Field"),
        "Rect" => rect_obj(),
        "AP" => Object::Dictionary(dictionary! {
            "N" => Object::Reference(ap_id),
        }),
    };
    let widget_id = add_annot(&mut doc, page_id, widget);

    // Non-widget /Link annotation — must survive flatten unchanged.
    let link = dictionary! {
        "Type" => Object::Name(b"Annot".to_vec()),
        "Subtype" => Object::Name(b"Link".to_vec()),
        "Rect" => rect_obj(),
    };
    let link_id = add_annot(&mut doc, page_id, link);

    add_acroform(&mut doc, &[widget_id]);
    let bytes = to_bytes(&mut doc);

    let out = flatten_form(&bytes).expect("flatten_form");

    let doc2 = Document::load_mem(&out).expect("reload");
    let (_, pid) = doc2.get_pages().into_iter().next().unwrap();
    let page_dict = doc2.get_object(pid).unwrap().as_dict().unwrap();

    // /Annots must still be present (the /Link was kept).
    let annots_obj = page_dict
        .get(b"Annots")
        .expect("/Annots must survive when non-widget annotations exist");
    let annots: Vec<Object> = match annots_obj {
        Object::Array(a) => a.clone(),
        Object::Reference(id) => doc2
            .get_object(*id)
            .ok()
            .and_then(|o| o.as_array().ok())
            .cloned()
            .unwrap_or_default(),
        _ => vec![],
    };
    let annot_ids: Vec<ObjectId> = annots
        .iter()
        .filter_map(|o| o.as_reference().ok())
        .collect();

    assert!(
        !annot_ids.contains(&widget_id),
        "baked widget must be removed from /Annots"
    );
    assert!(
        annot_ids.contains(&link_id),
        "/Link annotation must survive flatten; remaining annots: {annot_ids:?}"
    );
}

#[test]
fn flatten_scales_bbox_to_rect() {
    // Appearance /BBox [0 0 10 10] baked onto widget /Rect [100 100 300 140].
    // rect_w = 200, rect_h = 40; bbox_w = 10, bbox_h = 10.
    // sx = 200/10 = 20, sy = 40/10 = 4.
    // e = rx0 - bx0*sx = 100 - 0 = 100; f = ry0 - by0*sy = 100 - 0 = 100.
    // Expected cm: [20, 0, 0, 4, 100, 100].
    let (mut doc, page_id) = base_doc();

    let ap_id = add_ap_stream(&mut doc, [0, 0, 10, 10], b"q Q");
    let widget = dictionary! {
        "Type" => Object::Name(b"Annot".to_vec()),
        "Subtype" => Object::Name(b"Widget".to_vec()),
        "FT" => Object::Name(b"Tx".to_vec()),
        "T" => Object::string_literal("ScaleTest"),
        "Rect" => Object::Array(vec![
            Object::Integer(100),
            Object::Integer(100),
            Object::Integer(300),
            Object::Integer(140),
        ]),
        "AP" => Object::Dictionary(dictionary! {
            "N" => Object::Reference(ap_id),
        }),
    };
    let fid = add_annot(&mut doc, page_id, widget);
    add_acroform(&mut doc, &[fid]);
    let bytes = to_bytes(&mut doc);

    let out = flatten_form(&bytes).expect("flatten_form");

    let doc2 = Document::load_mem(&out).expect("reload");
    let (_, pid) = doc2.get_pages().into_iter().next().unwrap();
    let page_dict = doc2.get_dictionary(pid).expect("page dict");
    let contents_obj = page_dict
        .get(b"Contents")
        .expect("/Contents must exist after flatten")
        .clone();

    // Collect content stream ids; the appended draw stream is last.
    let stream_ids: Vec<ObjectId> = match contents_obj {
        Object::Reference(id) => vec![id],
        Object::Array(arr) => arr.iter().filter_map(|o| o.as_reference().ok()).collect(),
        _ => panic!("unexpected /Contents object type"),
    };
    let last_id = *stream_ids.last().expect("at least one content stream");
    let content_bytes = match doc2.get_object(last_id).expect("stream object") {
        Object::Stream(s) => s.content.clone(),
        _ => panic!("expected a stream object"),
    };
    let content_str = String::from_utf8(content_bytes).expect("content stream must be valid UTF-8");

    // Appended content format: "q <a> <b> <c> <d> <e> <f> cm /<name> Do Q"
    let cm_pos = content_str
        .find(" cm ")
        .expect("appended content must contain the cm operator");
    let before_cm = content_str[..cm_pos].trim();
    let tokens: Vec<&str> = before_cm.split_whitespace().collect();
    assert!(
        tokens.len() >= 6,
        "expected at least 6 operands before cm; got tokens: {tokens:?}"
    );
    let n = tokens.len();
    let cm_a: f32 = tokens[n - 6].parse().expect("cm_a must be a number");
    let cm_b: f32 = tokens[n - 5].parse().expect("cm_b must be a number");
    let cm_c: f32 = tokens[n - 4].parse().expect("cm_c must be a number");
    let cm_d: f32 = tokens[n - 3].parse().expect("cm_d must be a number");
    let cm_e: f32 = tokens[n - 2].parse().expect("cm_e must be a number");
    let cm_f: f32 = tokens[n - 1].parse().expect("cm_f must be a number");

    assert!(
        (cm_a - 20.0).abs() < 0.01,
        "cm_a (sx) must be 20; got {cm_a}"
    );
    assert!((cm_b - 0.0).abs() < 0.01, "cm_b must be 0; got {cm_b}");
    assert!((cm_c - 0.0).abs() < 0.01, "cm_c must be 0; got {cm_c}");
    assert!((cm_d - 4.0).abs() < 0.01, "cm_d (sy) must be 4; got {cm_d}");
    assert!(
        (cm_e - 100.0).abs() < 0.01,
        "cm_e (tx) must be 100; got {cm_e}"
    );
    assert!(
        (cm_f - 100.0).abs() < 0.01,
        "cm_f (ty) must be 100; got {cm_f}"
    );
}

#[test]
fn flatten_composes_appearance_matrix() {
    // A Form XObject's /Matrix is applied by `Do` itself, so the placement cm must
    // fit the *transformed* BBox to the rect WITHOUT re-applying /Matrix.
    // BBox [0 0 10 10], /Matrix [2 0 0 2 5 5] → transformed corners (5,5)…(25,25),
    // i.e. transformed box [5 5 25 25] (20×20). Rect [0 0 20 20] → sx = sy = 1.0,
    // e = rx0 - tx0*sx = 0 - 5 = -5, f = -5. Expected cm: [1 0 0 1 -5 -5].
    // (The earlier double-applying code would have produced a = 4 here.)
    let (mut doc, page_id) = base_doc();

    let ap_stream = Stream::new(
        dictionary! {
            "Type" => Object::Name(b"XObject".to_vec()),
            "Subtype" => Object::Name(b"Form".to_vec()),
            "BBox" => Object::Array(vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Integer(10),
                Object::Integer(10),
            ]),
            "Matrix" => Object::Array(vec![
                Object::Integer(2),
                Object::Integer(0),
                Object::Integer(0),
                Object::Integer(2),
                Object::Integer(5),
                Object::Integer(5),
            ]),
        },
        b"q Q".to_vec(),
    );
    let ap_id = doc.add_object(Object::Stream(ap_stream));
    let widget = dictionary! {
        "Type" => Object::Name(b"Annot".to_vec()),
        "Subtype" => Object::Name(b"Widget".to_vec()),
        "FT" => Object::Name(b"Tx".to_vec()),
        "T" => Object::string_literal("MatrixTest"),
        "Rect" => Object::Array(vec![
            Object::Integer(0),
            Object::Integer(0),
            Object::Integer(20),
            Object::Integer(20),
        ]),
        "AP" => Object::Dictionary(dictionary! {
            "N" => Object::Reference(ap_id),
        }),
    };
    let fid = add_annot(&mut doc, page_id, widget);
    add_acroform(&mut doc, &[fid]);
    let bytes = to_bytes(&mut doc);

    let out = flatten_form(&bytes).expect("flatten_form");

    let doc2 = Document::load_mem(&out).expect("reload");
    let (_, pid) = doc2.get_pages().into_iter().next().unwrap();
    let page_dict = doc2.get_dictionary(pid).expect("page dict");
    let contents_obj = page_dict
        .get(b"Contents")
        .expect("/Contents must exist after flatten")
        .clone();
    let stream_ids: Vec<ObjectId> = match contents_obj {
        Object::Reference(id) => vec![id],
        Object::Array(arr) => arr.iter().filter_map(|o| o.as_reference().ok()).collect(),
        _ => panic!("unexpected /Contents object type"),
    };
    let last_id = *stream_ids.last().expect("at least one content stream");
    let content_str = match doc2.get_object(last_id).expect("stream object") {
        Object::Stream(s) => String::from_utf8(s.content.clone()).expect("valid UTF-8"),
        _ => panic!("expected a stream object"),
    };

    let cm_pos = content_str
        .find(" cm ")
        .expect("appended content must have cm");
    let tokens: Vec<&str> = content_str[..cm_pos].split_whitespace().collect();
    let n = tokens.len();
    let cm_a: f32 = tokens[n - 6].parse().unwrap();
    let cm_b: f32 = tokens[n - 5].parse().unwrap();
    let cm_c: f32 = tokens[n - 4].parse().unwrap();
    let cm_d: f32 = tokens[n - 3].parse().unwrap();
    let cm_e: f32 = tokens[n - 2].parse().unwrap();
    let cm_f: f32 = tokens[n - 1].parse().unwrap();

    assert!(
        (cm_a - 1.0).abs() < 0.01,
        "cm_a must be 1 (matrix NOT baked into cm); got {cm_a}"
    );
    assert!((cm_b - 0.0).abs() < 0.01, "cm_b must be 0; got {cm_b}");
    assert!((cm_c - 0.0).abs() < 0.01, "cm_c must be 0; got {cm_c}");
    assert!((cm_d - 1.0).abs() < 0.01, "cm_d must be 1; got {cm_d}");
    assert!((cm_e + 5.0).abs() < 0.01, "cm_e must be -5; got {cm_e}");
    assert!((cm_f + 5.0).abs() < 0.01, "cm_f must be -5; got {cm_f}");
}

#[test]
fn flatten_no_acroform_errs() {
    let (mut doc, _page_id) = base_doc();
    let bytes = to_bytes(&mut doc);
    let result = flatten_form(&bytes);
    assert!(
        matches!(result, Err(FormError::NoAcroForm)),
        "a document with no AcroForm must return FormError::NoAcroForm"
    );
}

// ── W-9 real-fixture tests ────────────────────────────────────────────────

#[test]
fn w9_read_lists_text_fields() {
    let w9 = include_bytes!("../../../pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf").to_vec();
    let fields = read_form(&w9).expect("read_form on W-9 must succeed");
    let text_count = fields.iter().filter(|f| f.kind == FieldKind::Text).count();
    assert!(
        text_count >= 5,
        "W-9 must have at least 5 Text fields; found {text_count}"
    );
    for f in &fields {
        assert!(
            !f.name.is_empty(),
            "every field must have a non-empty name; field: {f:?}"
        );
    }
}

#[test]
fn forms_reject_oversize_input() {
    let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
    assert!(matches!(read_form(&big), Err(FormError::Rejected)));
    assert!(matches!(flatten_form(&big), Err(FormError::Rejected)));
}

#[test]
fn w9_fill_and_flatten_end_to_end() {
    use hayro::hayro_syntax::Pdf;

    let w9 = include_bytes!("../../../pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf").to_vec();
    let fields = read_form(&w9).expect("read_form on W-9 must succeed");

    // Pick the first Text field that has both a page and a rect so an appearance
    // can be generated and baked into page content.
    let target = fields
        .iter()
        .find(|f| f.kind == FieldKind::Text && f.page.is_some() && f.rect.is_some())
        .expect("W-9 must have at least one Text field with page and rect");

    let field_name = target.name.clone();
    let field_page = target.page.unwrap_or(0) as usize;

    let mut values = std::collections::BTreeMap::new();
    values.insert(field_name.clone(), FieldValue::Text("ACMECORP".into()));

    let out = fill_form(&w9, &values, &FormFillOptions { flatten: true })
        .expect("fill_form with flatten:true must succeed on W-9");

    // Self-cross-check: the interactive form was dropped by the flatten pass.
    // read_form returns Ok(vec![]) when there is no AcroForm.
    let post_fields = read_form(&out).expect("read_form on flattened output must succeed");
    assert!(
        post_fields.is_empty(),
        "flattened document must carry no interactive form fields; found {} field(s): {:?}",
        post_fields.len(),
        post_fields
            .iter()
            .map(|f| f.name.as_str())
            .collect::<Vec<_>>()
    );

    // Value renders: confirm the filled value appears in the rendered glyphs.
    // Try the field's own page first; then scan all pages until observe_page
    // returns None (out-of-bounds), so the check is robust to page-index variance.
    let pdf = Pdf::new(out).expect("hayro must parse the flattened output");

    let found = (0_usize..)
        .map(|page_index| crate::textpos::observe_page(&pdf, page_index))
        .take_while(|obs| obs.is_some())
        .flatten()
        .any(|obs| {
            obs.glyphs
                .iter()
                .map(|g| g.text.as_str())
                .collect::<String>()
                .contains("ACMECORP")
        });

    assert!(
        found,
        "filled value 'ACMECORP' must appear in rendered glyphs \
             (field '{}', expected on page {})",
        field_name, field_page
    );
}
