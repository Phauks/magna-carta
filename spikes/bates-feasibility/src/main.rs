//! Bates-numbering feasibility spike — throwaway research code.
//!
//! The decisive question: will a Bates stamp drawn with the base-14 Helvetica
//! font (NO embedded font program) actually RENDER in our own hayro engine? If
//! hayro does not ship the standard fonts, the stamp would be invisible in our
//! preview (only visible in Acrobat) and we would need font embedding or vector
//! outlines instead.
//!
//! Questions:
//!   Q1  hayro draws a base-14 Helvetica text overlay (decisive).
//!   Q2  a corner stamp renders on a /Rotate 90 page (and where it lands).
//!   Q3  a stamp renders on a page with a non-zero MediaBox origin.
//!   Q4  appending a stamp to an EXISTING corpus page (merge font into the page
//!       resources, append content) keeps the original content AND adds the stamp.

use std::fs;
use std::path::{Path, PathBuf};

use hayro::hayro_interpret::font::Glyph;
use hayro::hayro_interpret::hayro_cmap::BfString;
use hayro::hayro_interpret::{
    interpret_page, BlendMode, ClipPath, Context, Device, GlyphDrawMode, Image, InterpreterCache,
    InterpreterSettings, Paint, PathDrawMode, SoftMask, TransformExt,
};
use hayro::hayro_syntax::Pdf;
use hayro::{render, RenderCache, RenderSettings};
use kurbo::{Affine, BezPath, Point, Rect};
use lopdf::{dictionary, Document, Object, Stream};

// ── observing device: collect drawn glyphs (text + device position) ─────────

#[derive(Default)]
struct Observer {
    glyphs: Vec<(String, Point)>,
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
        _: &GlyphDrawMode,
    ) {
        let text = match glyph.as_unicode() {
            Some(BfString::Char(ch)) => ch.to_string(),
            Some(BfString::String(s)) => s,
            None => String::new(),
        };
        let p = (transform * glyph_transform).translation();
        self.glyphs.push((text, Point::new(p.x, p.y)));
    }
}

fn observe(bytes: &[u8]) -> Option<Observer> {
    let pdf = Pdf::new(bytes.to_vec()).ok()?;
    let pages = pdf.pages();
    let page = pages.first()?;
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
    Some(obs)
}

fn recovered(obs: &Observer) -> String {
    obs.glyphs.iter().map(|(t, _)| t.as_str()).collect()
}

// Count non-near-white pixels via a real raster render (pixel backstop for Q1).
fn dark_pixel_count(bytes: &[u8]) -> Option<usize> {
    let pdf = Pdf::new(bytes.to_vec()).ok()?;
    let pages = pdf.pages();
    let page = pages.first()?;
    let png = render(
        page,
        &RenderCache::new(),
        &InterpreterSettings::default(),
        &RenderSettings {
            x_scale: 2.0,
            y_scale: 2.0,
            ..Default::default()
        },
    )
    .into_png()
    .ok()?;
    // crude: count bytes well below white in the PNG's decompressed pixels is hard
    // without an image decoder; instead just report the PNG byte length as a proxy
    // (a blank page compresses tiny; text adds entropy). Good enough as a backstop.
    Some(png.len())
}

// ── build a one-page PDF with a Helvetica stamp ─────────────────────────────

const LABEL: &str = "BATES-000042";

/// One-page PDF: MediaBox `[ox oy ox+W oy+H]`, optional `/Rotate`, a Helvetica
/// font resource, and a content stream drawing LABEL near the lower-left of the
/// unrotated user space (origin-relative).
fn stamp_pdf(width: f32, height: f32, ox: f32, oy: f32, rotate: i64) -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
    });
    // place the label 36pt right of and 24pt up from the MediaBox lower-left
    let x = ox + 36.0;
    let y = oy + 24.0;
    let content = format!("q BT /BatesFont 10 Tf 1 0 0 1 {x} {y} Tm ({LABEL}) Tj ET Q");
    let content_id = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
    let resources = dictionary! {
        "Font" => dictionary! { "BatesFont" => Object::Reference(font_id) },
    };
    let mut page = dictionary! {
        "Type" => "Page",
        "MediaBox" => vec![ox.into(), oy.into(), (ox + width).into(), (oy + height).into()],
        "Resources" => resources,
        "Contents" => Object::Reference(content_id),
    };
    if rotate != 0 {
        page.set("Rotate", Object::Integer(rotate));
    }
    let page_id = doc.add_object(page);
    let pages_id = doc.add_object(dictionary! {
        "Type" => "Pages", "Kids" => vec![Object::Reference(page_id)], "Count" => 1,
    });
    if let Ok(Object::Dictionary(d)) = doc.get_object_mut(page_id) {
        d.set("Parent", Object::Reference(pages_id));
    }
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => Object::Reference(pages_id) });
    doc.trailer.set("Root", Object::Reference(catalog_id));
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

// ── Q4: append a stamp to an existing corpus page ───────────────────────────

fn corpus_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("pdf-engine-eval")
        .join("corpus")
        .join(name)
}

fn resolve_dict_mut_resources(doc: &mut Document, page_id: lopdf::ObjectId) -> lopdf::ObjectId {
    // Ensure the page has its OWN /Resources /Font and return the font dict owner page id.
    // (Spike-simple: assume page-level Resources; the real build reuses surgery's inherited walk.)
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
    });
    if let Ok(page) = doc.get_dictionary(page_id) {
        let mut resources = match page.get(b"Resources") {
            Ok(Object::Dictionary(d)) => d.clone(),
            _ => lopdf::Dictionary::new(),
        };
        let mut fonts = match resources.get(b"Font") {
            Ok(Object::Dictionary(d)) => d.clone(),
            _ => lopdf::Dictionary::new(),
        };
        fonts.set("BatesStampFont", Object::Reference(font_id));
        resources.set("Font", Object::Dictionary(fonts));
        if let Ok(Object::Dictionary(p)) = doc.get_object_mut(page_id) {
            p.set("Resources", Object::Dictionary(resources));
        }
    }
    page_id
}

fn stamp_existing(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut doc = Document::load_mem(bytes).ok()?;
    let page_id = *doc.get_pages().get(&1)?;
    resolve_dict_mut_resources(&mut doc, page_id);
    // Append a stamp content stream after existing content.
    let stamp = format!("q BT /BatesStampFont 10 Tf 1 0 0 1 36 24 Tm ({LABEL}) Tj ET Q");
    let stamp_id = doc.add_object(Stream::new(dictionary! {}, stamp.into_bytes()));
    if let Ok(page) = doc.get_dictionary(page_id) {
        let mut contents: Vec<Object> = match page.get(b"Contents") {
            Ok(Object::Reference(r)) => vec![Object::Reference(*r)],
            Ok(Object::Array(a)) => a.clone(),
            _ => vec![],
        };
        contents.push(Object::Reference(stamp_id));
        if let Ok(Object::Dictionary(p)) = doc.get_object_mut(page_id) {
            p.set("Contents", Object::Array(contents));
        }
    }
    let mut out = Vec::new();
    doc.save_to(&mut out).ok()?;
    Some(out)
}

fn main() {
    println!("\n===== Q1: hayro draws a base-14 Helvetica overlay (DECISIVE) =====");
    let bytes = stamp_pdf(612.0, 792.0, 0.0, 0.0, 0);
    let blank = stamp_pdf_blank(612.0, 792.0);
    match observe(&bytes) {
        Some(obs) => {
            let text = recovered(&obs);
            println!("  glyphs drawn: {}", obs.glyphs.len());
            println!("  recovered text: {text:?}");
            let ok = obs.glyphs.len() >= 10 && text.contains("BATES");
            println!(
                "  >>> {}",
                if ok {
                    "PASS — hayro renders base-14 Helvetica; no font embedding needed for the stamp to show in our engine"
                } else {
                    "FAIL — hayro did NOT draw the base-14 stamp; embedding or vector outlines required"
                }
            );
            if let (Some(a), Some(b)) = (dark_pixel_count(&bytes), dark_pixel_count(&blank)) {
                println!("  pixel backstop: stamped PNG {a} bytes vs blank PNG {b} bytes (stamped should be larger)");
            }
            if let Some((_, p)) = obs.glyphs.first() {
                println!("  first glyph device pos: ({:.1}, {:.1})", p.x, p.y);
            }
        }
        None => println!("  FAIL — could not interpret the stamped PDF at all"),
    }

    println!("\n===== Q2: stamp on a /Rotate 90 page =====");
    let r90 = stamp_pdf(612.0, 792.0, 0.0, 0.0, 90);
    match observe(&r90) {
        Some(obs) => {
            println!(
                "  glyphs drawn: {}  recovered: {:?}",
                obs.glyphs.len(),
                recovered(&obs)
            );
            if let Some((_, p)) = obs.glyphs.first() {
                println!("  first glyph device pos under /Rotate 90: ({:.1}, {:.1})", p.x, p.y);
            }
            println!(
                "  >>> {}",
                if obs.glyphs.len() >= 10 { "PASS — renders under rotation (corner math is the plan's job)" } else { "FAIL" }
            );
        }
        None => println!("  FAIL"),
    }

    println!("\n===== Q3: stamp on a non-zero MediaBox origin =====");
    let off = stamp_pdf(612.0, 792.0, 50.0, 30.0, 0);
    match observe(&off) {
        Some(obs) => println!(
            "  glyphs drawn: {}  recovered: {:?}  >>> {}",
            obs.glyphs.len(),
            recovered(&obs),
            if obs.glyphs.len() >= 10 { "PASS" } else { "FAIL" }
        ),
        None => println!("  FAIL"),
    }

    println!("\n===== Q4: append stamp to an existing corpus page =====");
    for name in &["basicapi.pdf", "court_ao240.pdf"] {
        match fs::read(corpus_path(name)) {
            Err(e) => println!("  {name}: [IO-ERR] {e}"),
            Ok(orig) => {
                let before = observe(&orig).map(|o| o.glyphs.len()).unwrap_or(0);
                match stamp_existing(&orig) {
                    None => println!("  {name}: [STAMP-FAIL]"),
                    Some(stamped) => match observe(&stamped) {
                        None => println!("  {name}: [REOBSERVE-FAIL] stamped page no longer renders"),
                        Some(obs) => {
                            let text = recovered(&obs);
                            let after = obs.glyphs.len();
                            let stamp_present = text.contains("BATES");
                            let original_kept = after >= before; // original glyphs + stamp
                            println!(
                                "  {name}: before {before} glyphs -> after {after}; stamp_present={stamp_present} original_kept={original_kept} >>> {}",
                                if stamp_present && original_kept { "PASS" } else { "FAIL" }
                            );
                        }
                    },
                }
            }
        }
    }

    println!("\n===== SPIKE COMPLETE =====\n");
}

fn stamp_pdf_blank(width: f32, height: f32) -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let content_id = doc.add_object(Stream::new(dictionary! {}, b"".to_vec()));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "MediaBox" => vec![0.into(), 0.into(), width.into(), height.into()],
        "Resources" => dictionary! {},
        "Contents" => Object::Reference(content_id),
    });
    let pages_id = doc.add_object(dictionary! {
        "Type" => "Pages", "Kids" => vec![Object::Reference(page_id)], "Count" => 1,
    });
    if let Ok(Object::Dictionary(d)) = doc.get_object_mut(page_id) {
        d.set("Parent", Object::Reference(pages_id));
    }
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => Object::Reference(pages_id) });
    doc.trailer.set("Root", Object::Reference(catalog_id));
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}
