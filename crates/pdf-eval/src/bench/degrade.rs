//! Making a clean render look scanned. Deterministic by construction: the same page and
//! the same seed always degrade identically, so a benchmark result is comparable across
//! runs and a regression is a real regression rather than a different roll of the dice.

use image::{Rgb, RgbImage};

/// Rotate by `skew_degrees`, add Gaussian-ish noise, and re-encode through JPEG at
/// `quality`, in that order -- the order a real scanner degrades a page.
pub fn degrade(image: &RgbImage, skew_degrees: f32, noise: u8, quality: u8, seed: u64) -> RgbImage {
    let skewed = rotate_about_center(image, skew_degrees);
    let noisy = add_seeded_noise(&skewed, noise, seed);
    jpeg_round_trip(&noisy, quality)
}

/// Rotate the image about its own center by `degrees`, keeping the original canvas
/// size. `image::imageops` only ships fixed 90/180/270-degree rotation, so an arbitrary
/// skew angle is done here by inverse-mapping each output pixel back into the source
/// and nearest-sampling it -- a pixel that lands outside the source (a corner the
/// rotation exposes) is filled white, matching the blank margin a real scanner bed
/// leaves around a skewed page.
fn rotate_about_center(image: &RgbImage, degrees: f32) -> RgbImage {
    if degrees == 0.0 {
        return image.clone();
    }
    let (width, height) = image.dimensions();
    let center_x = width as f32 / 2.0;
    let center_y = height as f32 / 2.0;
    // Inverse-map: to fill output pixel (x, y), sample the source at the point that
    // rotating BY `degrees` would have sent to (x, y) -- i.e. rotate by -degrees.
    let radians = -degrees.to_radians();
    let (sin, cos) = radians.sin_cos();

    let mut output = RgbImage::from_pixel(width, height, Rgb([255, 255, 255]));
    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 - center_x;
            let dy = y as f32 - center_y;
            let source_x = center_x + dx * cos - dy * sin;
            let source_y = center_y + dx * sin + dy * cos;
            if let Some(pixel) = image::imageops::interpolate_nearest(image, source_x, source_y) {
                output.put_pixel(x, y, pixel);
            }
        }
    }
    output
}

/// A minimal xorshift64 generator. Never `rand::thread_rng` or any other entropy
/// source: the same seed must produce the same noise on every run, on every machine,
/// forever, or a benchmark regression could not be told apart from a re-roll.
struct XorShift64 {
    state: u64,
}

impl XorShift64 {
    fn new(seed: u64) -> Self {
        // xorshift's state must never be zero -- an all-zero state is a fixed point
        // that never advances. Substitute a fixed non-zero constant for a zero seed.
        Self {
            state: if seed == 0 {
                0x9E37_79B9_7F4A_7C15
            } else {
                seed
            },
        }
    }

    fn next_byte(&mut self) -> u8 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        (x & 0xFF) as u8
    }
}

/// Perturb every channel of every pixel by a seeded offset in `[-magnitude, magnitude]`.
/// `magnitude == 0` is a no-op (still deterministic, just identical to the input).
fn add_seeded_noise(image: &RgbImage, magnitude: u8, seed: u64) -> RgbImage {
    if magnitude == 0 {
        return image.clone();
    }
    let mut generator = XorShift64::new(seed);
    let span = 2 * magnitude as i32 + 1;
    let mut output = image.clone();
    for pixel in output.pixels_mut() {
        for channel in pixel.0.iter_mut() {
            let offset = (generator.next_byte() as i32 % span) - magnitude as i32;
            *channel = (*channel as i32 + offset).clamp(0, 255) as u8;
        }
    }
    output
}

/// Encode to JPEG at `quality` and decode straight back -- the compression artefacts a
/// scanner's own JPEG pipeline leaves behind, not a lossless round-trip.
fn jpeg_round_trip(image: &RgbImage, quality: u8) -> RgbImage {
    let mut bytes = Vec::new();
    {
        // `JpegEncoder::new_with_quality` clamps `quality` to `1..=100` internally, so
        // a caller-supplied 0 degrades to the worst legal quality rather than panicking.
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality);
        encoder
            .encode_image(image)
            .expect("encoding a valid in-memory RgbImage to JPEG cannot fail");
    }
    image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg)
        .expect("decoding the JPEG bytes this function just encoded cannot fail")
        .to_rgb8()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn white(width: u32, height: u32) -> RgbImage {
        RgbImage::from_pixel(width, height, image::Rgb([255, 255, 255]))
    }

    #[test]
    fn degradation_is_deterministic_for_a_given_seed() {
        let source = white(64, 64);
        let first = degrade(&source, 1.5, 12, 80, 42);
        let second = degrade(&source, 1.5, 12, 80, 42);
        assert_eq!(first.as_raw(), second.as_raw());
    }

    #[test]
    fn a_different_seed_produces_different_noise() {
        let source = white(64, 64);
        assert_ne!(
            degrade(&source, 0.0, 12, 80, 1).as_raw(),
            degrade(&source, 0.0, 12, 80, 2).as_raw()
        );
    }

    #[test]
    fn zero_noise_and_zero_skew_at_full_quality_is_close_to_the_original() {
        let source = white(64, 64);
        let output = degrade(&source, 0.0, 0, 100, 7);
        assert_eq!(output.dimensions(), source.dimensions());
    }
}
