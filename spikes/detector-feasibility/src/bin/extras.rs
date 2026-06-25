// Mini-spike for the two deferred detectors (fast-follow): HiddenLayer (text in
// an optional-content group that is off by default) and RemovableAnnotation (an
// opaque annotation covering text). Both are structural (lopdf) — no rendering.

use lopdf::{dictionary, Dictionary, Document, Object, Stream};

/// Build a PDF whose page content draws "(hidden layer text)" inside an optional
/// content group that the default configuration turns OFF.
fn build_ocg_doc() -> Document {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    // The optional-content group, marked OFF in the default config.
    let ocg_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"OCG".to_vec()),
        "Name" => Object::string_literal("Secret Layer"),
    });

    // Page content: an /OC marked-content sequence referencing the OCG via the
    // resource name /MC0.
    let content = b"/OC /MC0 BDC BT /F1 12 Tf 72 700 Td (hidden layer text) Tj ET EMC".to_vec();
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content));

    let mut properties = Dictionary::new();
    properties.set("MC0", Object::Reference(ocg_id));
    let mut resources = Dictionary::new();
    resources.set("Properties", Object::Dictionary(properties));

    let mut page = Dictionary::new();
    page.set("Type", Object::Name(b"Page".to_vec()));
    page.set("Parent", Object::Reference(pages_id));
    page.set("Contents", Object::Reference(content_id));
    page.set("Resources", Object::Dictionary(resources));
    page.set("MediaBox", Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]));
    let page_id = doc.add_object(Object::Dictionary(page));

    let mut pages = Dictionary::new();
    pages.set("Type", Object::Name(b"Pages".to_vec()));
    pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
    pages.set("Count", Object::Integer(1));
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    // Catalog with /OCProperties: the OCG exists, default config turns it OFF.
    let oc_properties = dictionary! {
        "OCGs" => Object::Array(vec![Object::Reference(ocg_id)]),
        "D" => Object::Dictionary(dictionary! {
            "OFF" => Object::Array(vec![Object::Reference(ocg_id)]),
            "ON" => Object::Array(vec![]),
        }),
    };
    let catalog_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"Catalog".to_vec()),
        "Pages" => Object::Reference(pages_id),
        "OCProperties" => Object::Dictionary(oc_properties),
    });
    doc.trailer.set("Root", Object::Reference(catalog_id));
    doc
}

/// The set of OCG object ids the default configuration turns OFF.
fn inactive_ocgs(doc: &Document) -> Vec<(u32, u16)> {
    doc.catalog()
        .ok()
        .and_then(|c| c.get(b"OCProperties").ok())
        .and_then(|o| o.as_dict().ok())
        .and_then(|ocp| ocp.get(b"D").ok())
        .and_then(|o| o.as_dict().ok())
        .and_then(|d| d.get(b"OFF").ok())
        .and_then(|o| o.as_array().ok())
        .map(|arr| arr.iter().filter_map(|o| o.as_reference().ok()).collect())
        .unwrap_or_default()
}

/// Resolve a page's /Resources /Properties name -> OCG object id.
fn property_ocg(doc: &Document, page_id: (u32, u16), name: &[u8]) -> Option<(u32, u16)> {
    let page = doc.get_object(page_id).ok()?.as_dict().ok()?;
    let resources = page.get(b"Resources").ok()?.as_dict().ok()?;
    let properties = resources.get(b"Properties").ok()?.as_dict().ok()?;
    properties.get(name).ok()?.as_reference().ok()
}

/// Scan the page's content operators for /OC marked content whose group is
/// inactive, recovering the text drawn inside it.
fn recover_hidden_layer_text(doc: &Document, page_id: (u32, u16)) -> String {
    let off = inactive_ocgs(doc);
    let content = match doc.get_and_decode_page_content(page_id) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let mut hidden_depth: u32 = 0;
    let mut recovered = String::new();
    for op in &content.operations {
        match op.operator.as_str() {
            "BDC" | "BMC" => {
                let is_hidden_oc = op.operands.first().and_then(|o| o.as_name().ok()) == Some(b"OC")
                    && op
                        .operands
                        .get(1)
                        .and_then(|o| o.as_name().ok())
                        .and_then(|name| property_ocg(doc, page_id, name))
                        .map(|ocg| off.contains(&ocg))
                        .unwrap_or(false);
                if is_hidden_oc || hidden_depth > 0 {
                    hidden_depth += 1;
                }
            }
            "EMC" => {
                hidden_depth = hidden_depth.saturating_sub(1);
            }
            "Tj" if hidden_depth > 0 => {
                if let Some(s) = op.operands.first().and_then(|o| o.as_str().ok()) {
                    recovered.push_str(&String::from_utf8_lossy(s));
                }
            }
            _ => {}
        }
    }
    recovered
}

/// Build a doc with a text page and an opaque Square annotation over the text.
fn build_annotated_doc() -> Document {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let content = b"BT /F1 12 Tf 72 700 Td (confidential) Tj ET".to_vec();
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content));
    // An opaque black Square annotation covering the text region.
    let annot_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"Annot".to_vec()),
        "Subtype" => Object::Name(b"Square".to_vec()),
        "Rect" => Object::Array(vec![60.into(), 690.into(), 300.into(), 720.into()]),
        "IC" => Object::Array(vec![0.into(), 0.into(), 0.into()]),
        "CA" => Object::Real(1.0),
    });
    let mut page = Dictionary::new();
    page.set("Type", Object::Name(b"Page".to_vec()));
    page.set("Parent", Object::Reference(pages_id));
    page.set("Contents", Object::Reference(content_id));
    page.set("MediaBox", Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]));
    page.set("Annots", Object::Array(vec![Object::Reference(annot_id)]));
    let page_id = doc.add_object(Object::Dictionary(page));
    let mut pages = Dictionary::new();
    pages.set("Type", Object::Name(b"Pages".to_vec()));
    pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
    pages.set("Count", Object::Integer(1));
    doc.objects.insert(pages_id, Object::Dictionary(pages));
    let catalog_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"Catalog".to_vec()),
        "Pages" => Object::Reference(pages_id),
    });
    doc.trailer.set("Root", Object::Reference(catalog_id));
    doc
}

/// Read each page annotation's subtype + rect (the data RemovableAnnotation needs
/// to overlap against glyph positions).
fn read_annotations(doc: &Document) -> Vec<(String, [f32; 4])> {
    let mut out = Vec::new();
    for (_, page_id) in doc.get_pages() {
        let Ok(page) = doc.get_object(page_id).and_then(|o| o.as_dict()) else { continue };
        let annots = match page.get(b"Annots") {
            Ok(Object::Array(a)) => a.clone(),
            Ok(Object::Reference(r)) => doc
                .get_object(*r)
                .ok()
                .and_then(|o| o.as_array().ok())
                .cloned()
                .unwrap_or_default(),
            _ => Vec::new(),
        };
        for a in &annots {
            let Some(dict) = a.as_reference().ok().and_then(|id| doc.get_object(id).ok()).and_then(|o| o.as_dict().ok()) else { continue };
            let subtype = dict
                .get(b"Subtype")
                .ok()
                .and_then(|o| o.as_name().ok())
                .map(|n| String::from_utf8_lossy(n).into_owned())
                .unwrap_or_default();
            let rect = dict
                .get(b"Rect")
                .ok()
                .and_then(|o| o.as_array().ok())
                .map(|arr| {
                    let v: Vec<f32> = arr.iter().filter_map(|o| o.as_float().ok().or_else(|| o.as_i64().ok().map(|i| i as f32))).collect();
                    [v.first().copied().unwrap_or(0.0), v.get(1).copied().unwrap_or(0.0), v.get(2).copied().unwrap_or(0.0), v.get(3).copied().unwrap_or(0.0)]
                })
                .unwrap_or([0.0; 4]);
            out.push((subtype, rect));
        }
    }
    out
}

fn main() {
    println!("== Deferred-detector mini-spike ==");

    // HiddenLayer.
    let ocg_doc = build_ocg_doc();
    let page_id = *ocg_doc.get_pages().get(&1).unwrap();
    let off = inactive_ocgs(&ocg_doc);
    let hidden = recover_hidden_layer_text(&ocg_doc, page_id);
    println!("[HiddenLayer] inactive OCGs={} recovered={:?}", off.len(), hidden);
    let hidden_ok = off.len() == 1 && hidden.contains("hidden layer text");

    // RemovableAnnotation.
    let annot_doc = build_annotated_doc();
    let annots = read_annotations(&annot_doc);
    println!("[RemovableAnnotation] annotations read: {annots:?}");
    // A glyph drawn at PDF point (72,700) sits inside the Square rect [60,690,300,720].
    let glyph_pt = (72.0_f32, 700.0_f32);
    let covered_by_annot = annots.iter().any(|(subtype, r)| {
        subtype == "Square" && glyph_pt.0 >= r[0] && glyph_pt.0 <= r[2] && glyph_pt.1 >= r[1] && glyph_pt.1 <= r[3]
    });
    let annot_ok = annots.len() == 1 && covered_by_annot;

    println!("\nVERDICT:");
    if hidden_ok && annot_ok {
        println!("  GO — HiddenLayer recovers text from an off-by-default OCG; RemovableAnnotation reads the opaque annotation rect and overlaps the glyph point.");
    } else {
        println!("  CHECK — hidden_ok={hidden_ok} annot_ok={annot_ok}");
    }
}
