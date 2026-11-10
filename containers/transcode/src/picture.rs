//! Turning a decoded picture of any supported shape (8, 10 or 12 bits; 4:2:0, 4:2:2 or 4:4:4) into
//! the 8-bit 4:2:0 picture the H.264 encoder takes, at the rendition's size.

use crate::error::{Result, TranscodeError};

/// A decoded plane's samples as the decoders hand them over.
pub enum Samples<'a> {
    /// One byte per sample.
    Bytes(&'a [u8]),
    /// Two bytes per sample, little-endian (the H.264 decoder's layout above 8 bits).
    LittleEndianWords(&'a [u8]),
    /// One `u16` per sample (the HEVC decoder's layout above 8 bits).
    Words(&'a [u16]),
}

pub struct SourcePlane<'a> {
    pub samples: Samples<'a>,
    pub width: usize,
    pub height: usize,
    pub bit_depth: u8,
}

impl SourcePlane<'_> {
    fn check(&self) -> Result<()> {
        let expected = self.width * self.height;
        let actual = match self.samples {
            Samples::Bytes(bytes) => bytes.len(),
            Samples::LittleEndianWords(bytes) => bytes.len() / 2,
            Samples::Words(words) => words.len(),
        };
        if actual < expected || !(8..=16).contains(&self.bit_depth) {
            return Err(TranscodeError::malformed(
                "a decoded plane does not match its stated size",
            ));
        }
        Ok(())
    }

    /// The sample at a position, on the 8-bit scale.
    fn value(&self, x: usize, y: usize) -> f32 {
        let index = y * self.width + x;
        let raw = match self.samples {
            Samples::Bytes(bytes) => f32::from(bytes.get(index).copied().unwrap_or(0)),
            Samples::LittleEndianWords(bytes) => {
                let low = bytes.get(index * 2).copied().unwrap_or(0);
                let high = bytes.get(index * 2 + 1).copied().unwrap_or(0);
                f32::from(u16::from_le_bytes([low, high]))
            }
            Samples::Words(words) => f32::from(words.get(index).copied().unwrap_or(0)),
        };
        raw / (1u32 << (self.bit_depth - 8)) as f32
    }
}

/// An 8-bit 4:2:0 picture.
pub struct Picture {
    pub width: usize,
    pub height: usize,
    pub luma: Vec<u8>,
    pub blue_difference: Vec<u8>,
    pub red_difference: Vec<u8>,
}

/// Per-output-sample filter taps along one axis: a triangle filter widened by the reduction factor,
/// so a large reduction averages every source sample it covers instead of aliasing.
struct Axis {
    taps: Vec<(usize, Vec<f32>)>,
}

impl Axis {
    fn new(source: usize, target: usize) -> Self {
        let scale = source as f32 / target as f32;
        let support = scale.max(1.0);
        let last = source.saturating_sub(1) as f32;
        let taps = (0..target)
            .map(|output| {
                let center = (output as f32 + 0.5) * scale - 0.5;
                let low = (center - support).floor().max(0.0) as usize;
                let high = (center + support).ceil().min(last) as usize;
                let mut weights: Vec<f32> = (low..=high)
                    .map(|position| (1.0 - (position as f32 - center).abs() / support).max(0.0))
                    .collect();
                let total: f32 = weights.iter().sum();
                if total > 0.0 {
                    weights.iter_mut().for_each(|weight| *weight /= total);
                } else {
                    weights = vec![0.0; high - low + 1];
                    let nearest = (center.round().clamp(0.0, last) as usize).saturating_sub(low);
                    if let Some(weight) = weights.get_mut(nearest) {
                        *weight = 1.0;
                    }
                }
                (low, weights)
            })
            .collect();
        Self { taps }
    }
}

fn resample(plane: &SourcePlane<'_>, width: usize, height: usize) -> Vec<u8> {
    // Fast path: same size and already 8-bit.
    if plane.width == width && plane.height == height {
        if let Samples::Bytes(bytes) = plane.samples {
            return bytes
                .get(..width * height)
                .map(<[u8]>::to_vec)
                .unwrap_or_default();
        }
    }
    let horizontal = Axis::new(plane.width, width);
    let vertical = Axis::new(plane.height, height);
    let mut rows = vec![0f32; width * plane.height];
    let mut source_row = vec![0f32; plane.width];
    for y in 0..plane.height {
        for (x, slot) in source_row.iter_mut().enumerate() {
            *slot = plane.value(x, y);
        }
        for (x, (start, weights)) in horizontal.taps.iter().enumerate() {
            let taps = source_row
                .get(*start..*start + weights.len())
                .unwrap_or_default();
            let sum: f32 = taps
                .iter()
                .zip(weights)
                .map(|(value, weight)| value * weight)
                .sum();
            if let Some(slot) = rows.get_mut(y * width + x) {
                *slot = sum;
            }
        }
    }
    let mut out = vec![0u8; width * height];
    for (y, (start, weights)) in vertical.taps.iter().enumerate() {
        for x in 0..width {
            let mut sum = 0f32;
            for (offset, weight) in weights.iter().enumerate() {
                sum += rows
                    .get((start + offset) * width + x)
                    .copied()
                    .unwrap_or(0.0)
                    * weight;
            }
            if let Some(slot) = out.get_mut(y * width + x) {
                *slot = sum.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

/// Convert three decoded planes into an 8-bit 4:2:0 picture of `width` by `height` (both even).
pub fn convert(
    luma: &SourcePlane<'_>,
    blue_difference: &SourcePlane<'_>,
    red_difference: &SourcePlane<'_>,
    width: usize,
    height: usize,
) -> Result<Picture> {
    luma.check()?;
    blue_difference.check()?;
    red_difference.check()?;
    Ok(Picture {
        width,
        height,
        luma: resample(luma, width, height),
        blue_difference: resample(blue_difference, width / 2, height / 2),
        red_difference: resample(red_difference, width / 2, height / 2),
    })
}

/// The rendition's picture size: the source's, scaled down (never up) to fit the viewing-copy box,
/// rounded down to even numbers because 4:2:0 halves both.
pub fn output_size(width: u32, height: u32, long_side: u32, short_side: u32) -> (usize, usize) {
    let (box_width, box_height) = if width >= height {
        (long_side, short_side)
    } else {
        (short_side, long_side)
    };
    let scale = (f64::from(box_width) / f64::from(width.max(1)))
        .min(f64::from(box_height) / f64::from(height.max(1)))
        .min(1.0);
    let even = |value: f64| ((value.floor() as usize) & !1).max(2);
    (
        even(f64::from(width) * scale),
        even(f64::from(height) * scale),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_size_keeps_small_pictures_and_fits_large_ones() {
        assert_eq!(output_size(640, 360, 1920, 1080), (640, 360));
        assert_eq!(output_size(3840, 2160, 1920, 1080), (1920, 1080));
        assert_eq!(output_size(2160, 3840, 1920, 1080), (1080, 1920));
        assert_eq!(output_size(641, 361, 1920, 1080), (640, 360));
    }

    #[test]
    fn ten_bit_planes_land_on_the_eight_bit_scale() {
        let words = vec![512u16; 4 * 4];
        let chroma = vec![512u16; 2 * 2];
        let plane = |data: &'static [u16], size: usize| SourcePlane {
            samples: Samples::Words(data),
            width: size,
            height: size,
            bit_depth: 10,
        };
        let words: &'static [u16] = Box::leak(words.into_boxed_slice());
        let chroma: &'static [u16] = Box::leak(chroma.into_boxed_slice());
        let picture =
            convert(&plane(words, 4), &plane(chroma, 2), &plane(chroma, 2), 4, 4).unwrap();
        assert!(picture.luma.iter().all(|&value| value == 128));
        assert_eq!(picture.blue_difference.len(), 4);
    }

    #[test]
    fn halving_averages_neighbours() {
        let bytes: Vec<u8> = vec![0, 255, 0, 255, 0, 255, 0, 255];
        let plane = SourcePlane {
            samples: Samples::Bytes(&bytes),
            width: 4,
            height: 2,
            bit_depth: 8,
        };
        let out = resample(&plane, 2, 1);
        assert!(
            out.iter().all(|&value| (100..=155).contains(&value)),
            "{out:?}"
        );
    }

    #[test]
    fn a_short_plane_is_refused() {
        let bytes = vec![0u8; 3];
        let plane = SourcePlane {
            samples: Samples::Bytes(&bytes),
            width: 2,
            height: 2,
            bit_depth: 8,
        };
        assert!(convert(&plane, &plane, &plane, 2, 2).is_err());
    }
}
