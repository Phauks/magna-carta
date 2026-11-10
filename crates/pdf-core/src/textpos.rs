//! Observe a page's resolved draw sequence (glyphs + opaque covers, in paint
//! order) via a hayro interpret Device — the text-position primitive the
//! detector consumes. Read-only.

use hayro::hayro_interpret::font::Glyph;
use hayro::hayro_interpret::hayro_cmap::BfString;
use hayro::hayro_interpret::{
    interpret_page, BlendMode, ClipPath, Context, Device, GlyphDrawMode, Image, InterpreterCache,
    InterpreterSettings, Paint, PathDrawMode, SoftMask, TransformExt,
};
use hayro::hayro_syntax::Pdf;
use kurbo::{Affine, BezPath, Rect, Shape};

// GlyphMark, CoverMark, PageObservation, and observe_page are pub(crate) API
// surfaces consumed by detect.rs (bad-redaction detection) and redact.rs (the
// surgery outcome gate).
pub(crate) struct GlyphMark {
    pub text: String,
    pub bbox: Rect,
    pub order: usize,
    pub invisible: bool,
    pub rgba: [u8; 4],
    /// The horizontal span, in the same frame as `bbox`, from the glyph's origin to where
    /// the next glyph starts. `None` when the font declares no advance for it. The inked
    /// outline in `bbox` is narrower than this by the glyph's side bearings, which is what
    /// makes two narrow glyphs (the digits of "11") look further apart than a word break.
    pub advance_span: Option<(f64, f64)>,
    /// The y of the glyph's origin, in the same frame as `bbox`: the baseline it was set
    /// on. Every glyph of a line shares it, whatever its own shape; the bottom of `bbox`
    /// does not, sitting above it for a hyphen or a quotation mark and below it for a
    /// descender.
    pub baseline: f64,
}

pub(crate) struct CoverMark {
    pub bbox: Rect,
    pub order: usize,
    pub rgba: [u8; 4],
    /// True when this cover was produced by a raster image XObject (`draw_image`);
    /// false when produced by a vector path fill (`draw_path`). The surgery outcome
    /// gate uses this to reject image-covers intersecting a redaction rect — a vector
    /// black box drawn over a raster image does not remove the underlying pixels.
    pub is_image: bool,
}

/// Anything the page draws as a path, filled or stroked. A cover asks "does this hide
/// what is under it"; a shape asks the opposite question, "is this itself content", which
/// a redaction has to answer for whatever sits under its box.
pub(crate) struct ShapeMark {
    /// The path's bounds in the same frame as a glyph's `bbox`, widened by half the line
    /// width for a stroke.
    pub bbox: Rect,
    /// True when the path is made only of horizontal and vertical straight lines: a
    /// rectangle, a rule, a table border, a cell's shading. False for anything with a
    /// curve or a slanted line, which is the shape of a signature, a diagram, a logo, or
    /// text that was converted to outlines.
    pub axis_aligned: bool,
}

pub(crate) struct PageObservation {
    pub glyphs: Vec<GlyphMark>,
    pub covers: Vec<CoverMark>,
    pub shapes: Vec<ShapeMark>,
    // width_pt is retained for symmetry and exercised by tests; height_pt drives the
    // display-point y-flip in the detector and the surgery outcome gate.
    #[allow(dead_code)]
    pub width_pt: f32,
    pub height_pt: f32,
}

fn paint_rgba(paint: &Paint) -> [u8; 4] {
    match paint {
        Paint::Color(c) => c.to_rgba().to_rgba8(),
        Paint::Pattern(_) => [0, 0, 0, 255], // treat a pattern fill as opaque for cover purposes
    }
}

#[derive(Default)]
struct Observer {
    order: usize,
    glyphs: Vec<GlyphMark>,
    covers: Vec<CoverMark>,
    shapes: Vec<ShapeMark>,
}

/// How far off horizontal or vertical a line may be, in points, and still count as
/// straight along an axis. Coordinates arrive through a chain of matrix products.
const AXIS_TOLERANCE: f64 = 0.01;

fn is_axis_aligned(path: &BezPath) -> bool {
    let mut start = kurbo::Point::ZERO;
    let mut current = kurbo::Point::ZERO;
    let along_an_axis = |from: kurbo::Point, to: kurbo::Point| {
        (from.x - to.x).abs() <= AXIS_TOLERANCE || (from.y - to.y).abs() <= AXIS_TOLERANCE
    };
    for element in path.elements() {
        match *element {
            kurbo::PathEl::MoveTo(point) => {
                start = point;
                current = point;
            }
            kurbo::PathEl::LineTo(point) => {
                if !along_an_axis(current, point) {
                    return false;
                }
                current = point;
            }
            kurbo::PathEl::ClosePath => {
                if !along_an_axis(current, start) {
                    return false;
                }
                current = start;
            }
            kurbo::PathEl::QuadTo(..) | kurbo::PathEl::CurveTo(..) => return false,
        }
    }
    true
}

impl<'a> Device<'a> for Observer {
    fn set_soft_mask(&mut self, _: Option<SoftMask<'a>>) {}
    fn set_blend_mode(&mut self, _: BlendMode) {}

    fn draw_path(
        &mut self,
        path: &BezPath,
        transform: Affine,
        paint: &Paint<'a>,
        mode: &PathDrawMode,
    ) {
        self.order += 1;
        if !path.elements().is_empty() {
            let mut placed = path.clone();
            placed.apply_affine(transform);
            let half_line = match mode {
                PathDrawMode::Fill(_) => 0.0,
                // The line width is in the path's own space; the transform's area scale
                // brings it to the page's.
                PathDrawMode::Stroke(stroke) => {
                    f64::from(stroke.line_width) * transform.determinant().abs().sqrt() / 2.0
                }
            };
            self.shapes.push(ShapeMark {
                bbox: placed.bounding_box().inflate(half_line, half_line),
                axis_aligned: is_axis_aligned(&placed),
            });
        }
        if let PathDrawMode::Fill(_) = mode {
            let mut p = path.clone();
            p.apply_affine(transform);
            self.covers.push(CoverMark {
                bbox: p.bounding_box(),
                order: self.order,
                rgba: paint_rgba(paint),
                is_image: false,
            });
        }
    }

    fn push_clip_path(&mut self, _: &ClipPath) {}
    fn push_transparency_group(&mut self, _: f32, _: Option<SoftMask<'a>>, _: BlendMode) {}

    fn draw_glyph(
        &mut self,
        glyph: &Glyph<'a>,
        transform: Affine,
        glyph_transform: Affine,
        paint: &Paint<'a>,
        mode: &GlyphDrawMode,
    ) {
        self.order += 1;
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
        let advance_span = match glyph {
            Glyph::Outline(outline) => outline.advance_width().map(|advance| {
                let origin = matrix * kurbo::Point::new(0.0, 0.0);
                let end = matrix * kurbo::Point::new(f64::from(advance), 0.0);
                (origin.x.min(end.x), origin.x.max(end.x))
            }),
            Glyph::Type3(_) => None,
        };
        self.glyphs.push(GlyphMark {
            text,
            baseline: (matrix * kurbo::Point::new(0.0, 0.0)).y,
            bbox,
            order: self.order,
            invisible: matches!(mode, GlyphDrawMode::Invisible),
            rgba: paint_rgba(paint),
            advance_span,
        });
    }

    fn draw_image(&mut self, image: Image<'a, '_>, transform: Affine) {
        self.order += 1;
        // The transform for an image maps its pixel space -- `[0, width] x [0, height]` --
        // to device space, because the interpreter pre-concatenates a `1/width, -1/height`
        // normalization before handing it over (a Form XObject, by contrast, is already in
        // unit space). Transforming the unit square here would measure a single pixel and
        // undercount every multi-pixel image cover by a factor of width*height: a full-page
        // scan would read as a sliver, defeating both the raster-coverage signal and the
        // rule that a redaction box drawn over an image does not remove its pixels.
        let mut p = Rect::new(0.0, 0.0, image.width() as f64, image.height() as f64).to_path(0.1);
        p.apply_affine(transform);
        self.covers.push(CoverMark {
            bbox: p.bounding_box(),
            order: self.order,
            rgba: [0, 0, 0, 255],
            is_image: true,
        });
    }

    fn pop_clip_path(&mut self) {}
    fn pop_transparency_group(&mut self) {}
}

/// Everything the page shows: its own content and its annotations' appearances.
pub(crate) fn observe_page(pdf: &Pdf, index: usize) -> Option<PageObservation> {
    observe(pdf, index, true)
}

/// The page's own content, without its annotations. An annotation over a redaction is
/// removed as an object, by the code that handles annotations, so what its appearance
/// draws is not something a rewrite of the page's content leaves behind.
pub(crate) fn observe_page_content(pdf: &Pdf, index: usize) -> Option<PageObservation> {
    observe(pdf, index, false)
}

fn observe(pdf: &Pdf, index: usize, render_annotations: bool) -> Option<PageObservation> {
    let pages = pdf.pages();
    let page = pages.get(index)?;
    let (width_pt, height_pt) = page.render_dimensions();
    let initial_transform = page.initial_transform(true).to_kurbo();
    let cache = InterpreterCache::new();
    let mut ctx = Context::new(
        initial_transform,
        Rect::new(0.0, 0.0, width_pt as f64, height_pt as f64),
        &cache,
        page.xref(),
        InterpreterSettings {
            render_annotations,
            ..InterpreterSettings::default()
        },
    );
    let mut obs = Observer::default();
    interpret_page(page, &mut ctx, &mut obs);
    Some(PageObservation {
        glyphs: obs.glyphs,
        covers: obs.covers,
        shapes: obs.shapes,
        width_pt,
        height_pt,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use hayro::hayro_syntax::Pdf;

    fn corpus() -> Vec<u8> {
        // A small text-bearing PDF with embedded fonts.
        include_bytes!("../tests/fixtures/hello.pdf").to_vec()
    }

    #[test]
    fn observes_glyphs_with_text_and_bbox() {
        let pdf = Pdf::new(corpus()).unwrap();
        let obs = observe_page(&pdf, 0).expect("observe");
        let recovered: String = obs.glyphs.iter().map(|g| g.text.as_str()).collect();
        assert!(
            recovered.contains("Hello"),
            "recovered text was {recovered:?}"
        );
        // Every glyph has a finite, non-degenerate bbox.
        assert!(obs
            .glyphs
            .iter()
            .any(|g| g.bbox.width() > 0.0 && g.bbox.height() > 0.0));
        assert!(obs.width_pt > 0.0 && obs.height_pt > 0.0);
    }
}
