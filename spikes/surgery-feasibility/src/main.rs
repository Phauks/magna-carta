//! Content-stream surgery feasibility spike — throwaway research code.
//!
//! Goal: prove (or refute) text-preserving redaction — excising targeted glyphs
//! from a page's content stream so the REST of the page stays live, selectable
//! text, instead of flattening the whole page to an image.
//!
//! The crux is the *correspondence* problem. The detector's observing Device
//! (hayro) gives accurate per-glyph positions but no link back to the content
//! stream. Surgery edits the content stream. So we must bridge: walk the page
//! content operators, and confirm the glyphs they enumerate line up with the
//! glyphs hayro actually draws. Where they DON'T line up (Form XObjects, CID
//! fonts) is the honest scope boundary for the slice.
//!
//! Questions:
//!   Q1  lopdf can decode -> edit -> re-encode an operator stream losslessly.
//!   Q2  enumerate glyph code-units from the text operators (Tj/TJ/'/").
//!   Q3  CORRESPONDENCE: do the content-stream glyph counts match hayro's
//!       draw_glyph counts per page? where do they diverge (Do / Type0)?
//!   Q4  excise a target run end-to-end: target text gone, rest survives + renders.
//!   Q4b advance recoverability: does the target font expose widths, so a
//!       layout-preserving substitution is mechanically possible?

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use hayro::hayro_interpret::font::Glyph;
use hayro::hayro_interpret::hayro_cmap::BfString;
use hayro::hayro_interpret::{
    interpret_page, BlendMode, ClipPath, Context, Device, GlyphDrawMode, Image, InterpreterCache,
    InterpreterSettings, Paint, PathDrawMode, SoftMask, TransformExt,
};
use hayro::hayro_syntax::Pdf;
use kurbo::{Affine, BezPath, Rect, Shape};
use lopdf::content::Content;
use lopdf::{Object, ObjectId};

// ── hayro observer: count + collect drawn glyphs ─────────────────────────────

#[derive(Default)]
struct Observer {
    texts: Vec<String>,
    bboxes: Vec<Rect>,
    invisible: usize,
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
        transform: Affine,
        glyph_transform: Affine,
        _: &Paint<'a>,
        mode: &GlyphDrawMode,
    ) {
        let text = match glyph.as_unicode() {
            Some(BfString::Char(ch)) => ch.to_string(),
            Some(BfString::String(s)) => s,
            None => String::new(),
        };
        let matrix = transform * glyph_transform;
        let bbox = match glyph {
            Glyph::Outline(o) => {
                let mut p = o.outline();
                p.apply_affine(matrix);
                p.bounding_box()
            }
            Glyph::Type3(_) => {
                let t = matrix.translation();
                Rect::new(t.x, t.y, t.x, t.y)
            }
        };
        if matches!(mode, GlyphDrawMode::Invisible) {
            self.invisible += 1;
        }
        self.texts.push(text);
        self.bboxes.push(bbox);
    }
}

fn observe_first_page(bytes: &[u8]) -> Option<Observer> {
    let pdf = Pdf::new(bytes.to_vec()).ok()?;
    let pages = pdf.pages();
    let page = pages.first()?;
    let (w, h) = page.render_dimensions();
    let initial = page.initial_transform(true).to_kurbo();
    let cache = InterpreterCache::new();
    let mut ctx = Context::new(
        initial,
        Rect::new(0.0, 0.0, w as f64, h as f64),
        &cache,
        page.xref(),
        InterpreterSettings::default(),
    );
    let mut obs = Observer::default();
    interpret_page(page, &mut ctx, &mut obs);
    Some(obs)
}

// ── content-stream walking ───────────────────────────────────────────────────

fn resolve_dict<'a>(doc: &'a lopdf::Document, obj: &'a Object) -> Option<&'a lopdf::Dictionary> {
    match obj {
        Object::Dictionary(d) => Some(d),
        Object::Stream(s) => Some(&s.dict),
        Object::Reference(id) => match doc.get_object(*id).ok()? {
            Object::Dictionary(d) => Some(d),
            Object::Stream(s) => Some(&s.dict),
            _ => None,
        },
        _ => None,
    }
}

/// Map each font resource name on a page to its bytes-per-code (1 for simple
/// fonts, 2 for Type0/CID — the common case; CID codespace can vary, noted).
fn font_bytes_per_code(doc: &lopdf::Document, page_id: ObjectId) -> HashMap<Vec<u8>, usize> {
    let mut map = HashMap::new();
    let Ok(page) = doc.get_dictionary(page_id) else {
        return map;
    };
    let Some(res) = page.get(b"Resources").ok().and_then(|o| resolve_dict(doc, o)) else {
        return map;
    };
    let Some(fonts) = res.get(b"Font").ok().and_then(|o| resolve_dict(doc, o)) else {
        return map;
    };
    for (name, fobj) in fonts.iter() {
        if let Some(fd) = resolve_dict(doc, fobj) {
            let is_type0 = matches!(fd.get(b"Subtype").and_then(|o| o.as_name()), Ok(b"Type0"));
            map.insert(name.clone(), if is_type0 { 2 } else { 1 });
        }
    }
    map
}

fn string_bytes(o: &Object) -> Option<&[u8]> {
    if let Object::String(b, _) = o {
        Some(b)
    } else {
        None
    }
}

struct Walk {
    glyph_units: usize,
    text_ops: usize,
    do_ops: usize,
    type0_units: usize,
}

fn walk(content: &Content, fonts: &HashMap<Vec<u8>, usize>) -> Walk {
    let (mut glyph_units, mut text_ops, mut do_ops, mut type0_units) = (0, 0, 0, 0);
    let mut bpc = 1usize;
    let mut in_type0 = false;
    for op in &content.operations {
        match op.operator.as_str() {
            "Tf" => {
                if let Some(Object::Name(n)) = op.operands.first() {
                    bpc = *fonts.get(n).unwrap_or(&1);
                    in_type0 = bpc == 2;
                }
            }
            "Tj" | "'" => {
                if let Some(s) = op.operands.last().and_then(string_bytes) {
                    let u = s.len() / bpc;
                    glyph_units += u;
                    if in_type0 {
                        type0_units += u;
                    }
                    text_ops += 1;
                }
            }
            "\"" => {
                if let Some(s) = op.operands.last().and_then(string_bytes) {
                    let u = s.len() / bpc;
                    glyph_units += u;
                    if in_type0 {
                        type0_units += u;
                    }
                    text_ops += 1;
                }
            }
            "TJ" => {
                if let Some(Object::Array(arr)) = op.operands.first() {
                    for el in arr {
                        if let Some(s) = string_bytes(el) {
                            let u = s.len() / bpc;
                            glyph_units += u;
                            if in_type0 {
                                type0_units += u;
                            }
                        }
                    }
                    text_ops += 1;
                }
            }
            "Do" => do_ops += 1,
            _ => {}
        }
    }
    Walk {
        glyph_units,
        text_ops,
        do_ops,
        type0_units,
    }
}

fn first_page_id(doc: &lopdf::Document) -> Option<ObjectId> {
    let pages = doc.get_pages();
    let mut nums: Vec<u32> = pages.keys().copied().collect();
    nums.sort();
    nums.first().and_then(|n| pages.get(n).copied())
}

fn corpus_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("pdf-engine-eval")
        .join("corpus")
        .join(name)
}

// ── Q4 helpers: find an excisable run, excise it ─────────────────────────────

/// First contiguous run of >= 5 ASCII-alpha bytes inside any text operand,
/// returned as owned bytes. Sourcing the target FROM a single operand sidesteps
/// kerning (a word split across TJ elements).
fn find_target_run(content: &Content) -> Option<Vec<u8>> {
    for op in &content.operations {
        let strings: Vec<&[u8]> = match op.operator.as_str() {
            "Tj" | "'" | "\"" => op.operands.last().and_then(string_bytes).into_iter().collect(),
            "TJ" => match op.operands.first() {
                Some(Object::Array(arr)) => arr.iter().filter_map(string_bytes).collect(),
                _ => vec![],
            },
            _ => vec![],
        };
        for s in strings {
            let mut run: Vec<u8> = Vec::new();
            for &b in s {
                if b.is_ascii_alphabetic() {
                    run.push(b);
                    if run.len() >= 5 {
                        return Some(run);
                    }
                } else {
                    run.clear();
                }
            }
        }
    }
    None
}

fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Remove `needle` bytes from the first text operand that contains them.
/// Returns true if an excision happened.
fn excise_run(content: &mut Content, needle: &[u8]) -> bool {
    for op in &mut content.operations {
        match op.operator.as_str() {
            "Tj" | "'" | "\"" => {
                if let Some(Object::String(b, _)) = op.operands.last_mut() {
                    if let Some(pos) = find_subslice(b, needle) {
                        b.drain(pos..pos + needle.len());
                        return true;
                    }
                }
            }
            "TJ" => {
                if let Some(Object::Array(arr)) = op.operands.first_mut() {
                    for el in arr.iter_mut() {
                        if let Object::String(b, _) = el {
                            if let Some(pos) = find_subslice(b, needle) {
                                b.drain(pos..pos + needle.len());
                                return true;
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    false
}

/// Does the target font expose per-glyph advance widths (so a layout-preserving
/// substitution — replacing an excised run with an equal TJ adjustment — is
/// mechanically possible)? Simple fonts: /Widths. Type0: descendant /W.
fn any_font_has_widths(doc: &lopdf::Document, page_id: ObjectId) -> bool {
    let Ok(page) = doc.get_dictionary(page_id) else {
        return false;
    };
    let Some(res) = page.get(b"Resources").ok().and_then(|o| resolve_dict(doc, o)) else {
        return false;
    };
    let Some(fonts) = res.get(b"Font").ok().and_then(|o| resolve_dict(doc, o)) else {
        return false;
    };
    for (_, fobj) in fonts.iter() {
        let Some(fd) = resolve_dict(doc, fobj) else {
            continue;
        };
        if fd.get(b"Widths").is_ok() {
            return true;
        }
        // Type0: look into descendant font for /W.
        if let Some(descs) = fd.get(b"DescendantFonts").ok().and_then(|o| match o {
            Object::Array(a) => a.first().and_then(|x| resolve_dict(doc, x)),
            other => resolve_dict(doc, other),
        }) {
            if descs.get(b"W").is_ok() {
                return true;
            }
        }
    }
    false
}

fn main() {
    let corpus = [
        "basicapi.pdf",
        "court_ao088.pdf",
        "court_ao089.pdf",
        "court_ao240.pdf",
        "gov_irs_w4_acroform.pdf",
        "gov_irs_w9_acroform.pdf",
        "pdfjs_issue1905.pdf",
        "TAMReview.pdf",
    ];

    // ── Q1 + Q2 + Q3: round-trip + correspondence over the corpus ────────────
    println!("\n===== Q1/Q2/Q3: content round-trip + glyph correspondence (page 1) =====");
    println!(
        "{:<28} {:>7} {:>7} {:>6} {:>6} {:>5}  {}",
        "file", "hayro", "cs", "delta", "type0", "Do", "verdict"
    );
    for name in &corpus {
        let Ok(bytes) = fs::read(corpus_path(name)) else {
            println!("  {name}: [IO-ERR]");
            continue;
        };
        let Ok(doc) = lopdf::Document::load_mem(&bytes) else {
            println!("  {name}: [LOPDF-LOAD-ERR]");
            continue;
        };
        let Some(page_id) = first_page_id(&doc) else {
            println!("  {name}: [NO-PAGES]");
            continue;
        };

        // Q1: decode -> encode -> decode, op-count must be stable.
        let content_bytes = match doc.get_page_content(page_id) {
            Ok(b) => b,
            Err(e) => {
                println!("  {name}: [CONTENT-ERR] {e}");
                continue;
            }
        };
        let content = match Content::decode(&content_bytes) {
            Ok(c) => c,
            Err(e) => {
                println!("  {name}: [DECODE-ERR] {e}");
                continue;
            }
        };
        let roundtrip_ok = content
            .encode()
            .ok()
            .and_then(|enc| Content::decode(&enc).ok())
            .map(|c2| c2.operations.len() == content.operations.len())
            .unwrap_or(false);

        // Q2/Q3.
        let fonts = font_bytes_per_code(&doc, page_id);
        let w = walk(&content, &fonts);
        let hayro = observe_first_page(&bytes)
            .map(|o| o.texts.len())
            .unwrap_or(0);
        let delta = hayro as i64 - w.glyph_units as i64;

        // Verdict for THIS page: counts agree closely AND no Form XObjects in play.
        let aligned = delta.abs() <= (hayro as i64 / 50).max(2); // within ~2% or 2 glyphs
        let verdict = if !roundtrip_ok {
            "RT-FAIL"
        } else if w.do_ops > 0 {
            "HAS-Do" // text may be drawn from a Form XObject; page-walk under-counts
        } else if aligned {
            "ALIGNED"
        } else {
            "DIVERGED"
        };
        println!(
            "  {:<26} {:>7} {:>7} {:>6} {:>6} {:>5}  {}",
            name, hayro, w.glyph_units, delta, w.type0_units, w.do_ops, verdict
        );
    }

    // ── Q4: excise a target run end-to-end on a simple-font page ─────────────
    println!("\n===== Q4: excise target run end-to-end =====");
    for name in &["basicapi.pdf", "court_ao240.pdf", "gov_irs_w9_acroform.pdf"] {
        println!("\n  --- {name} ---");
        let Ok(bytes) = fs::read(corpus_path(name)) else {
            println!("    [IO-ERR]");
            continue;
        };
        let mut doc = match lopdf::Document::load_mem(&bytes) {
            Ok(d) => d,
            Err(e) => {
                println!("    [LOAD-ERR] {e}");
                continue;
            }
        };
        let Some(page_id) = first_page_id(&doc) else {
            println!("    [NO-PAGES]");
            continue;
        };
        let Ok(content_bytes) = doc.get_page_content(page_id) else {
            println!("    [CONTENT-ERR]");
            continue;
        };
        let mut content = match Content::decode(&content_bytes) {
            Ok(c) => c,
            Err(e) => {
                println!("    [DECODE-ERR] {e}");
                continue;
            }
        };
        let Some(target) = find_target_run(&content) else {
            println!("    [NO-TARGET] no >=5-letter run in a single operand (likely kerned/CID)");
            continue;
        };
        let target_str = String::from_utf8_lossy(&target).to_string();
        let orig_text = doc.extract_text(&[1]).unwrap_or_default();
        let orig_present = orig_text.contains(&target_str);

        if !excise_run(&mut content, &target) {
            println!("    [EXCISE-FAIL] target run not relocated for removal");
            continue;
        }
        let Ok(encoded) = content.encode() else {
            println!("    [ENCODE-ERR]");
            continue;
        };
        // Replace the page content with the edited single stream; keep everything else.
        let new_stream = lopdf::Stream::new(lopdf::Dictionary::new(), encoded);
        let new_id = doc.add_object(new_stream);
        if let Ok(page) = doc.get_dictionary_mut(page_id) {
            page.set("Contents", Object::Reference(new_id));
        }
        let mut out = Vec::new();
        if doc.save_to(&mut out).is_err() {
            println!("    [SAVE-ERR]");
            continue;
        }

        // Verify: target gone from extraction; rest survives; page still renders.
        let reloaded = lopdf::Document::load_mem(&out).unwrap();
        let new_text = reloaded.extract_text(&[1]).unwrap_or_default();
        let target_gone = !new_text.contains(&target_str);
        let rest_survives = new_text.trim().len() > 0;
        let obs = observe_first_page(&out);
        let renders = obs.is_some();
        let rendered_text: String = obs.map(|o| o.texts.concat()).unwrap_or_default();
        let target_not_drawn = !rendered_text.contains(&target_str);
        let widths = any_font_has_widths(&doc, page_id);

        println!("    target run         : {target_str:?}");
        println!("    present originally  : {orig_present}");
        println!("    gone after excise   : {target_gone}  (extraction)");
        println!("    not drawn (render)  : {target_not_drawn}");
        println!("    rest survives       : {rest_survives}  ({} chars remain)", new_text.trim().len());
        println!("    page still renders  : {renders}");
        println!("    Q4b advances avail  : {widths}  (/Widths or /W present → layout-preserving sub possible)");
        let pass = orig_present && target_gone && target_not_drawn && rest_survives && renders;
        println!("    >>> {}", if pass { "PASS" } else { "FAIL" });
    }

    println!("\n===== SPIKE COMPLETE =====\n");
}
