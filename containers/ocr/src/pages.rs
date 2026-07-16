//! Turning a PDF page into pixels and the engine's pixel coordinates back into PDF
//! user space. The two coordinate systems disagree about where the origin is and
//! which way y grows, and getting that wrong puts every word box on the wrong half
//! of the page.

use ocr_core::Quad;

/// Rasterization density. 300 DPI is the floor at which small print in a scanned
/// exhibit stays legible to the recognizer.
pub const RENDER_DPI: f32 = 300.0;

/// The density below which recognition is not worth attempting. A page so large that it
/// cannot be rastered above this within the pixel budget is refused outright rather than
/// recognized into confident-looking nonsense: at 72 DPI, body text is a few pixels tall
/// and the engine will read words that are not there. Refusing is the honest answer.
pub const MIN_RENDER_DPI: f32 = 100.0;

/// The density at which to raster a page of `width_pt` x `height_pt`: the full
/// [`RENDER_DPI`], or the highest density that fits [`pdf_core::MAX_RENDER_PIXELS`] if the
/// page is too large to hold at 300 DPI. `None` when even [`MIN_RENDER_DPI`] would not fit.
///
/// Scaling down rather than refusing is what keeps a genuine outsize exhibit -- an E-size
/// survey or CAD drawing, routine in construction and land litigation -- readable instead
/// of rejected, while a page whose declared geometry is a memory bomb still gets no raster
/// at all.
pub fn render_dpi_for(width_pt: f32, height_pt: f32) -> Option<f32> {
    if pdf_core::rendered_pixels(width_pt, height_pt, RENDER_DPI) <= pdf_core::MAX_RENDER_PIXELS {
        return Some(RENDER_DPI);
    }
    // pixels(dpi) scales with dpi^2, so the density that exactly fills the budget is the
    // current density times the square root of the ratio of budget to demand.
    let demanded = pdf_core::rendered_pixels(width_pt, height_pt, RENDER_DPI) as f64;
    if demanded <= 0.0 {
        return Some(RENDER_DPI);
    }
    let ratio = (pdf_core::MAX_RENDER_PIXELS as f64) / demanded;
    let fitted = (RENDER_DPI as f64) * ratio.sqrt();
    // Round down before the floor test: the ceil() inside `rendered_pixels` can push a
    // dpi that fits in exact arithmetic one pixel-row over the budget.
    let fitted = fitted.floor() as f32;
    if !fitted.is_finite() || fitted < MIN_RENDER_DPI {
        return None;
    }
    Some(fitted)
}

/// Convert a quad in render-pixel coordinates (origin top-left, y grows downward) to
/// PDF user space (origin bottom-left, y grows upward, 72 units per inch). `dpi` must be
/// the density the page was actually rastered at -- which is not always [`RENDER_DPI`],
/// since an outsize page is rastered at whatever density fit its pixel budget.
pub fn to_user_space(quad: Quad, page_height_points: f32, dpi: f32) -> Quad {
    let scale = 72.0 / dpi;
    Quad {
        points: quad
            .points
            .map(|(x, y)| (x * scale, page_height_points - y * scale)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_origin_flips_from_top_left_to_bottom_left() {
        // A 792-point-tall page rendered at 300 DPI is 3300 pixels tall. A quad hugging
        // the top of the raster must land at the top of user space, i.e. y near 792.
        let quad = Quad {
            points: [(0.0, 0.0), (100.0, 0.0), (100.0, 50.0), (0.0, 50.0)],
        };
        let converted = to_user_space(quad, 792.0, RENDER_DPI);
        let (_, y_min, _, y_max) = converted.bounds();
        assert!(
            (y_max - 792.0).abs() < 0.01,
            "top of raster must be top of page: {y_max}"
        );
        assert!(
            (y_min - 780.0).abs() < 0.01,
            "50px = 12pt below the top: {y_min}"
        );
    }

    #[test]
    fn an_ordinary_page_renders_at_the_full_density() {
        // US Letter at 300 DPI is 2550x3300 = 8.4M pixels, far inside the budget.
        assert_eq!(render_dpi_for(612.0, 792.0), Some(RENDER_DPI));
    }

    #[test]
    fn an_outsize_exhibit_is_scaled_down_rather_than_refused() {
        // A 36x48in E-size survey drawing: 2592x3456pt. At 300 DPI that is 155M pixels,
        // past the budget -- but it is a real document a firm will really file, so it is
        // rastered at whatever density fits instead of being rejected.
        let dpi = render_dpi_for(2592.0, 3456.0).expect("an E-size exhibit must still render");
        assert!(
            dpi < RENDER_DPI && dpi >= MIN_RENDER_DPI,
            "expected a reduced but usable density, got {dpi}"
        );
        assert!(
            pdf_core::rendered_pixels(2592.0, 3456.0, dpi) <= pdf_core::MAX_RENDER_PIXELS,
            "the fitted density must actually fit the budget"
        );
    }

    #[test]
    fn a_geometry_bomb_gets_no_density_at_all() {
        // 200x200 inches. Fitting this inside the pixel budget would mean rastering at
        // ~45 DPI, at which the recognizer reads words that are not there. Refusing is
        // the honest answer; a confident transcript of noise is the dangerous one.
        assert_eq!(render_dpi_for(14400.0, 14400.0), None);
    }

    #[test]
    fn a_word_box_lands_in_user_space_at_a_reduced_density_too() {
        // The transform must use the density the page was actually rastered at. Wiring it
        // to the 300 DPI constant would put every box on an outsize page in the wrong
        // place -- and silently, since the numbers still look plausible.
        let quad = Quad {
            points: [(0.0, 0.0), (150.0, 0.0), (150.0, 0.0), (0.0, 0.0)],
        };
        // 150px at 150 DPI is one inch, which is 72 points.
        let (_, _, x_max, _) = to_user_space(quad, 792.0, 150.0).bounds();
        assert!((x_max - 72.0).abs() < 0.01, "expected 72pt, got {x_max}");
    }

    #[test]
    fn pixels_scale_down_by_seventy_two_over_the_render_dpi() {
        // 300 px at 300 DPI is one inch, which is 72 points.
        let quad = Quad {
            points: [(0.0, 0.0), (300.0, 0.0), (300.0, 0.0), (0.0, 0.0)],
        };
        let (x_min, _, x_max, _) = to_user_space(quad, 792.0, RENDER_DPI).bounds();
        assert!((x_min - 0.0).abs() < 0.01);
        assert!(
            (x_max - 72.0).abs() < 0.01,
            "300px at 300dpi is 72pt, got {x_max}"
        );
    }
}
