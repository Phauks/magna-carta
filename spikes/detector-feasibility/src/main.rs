// Feasibility spike for the bad-redaction detector (slice 3).
//
// Proves the flagship "covered text" detector end-to-end: observe the resolved
// draw sequence via a hayro_interpret Device, then flag visible+extractable
// glyphs that sit under a later opaque cover. Also exercises invisible-text
// (Tr 3) detection. Control = the original PDF (expect zero findings); Bad = the
// same PDF with an opaque black rectangle injected over the upper text band
// (expect findings — the classic failed redaction).

use hayro::hayro_interpret::font::Glyph;
use hayro::hayro_interpret::hayro_cmap::BfString;
use hayro::hayro_interpret::{
    interpret_page, BlendMode, ClipPath, Context, Device, GlyphDrawMode, Image, InterpreterCache,
    InterpreterSettings, Paint, PathDrawMode, SoftMask, TransformExt,
};
use hayro::hayro_syntax::Pdf;
use kurbo::{Affine, BezPath, Point, Rect, Shape};

struct GlyphRec {
    text: String,
    bbox: Rect,
    order: usize,
    invisible: bool,
}

struct CoverRec {
    bbox: Rect,
    order: usize,
    rgba: [u8; 4],
}

#[derive(Default)]
struct Observer {
    order: usize,
    glyphs: Vec<GlyphRec>,
    covers: Vec<CoverRec>,
}

impl<'a> Device<'a> for Observer {
    fn set_soft_mask(&mut self, _: Option<SoftMask<'a>>) {}
    fn set_blend_mode(&mut self, _: BlendMode) {}

    fn draw_path(&mut self, path: &BezPath, transform: Affine, paint: &Paint<'a>, mode: &PathDrawMode) {
        self.order += 1;
        if let PathDrawMode::Fill(_) = mode {
            if let Paint::Color(c) = paint {
                let rgba = c.to_rgba().to_rgba8();
                let mut p = path.clone();
                p.apply_affine(transform);
                self.covers.push(CoverRec { bbox: p.bounding_box(), order: self.order, rgba });
            }
        }
    }

    fn push_clip_path(&mut self, _: &ClipPath) {}
    fn push_transparency_group(&mut self, _: f32, _: Option<SoftMask<'a>>, _: BlendMode) {}

    fn draw_glyph(
        &mut self,
        glyph: &Glyph<'a>,
        transform: Affine,
        glyph_transform: Affine,
        _paint: &Paint<'a>,
        mode: &GlyphDrawMode,
    ) {
        self.order += 1;
        let text = match glyph.as_unicode() {
            Some(BfString::Char(ch)) => ch.to_string(),
            Some(BfString::String(s)) => s,
            None => String::new(),
        };
        // hayro draws the glyph as `transform * glyph_transform * outline`
        // (renderer composition). Compute the glyph's page-space bbox the same way.
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
        self.glyphs.push(GlyphRec {
            text,
            bbox,
            order: self.order,
            invisible: matches!(mode, GlyphDrawMode::Invisible),
        });
    }

    fn draw_image(&mut self, _image: Image<'a, '_>, transform: Affine) {
        self.order += 1;
        // An image placement maps the unit square to page space; treat as an
        // opaque cover for the spike (a redaction-by-image is opaque).
        let mut p = Rect::new(0.0, 0.0, 1.0, 1.0).to_path(0.1);
        p.apply_affine(transform);
        self.covers.push(CoverRec { bbox: p.bounding_box(), order: self.order, rgba: [0, 0, 0, 255] });
    }

    fn pop_clip_path(&mut self) {}
    fn pop_transparency_group(&mut self) {}
}

/// Observe one page's resolved draw sequence.
fn observe(bytes: &[u8]) -> Option<Observer> {
    let pdf = Pdf::new(bytes.to_vec()).ok()?;
    let pages = pdf.pages();
    let page = pages.get(0)?;
    let (w, h) = page.render_dimensions();
    let initial_transform = page.initial_transform(true).to_kurbo();
    let cache = InterpreterCache::new();
    let mut ctx = Context::new(
        initial_transform,
        Rect::new(0.0, 0.0, w as f64, h as f64),
        &cache,
        page.xref(),
        InterpreterSettings::default(),
    );
    let mut obs = Observer::default();
    interpret_page(page, &mut ctx, &mut obs);
    Some(obs)
}

/// Visible + extractable glyphs sitting under a later opaque cover.
fn covered_text(obs: &Observer) -> Vec<String> {
    let mut hits = Vec::new();
    for g in &obs.glyphs {
        if g.invisible || g.text.trim().is_empty() {
            continue;
        }
        let center = g.bbox.center();
        let under_cover = obs
            .covers
            .iter()
            .any(|c| c.order > g.order && c.rgba[3] >= 250 && c.bbox.contains(center));
        if under_cover {
            hits.push(g.text.clone());
        }
    }
    hits
}

fn invisible_text(obs: &Observer) -> Vec<String> {
    obs.glyphs
        .iter()
        .filter(|g| g.invisible && !g.text.trim().is_empty())
        .map(|g| g.text.clone())
        .collect()
}

fn run(bytes: &[u8], label: &str) -> usize {
    let obs = match observe(bytes) {
        Some(o) => o,
        None => {
            println!("[{label}] PARSE FAILED");
            return 0;
        }
    };
    let covered = covered_text(&obs);
    let invisible = invisible_text(&obs);
    println!(
        "[{label}] glyphs={} covers={} | covered-text findings={} invisible-text findings={}",
        obs.glyphs.len(),
        obs.covers.len(),
        covered.len(),
        invisible.len()
    );
    if let Some(c) = obs.covers.first() {
        println!(
            "    cover[0] bbox=({:.1},{:.1})..({:.1},{:.1}) rgba={:?} order={}",
            c.bbox.x0, c.bbox.y0, c.bbox.x1, c.bbox.y1, c.rgba, c.order
        );
    }
    for g in obs.glyphs.iter().filter(|g| !g.text.trim().is_empty()).take(4) {
        let cc = g.bbox.center();
        println!("    glyph {:?} center=({:.1},{:.1}) order={}", g.text, cc.x, cc.y, g.order);
    }
    if !covered.is_empty() {
        let sample: String = covered.iter().take(40).cloned().collect();
        println!("    recovered-under-cover sample: {sample:?}");
    }
    covered.len()
}

/// Inject an opaque black rectangle (given as a content fragment) over the page,
/// leaving the text operators intact — the classic failed redaction.
fn inject_cover(orig: &[u8], content: &[u8]) -> Vec<u8> {
    let mut doc = lopdf::Document::load_mem(orig).expect("load");
    let page_id = *doc.get_pages().get(&1).expect("page 1");
    let cover = content.to_vec();
    let cover_id = doc.add_object(lopdf::Stream::new(lopdf::Dictionary::new(), cover));
    let mut contents: Vec<lopdf::Object> = match doc.get_dictionary(page_id).unwrap().get(b"Contents") {
        Ok(lopdf::Object::Array(a)) => a.clone(),
        Ok(lopdf::Object::Reference(r)) => vec![lopdf::Object::Reference(*r)],
        _ => Vec::new(),
    };
    contents.push(lopdf::Object::Reference(cover_id));
    doc.get_dictionary_mut(page_id)
        .unwrap()
        .set("Contents", lopdf::Object::Array(contents));
    let mut out = Vec::new();
    doc.save_to(&mut out).expect("save");
    out
}

fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "../pdf-engine-eval/corpus/basicapi.pdf".to_string());
    let orig = std::fs::read(&path).unwrap_or_else(|_| panic!("read {path}"));

    println!("== Bad-redaction detector feasibility ==");
    let control = run(&orig, "control (original)");
    // Partial band over the title row (PDF user space, bottom-left origin).
    let partial = inject_cover(&orig, b"q 0 0 0 rg 0 745 595 30 re f Q");
    let partial_hits = run(&partial, "bad (partial band over title)");
    // Full-page cover.
    let full = inject_cover(&orig, b"q 0 0 0 rg 0 0 700 900 re f Q");
    let full_hits = run(&full, "bad (full-page cover)");

    println!("\nVERDICT:");
    let selective = partial_hits > 0 && partial_hits < full_hits;
    if control == 0 && full_hits > 0 && selective {
        println!(
            "  GO — covered-text detection works: control clean (0), partial band selective ({partial_hits}), full-page ({full_hits}). Text recovered from under the cover."
        );
    } else {
        println!("  CHECK — control={control}, partial={partial_hits}, full={full_hits} (expected control=0, 0<partial<full).");
    }
}
