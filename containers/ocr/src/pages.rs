//! Turning a PDF page into pixels and the engine's pixel coordinates back into PDF
//! user space. The two coordinate systems disagree about where the origin is and
//! which way y grows, and getting that wrong puts every word box on the wrong half
//! of the page.

use ocr_core::Quad;

/// Rasterization density. 300 DPI is the floor at which small print in a scanned
/// exhibit stays legible to the recognizer.
pub const RENDER_DPI: f32 = 300.0;

/// Convert a quad in render-pixel coordinates (origin top-left, y grows downward) to
/// PDF user space (origin bottom-left, y grows upward, 72 units per inch).
pub fn to_user_space(quad: Quad, page_height_points: f32) -> Quad {
    let scale = 72.0 / RENDER_DPI;
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
        let converted = to_user_space(quad, 792.0);
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
    fn pixels_scale_down_by_seventy_two_over_the_render_dpi() {
        // 300 px at 300 DPI is one inch, which is 72 points.
        let quad = Quad {
            points: [(0.0, 0.0), (300.0, 0.0), (300.0, 0.0), (0.0, 0.0)],
        };
        let (x_min, _, x_max, _) = to_user_space(quad, 792.0).bounds();
        assert!((x_min - 0.0).abs() < 0.01);
        assert!(
            (x_max - 72.0).abs() < 0.01,
            "300px at 300dpi is 72pt, got {x_max}"
        );
    }
}
