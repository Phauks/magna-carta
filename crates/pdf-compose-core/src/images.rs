//! Pictures: reading one's size before layout, and turning it into what the writer embeds
//! once layout has said how large it is drawn.
//!
//! The two are separate on purpose. Layout needs only a width and a height, which the file's
//! header gives without decoding a pixel, so a document of fifty photographs never holds
//! fifty decoded photographs at once: each is decoded, scaled and embedded on its own.

use std::io::Cursor;

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};

use crate::layout::ImageSize;

/// The widest or tallest picture read at all. A camera's largest frame is well inside this;
/// a file that claims more is refused before any pixel is allocated.
const MAXIMUM_PIXEL_DIMENSION: u32 = 20_000;
/// The most memory one picture's decoding may ask for.
#[cfg(not(target_arch = "wasm32"))]
const MAXIMUM_DECODE_BYTES: u64 = 512 * 1024 * 1024;
/// A WebAssembly host has far less to give: a Worker's whole isolate is 128 MiB, and running
/// out of memory there ends the request with nothing to catch. 64 MiB still decodes a
/// 16-megapixel photograph.
#[cfg(target_arch = "wasm32")]
const MAXIMUM_DECODE_BYTES: u64 = 64 * 1024 * 1024;
/// Pixels kept per inch of drawn size. Print resolution; more than this adds file size and
/// nothing a printer or a screen can show.
const EMBEDDED_PIXELS_PER_INCH: f32 = 300.0;
const JPEG_QUALITY: u8 = 88;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ImageFailure {
    Unreadable,
    TooLarge,
}

fn limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAXIMUM_PIXEL_DIMENSION);
    limits.max_image_height = Some(MAXIMUM_PIXEL_DIMENSION);
    limits.max_alloc = Some(MAXIMUM_DECODE_BYTES);
    limits
}

fn failure(error: &image::ImageError) -> ImageFailure {
    match error {
        image::ImageError::Limits(_) => ImageFailure::TooLarge,
        _ => ImageFailure::Unreadable,
    }
}

fn reader(data: &[u8]) -> Result<ImageReader<Cursor<&[u8]>>, ImageFailure> {
    let mut reader = ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|_| ImageFailure::Unreadable)?;
    if reader.format().is_none() {
        return Err(ImageFailure::Unreadable);
    }
    reader.limits(limits());
    Ok(reader)
}

/// Whether an orientation turns the picture a quarter turn, swapping its width and height.
fn swaps_axes(orientation: Orientation) -> bool {
    matches!(
        orientation,
        Orientation::Rotate90
            | Orientation::Rotate270
            | Orientation::Rotate90FlipH
            | Orientation::Rotate270FlipH
    )
}

/// The picture's size as it will be drawn: its pixel size after the rotation its own
/// orientation tag asks for. A phone photograph is stored sideways with a tag saying so;
/// ignoring the tag draws it on its side.
pub(crate) fn probe(data: &[u8]) -> Result<ImageSize, ImageFailure> {
    let mut decoder = reader(data)?
        .into_decoder()
        .map_err(|error| failure(&error))?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 {
        return Err(ImageFailure::Unreadable);
    }
    if width > MAXIMUM_PIXEL_DIMENSION || height > MAXIMUM_PIXEL_DIMENSION {
        return Err(ImageFailure::TooLarge);
    }
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    Ok(if swaps_axes(orientation) {
        ImageSize {
            pixel_width: height,
            pixel_height: width,
        }
    } else {
        ImageSize {
            pixel_width: width,
            pixel_height: height,
        }
    })
}

/// A picture ready for the writer.
pub(crate) enum Embedded {
    /// A JPEG file, embedded as it is: the writer stores the compressed bytes.
    Jpeg(Vec<u8>),
    /// Raw pixels, four bytes each, which the writer compresses without loss.
    Pixels {
        data: Vec<u8>,
        width: u32,
        height: u32,
    },
}

/// Decode a picture, turn it upright, and scale it down to print resolution for the size it
/// is drawn at (`drawn_width` by `drawn_height` points).
///
/// A JPEG stays a JPEG: untouched when it needs neither turning nor scaling, re-encoded
/// otherwise. Every other format is embedded without loss, because those are the formats of
/// screenshots, scans and diagrams, where compression artefacts around text are visible.
pub(crate) fn embed(
    data: &[u8],
    drawn_width: f32,
    drawn_height: f32,
) -> Result<Embedded, ImageFailure> {
    let reader = reader(data)?;
    let is_jpeg = reader.format() == Some(ImageFormat::Jpeg);
    let mut decoder = reader.into_decoder().map_err(|error| failure(&error))?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder).map_err(|error| failure(&error))?;
    let turned = orientation != Orientation::NoTransforms;
    if turned {
        image.apply_orientation(orientation);
    }

    let target = |points: f32| -> u32 {
        let pixels = (points / 72.0 * EMBEDDED_PIXELS_PER_INCH).ceil();
        if pixels.is_finite() && pixels >= 1.0 {
            pixels.min(MAXIMUM_PIXEL_DIMENSION as f32) as u32
        } else {
            1
        }
    };
    let (target_width, target_height) = (target(drawn_width), target(drawn_height));
    let scaled = image.width() > target_width || image.height() > target_height;
    if scaled {
        // `resize` keeps the aspect ratio and fits inside the box it is given.
        image = image.resize(target_width, target_height, FilterType::Triangle);
    }

    if is_jpeg {
        let plain = matches!(
            image,
            DynamicImage::ImageRgb8(_) | DynamicImage::ImageLuma8(_)
        );
        if !turned && !scaled && plain {
            return Ok(Embedded::Jpeg(data.to_vec()));
        }
        let rgb = image.into_rgb8();
        let mut encoded = Vec::new();
        JpegEncoder::new_with_quality(&mut encoded, JPEG_QUALITY)
            .encode_image(&rgb)
            .map_err(|_| ImageFailure::Unreadable)?;
        return Ok(Embedded::Jpeg(encoded));
    }

    let rgba = image.into_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(Embedded::Pixels {
        data: rgba.into_raw(),
        width,
        height,
    })
}
