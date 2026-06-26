//! AcroForm fill + flatten feasibility spike — throwaway research code.
//!
//! The crux for slice 5 (forms): can we
//!   (Q1) read an AcroForm's fields,
//!   (Q3) FILL a text field — set /V AND generate an /AP /N appearance stream that
//!        OUR engine (hayro) actually renders (most renderers do NOT synthesize an
//!        appearance from /V + NeedAppearances, so we must build the appearance), and
//!   (Q4) FLATTEN — bake each widget's appearance into the page content stream and drop
//!        the widgets + AcroForm, so the filled values become permanent static content.
//!
//! Verified against the IRS W-9 AcroForm in the committed CI corpus.

use std::fs;
use std::path::{Path, PathBuf};

use hayro::hayro_interpret::font::Glyph;
use hayro::hayro_interpret::hayro_cmap::BfString;
use hayro::hayro_interpret::{
    interpret_page, BlendMode, ClipPath, Context, Device, GlyphDrawMode, Image, InterpreterCache,
    InterpreterSettings, Paint, PathDrawMode, SoftMask, TransformExt,
};
use hayro::hayro_syntax::Pdf;
use kurbo::{Affine, BezPath, Rect};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};

// ── hayro observation: count glyphs + recover text ──────────────────────────

#[derive(Default)]
struct Observer {
    texts: Vec<String>,
}
impl<'a> Device<'a> for Observer {
    fn set_soft_mask(&mut self, _: Option<SoftMask<'a>>) {}
    fn set_blend_mode(&mut self, _: BlendMode) {}
    fn draw_path(&mut self, _: &BezPath, _: Affine, _: &Paint<'a>, _: &PathDrawMode) {}
    fn push_clip_path(&mut self, _: &ClipPath) {}
    fn pop_clip_path(&mut self) {}
    fn push_transparency_group(&mut self, _: f32, _: Option<SoftMask<'a>>, _: BlendMode) {}
    fn pop_transparency_group(&mut self) {}
    fn draw_image(&mut self, _: Image<'a, '_>, _: Affine) {}
    fn draw_glyph(
        &mut self,
        glyph: &Glyph<'a>,
        _: Affine,
        _: Affine,
        _: &Paint<'a>,
        _: &GlyphDrawMode,
    ) {
        let t = match glyph.as_unicode() {
            Some(BfString::Char(c)) => c.to_string(),
            Some(BfString::String(s)) => s,
            None => String::new(),
        };
        self.texts.push(t);
    }
}

fn observe_all_pages(bytes: &[u8]) -> Option<(usize, String)> {
    let pdf = Pdf::new(bytes.to_vec()).ok()?;
    let pages = pdf.pages();
    let mut total = 0usize;
    let mut text = String::new();
    for (i, page) in pages.iter().enumerate() {
        let (w, h) = page.render_dimensions();
        let cache = InterpreterCache::new();
        let mut ctx = Context::new(
            page.initial_transform(true).to_kurbo(),
            Rect::new(0.0, 0.0, w as f64, h as f64),
            &cache,
            page.xref(),
            InterpreterSettings::default(),
        );
        let mut obs = Observer::default();
        interpret_page(page, &mut ctx, &mut obs);
        total += obs.glyphs_len();
        text.push_str(&obs.texts.concat());
        let _ = i;
    }
    Some((total, text))
}
impl Observer {
    fn glyphs_len(&self) -> usize {
        self.texts.len()
    }
}

// ── lopdf helpers ────────────────────────────────────────────────────────────

fn deref<'a>(doc: &'a Document, obj: &'a Object) -> Option<&'a Object> {
    match obj {
        Object::Reference(id) => doc.get_object(*id).ok(),
        other => Some(other),
    }
}
fn as_dict<'a>(doc: &'a Document, obj: &'a Object) -> Option<&'a Dictionary> {
    match deref(doc, obj)? {
        Object::Dictionary(d) => Some(d),
        Object::Stream(s) => Some(&s.dict),
        _ => None,
    }
}
fn num(o: &Object) -> Option<f32> {
    match o {
        Object::Integer(n) => Some(*n as f32),
        Object::Real(r) => Some(*r),
        _ => None,
    }
}
fn rect_of(doc: &Document, d: &Dictionary) -> Option<[f32; 4]> {
    let arr = match deref(doc, d.get(b"Rect").ok()?)? {
        Object::Array(a) => a,
        _ => return None,
    };
    if arr.len() != 4 {
        return None;
    }
    Some([num(&arr[0])?, num(&arr[1])?, num(&arr[2])?, num(&arr[3])?])
}

fn acroform_id(doc: &Document) -> Option<ObjectId> {
    let root = doc.trailer.get(b"Root").ok()?.as_reference().ok()?;
    let cat = doc.get_object(root).ok()?.as_dict().ok()?;
    cat.get(b"AcroForm").ok()?.as_reference().ok()
}

/// Collect terminal field/widget object ids reachable from AcroForm /Fields (depth-first
/// over /Kids), returning those that carry a /Rect (renderable widgets).
fn terminal_widgets(doc: &Document) -> Vec<ObjectId> {
    let mut out = Vec::new();
    let Some(acro_id) = acroform_id(doc) else {
        return out;
    };
    let Ok(acro) = doc.get_object(acro_id).and_then(|o| o.as_dict().cloned()) else {
        return out;
    };
    let mut stack: Vec<ObjectId> = match acro.get(b"Fields") {
        Ok(Object::Array(a)) => a.iter().filter_map(|o| o.as_reference().ok()).collect(),
        _ => vec![],
    };
    let mut seen = std::collections::BTreeSet::new();
    while let Some(id) = stack.pop() {
        if !seen.insert(id) {
            continue;
        }
        let Ok(d) = doc.get_object(id).and_then(|o| o.as_dict().cloned()) else {
            continue;
        };
        if let Ok(Object::Array(kids)) = d.get(b"Kids") {
            for k in kids {
                if let Ok(kid) = k.as_reference() {
                    stack.push(kid);
                }
            }
        } else if d.get(b"Rect").is_ok() {
            out.push(id);
        }
    }
    out
}

fn field_name(doc: &Document, d: &Dictionary) -> String {
    d.get(b"T")
        .ok()
        .and_then(|o| deref(doc, o))
        .and_then(|o| match o {
            Object::String(b, _) => Some(String::from_utf8_lossy(b).into_owned()),
            _ => None,
        })
        .unwrap_or_else(|| "<unnamed>".into())
}
fn field_type(doc: &Document, d: &Dictionary) -> String {
    d.get(b"FT")
        .ok()
        .and_then(|o| deref(doc, o))
        .and_then(|o| o.as_name().ok())
        .map(|n| String::from_utf8_lossy(n).into_owned())
        .unwrap_or_default()
}

// ── fill: set /V + generate an /AP /N appearance the engine can render ───────

const FILL_VALUE: &str = "SPIKE-FILLED-VALUE";

/// Add a shared Helvetica font object; return its id.
fn add_helvetica(doc: &mut Document) -> ObjectId {
    doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
    })
}

/// Build an /AP /N appearance Form XObject for a text value sized to `rect`, return its id.
fn make_text_appearance(doc: &mut Document, rect: [f32; 4], font_id: ObjectId, value: &str) -> ObjectId {
    let w = rect[2] - rect[0];
    let h = rect[3] - rect[1];
    // Standard variable-text appearance; baseline a little above the bottom.
    let size = (h * 0.6).clamp(6.0, 12.0);
    let content = format!(
        "/Tx BMC q BT /Helv {size:.1} Tf 0 g 2 {:.1} Td ({}) Tj ET Q EMC",
        (h - size) / 2.0,
        value.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)"),
    );
    let dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Form",
        "FormType" => 1,
        "BBox" => vec![0.into(), 0.into(), Object::Real(w), Object::Real(h)],
        "Resources" => dictionary! {
            "Font" => dictionary! { "Helv" => Object::Reference(font_id) },
        },
    };
    doc.add_object(Stream::new(dict, content.into_bytes()))
}

fn main() {
    let path = corpus("gov_irs_w9_acroform.pdf");
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            println!("[IO-ERR] {}: {e}", path.display());
            return;
        }
    };

    println!("\n===== Q1: hayro renders the AcroForm =====");
    match observe_all_pages(&bytes) {
        Some((n, text)) => {
            let preview: String = text.chars().take(60).collect();
            println!("  glyphs drawn across pages: {n}; sample text: {preview:?}");
            println!("  >>> {}", if n > 0 { "PASS — the form renders" } else { "FAIL" });
        }
        None => println!("  FAIL — could not interpret the form"),
    }

    println!("\n===== Q2: enumerate AcroForm fields =====");
    let doc0 = Document::load_mem(&bytes).expect("load");
    let widgets = terminal_widgets(&doc0);
    println!("  terminal widgets with /Rect: {}", widgets.len());
    let mut first_text: Option<ObjectId> = None;
    for (i, &id) in widgets.iter().enumerate() {
        let d = doc0.get_object(id).unwrap().as_dict().unwrap();
        let ft = field_type(&doc0, d);
        let nm = field_name(&doc0, d);
        let has_ap = d.get(b"AP").is_ok();
        if i < 8 {
            println!("    [{i}] FT={ft:?} name={nm:?} rect={:?} hasAP={has_ap}", rect_of(&doc0, d));
        }
        if ft == "Tx" && first_text.is_none() && rect_of(&doc0, d).is_some() {
            first_text = Some(id);
        }
    }

    let Some(text_field_id) = first_text else {
        println!("  [NO-TEXT-FIELD] no fillable text field found — cannot spike fill");
        return;
    };

    println!("\n===== Q3: fill a text field + generate a renderable appearance =====");
    let mut doc = Document::load_mem(&bytes).expect("reload");
    let font_id = add_helvetica(&mut doc);
    let rect = {
        let d = doc.get_object(text_field_id).unwrap().as_dict().unwrap();
        rect_of(&doc, d).unwrap()
    };
    let ap_id = make_text_appearance(&mut doc, rect, font_id, FILL_VALUE);
    {
        let d = doc.get_object_mut(text_field_id).unwrap().as_dict_mut().unwrap();
        d.set("V", Object::string_literal(FILL_VALUE));
        d.set("AP", Object::Dictionary(dictionary! { "N" => Object::Reference(ap_id) }));
    }
    let mut filled = Vec::new();
    doc.save_to(&mut filled).unwrap();
    match observe_all_pages(&filled) {
        Some((_, text)) => {
            let rendered = text.contains("SPIKE-FILLED-VALUE") || text.contains("SPIKE");
            println!("  filled value present in render: {rendered}");
            println!(
                "  >>> {}",
                if rendered {
                    "PASS — a generated /AP appearance renders in our engine (no NeedAppearances reliance)"
                } else {
                    "FAIL — generated appearance did not render (engine may not draw widget /AP)"
                }
            );
        }
        None => println!("  FAIL — filled doc did not interpret"),
    }

    println!("\n===== Q4: flatten — bake widget appearances into page content =====");
    flatten_and_report(&filled);

    println!("\n===== SPIKE COMPLETE =====\n");
}

/// Flatten: for every widget with an /AP /N form, draw it into its page's content at the
/// widget /Rect, add the form to the page /Resources /XObject, then remove /Annots from
/// pages and /AcroForm from the catalog. Report whether the filled value still renders
/// and whether any form structure remains.
fn flatten_and_report(bytes: &[u8]) {
    let mut doc = Document::load_mem(bytes).expect("reload for flatten");
    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();

    let mut drawn = 0usize;
    for (_, page_id) in &pages {
        // Collect this page's widget annotations that have an /AP /N.
        let annots: Vec<ObjectId> = {
            let Ok(page) = doc.get_object(*page_id).and_then(|o| o.as_dict().cloned()) else {
                continue;
            };
            // /Annots may be an inline array OR an indirect reference to one — deref it.
            match page.get(b"Annots").ok().and_then(|o| deref(&doc, o)) {
                Some(Object::Array(a)) => a.iter().filter_map(|o| o.as_reference().ok()).collect(),
                _ => vec![],
            }
        };
        let mut xobjects = Dictionary::new();
        let mut overlay = String::new();
        for (n, annot_id) in annots.iter().enumerate() {
            let Ok(ad) = doc.get_object(*annot_id).and_then(|o| o.as_dict().cloned()) else {
                continue;
            };
            let Some(r) = rect_of(&doc, &ad) else { continue };
            let ap_n = ad
                .get(b"AP")
                .ok()
                .and_then(|o| as_dict(&doc, o))
                .and_then(|ap| ap.get(b"N").ok())
                .and_then(|o| o.as_reference().ok());
            let Some(ap_ref) = ap_n else { continue };
            let name = format!("FmFlat{n}");
            xobjects.set(name.clone(), Object::Reference(ap_ref));
            // Draw the appearance at the widget rect (BBox sized to rect → translate only).
            overlay.push_str(&format!(
                "q 1 0 0 1 {:.2} {:.2} cm /{name} Do Q\n",
                r[0], r[1]
            ));
            drawn += 1;
        }
        if overlay.is_empty() {
            continue;
        }
        // Append the overlay as a new content stream and merge the xobjects into resources.
        let overlay_id = doc.add_object(Stream::new(dictionary! {}, overlay.into_bytes()));
        if let Ok(page) = doc.get_object_mut(*page_id).and_then(|o| o.as_dict_mut()) {
            let mut contents: Vec<Object> = match page.get(b"Contents") {
                Ok(Object::Reference(r)) => vec![Object::Reference(*r)],
                Ok(Object::Array(a)) => a.clone(),
                _ => vec![],
            };
            contents.push(Object::Reference(overlay_id));
            page.set("Contents", Object::Array(contents));
            page.remove(b"Annots");
            // merge xobjects into /Resources /XObject (assume inline resources for the spike)
            let mut res = match page.get(b"Resources") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            let mut xo = match res.get(b"XObject") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            for (k, v) in xobjects.iter() {
                xo.set(k.clone(), v.clone());
            }
            res.set("XObject", Object::Dictionary(xo));
            page.set("Resources", Object::Dictionary(res));
        }
    }

    // Drop the AcroForm from the catalog.
    if let Some(root) = doc.trailer.get(b"Root").ok().and_then(|o| o.as_reference().ok()) {
        if let Ok(cat) = doc.get_object_mut(root).and_then(|o| o.as_dict_mut()) {
            cat.remove(b"AcroForm");
        }
    }

    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    let reloaded = Document::load_mem(&out).unwrap();
    let acro_gone = acroform_id(&reloaded).is_none();
    let annots_gone = reloaded
        .get_pages()
        .values()
        .all(|&pid| reloaded.get_object(pid).and_then(|o| o.as_dict().cloned()).map(|d| d.get(b"Annots").is_err()).unwrap_or(true));
    let renders = observe_all_pages(&out)
        .map(|(_, t)| t.contains("SPIKE"))
        .unwrap_or(false);
    println!("  widget appearances drawn into page content: {drawn}");
    println!("  AcroForm removed: {acro_gone}; widget /Annots removed: {annots_gone}");
    println!("  filled value still renders as static content: {renders}");
    let pass = drawn > 0 && acro_gone && annots_gone && renders;
    println!(
        "  >>> {}",
        if pass { "PASS — flatten bakes appearances into the page and drops the form" } else { "FAIL" }
    );
}

fn corpus(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("crates")
        .join("pdf-eval")
        .join("corpus-ci")
        .join(name)
}
