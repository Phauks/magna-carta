use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, ImageReader};
use krilla::document::Document;
use krilla::geom::Size;
use krilla::image::Image;
use krilla::page::PageSettings;
use std::io::{BufReader, Cursor};

#[derive(Debug, PartialEq)]
pub enum ConvertError {
    UnsupportedFormat,
    Decode,
    Encode,
    /// A member's conversion option was malformed, out of range, or asked of a target that
    /// cannot honour it. Refused rather than ignored: a copy made without the asked-for setting
    /// would look like the setting had been applied.
    InvalidOption,
}

/// The smallest and largest longest side a member may ask an image to be scaled to. The ceiling
/// matches the decode limit, so a request can never ask for more pixels than a source may carry.
pub const MAX_DIMENSION_RANGE: std::ops::RangeInclusive<u32> = 16..=40_000;
/// JPEG quality, as the encoder takes it.
pub const QUALITY_RANGE: std::ops::RangeInclusive<u8> = 1..=100;

/// The member's choices for one conversion, read from the request's `x-max-dimension`,
/// `x-quality` and `x-grayscale` headers. All are optional, and an absent one leaves the copy as
/// a plain conversion would make it.
///
/// These are separate from the recipe on purpose. The recipe belongs to the conversion edge and
/// is the same for every job that crosses it; these belong to the job, and differ per request.
#[derive(Debug, Default, PartialEq)]
pub struct ConvertOptions {
    /// Scale the image down so its longest side is at most this many pixels. Never scales up.
    pub max_dimension: Option<u32>,
    /// JPEG quality from 1 to 100. Only a JPEG target accepts it.
    pub quality: Option<u8>,
    /// Drop the colour and keep the lightness.
    pub grayscale: bool,
}

impl ConvertOptions {
    /// Parse the three option headers' values. Anything malformed or out of range is
    /// `InvalidOption`, and so is a quality asked of a target that is not JPEG.
    pub fn parse(
        max_dimension: Option<&str>,
        quality: Option<&str>,
        grayscale: Option<&str>,
        target_format: &str,
    ) -> Result<Self, ConvertError> {
        let max_dimension = match max_dimension {
            None => None,
            Some(value) => {
                let parsed: u32 = value
                    .trim()
                    .parse()
                    .map_err(|_| ConvertError::InvalidOption)?;
                if !MAX_DIMENSION_RANGE.contains(&parsed) {
                    return Err(ConvertError::InvalidOption);
                }
                Some(parsed)
            }
        };
        let quality = match quality {
            None => None,
            Some(value) => {
                let parsed: u8 = value
                    .trim()
                    .parse()
                    .map_err(|_| ConvertError::InvalidOption)?;
                if !QUALITY_RANGE.contains(&parsed)
                    || image_format(target_format) != Some(ImageFormat::Jpeg)
                {
                    return Err(ConvertError::InvalidOption);
                }
                Some(parsed)
            }
        };
        let grayscale = match grayscale.map(str::trim) {
            None | Some("false") => false,
            Some("true") => true,
            Some(_) => return Err(ConvertError::InvalidOption),
        };
        Ok(Self {
            max_dimension,
            quality,
            grayscale,
        })
    }
}

/// Apply the size and colour choices to a decoded image. Resizing keeps the aspect ratio and only
/// ever shrinks: an image already within the limit is left at its own size, because enlarging
/// invents detail that was never in the source.
fn apply_options(image: DynamicImage, options: &ConvertOptions) -> DynamicImage {
    let image = match options.max_dimension {
        Some(limit) if image.width().max(image.height()) > limit => {
            image.resize(limit, limit, FilterType::Lanczos3)
        }
        _ => image,
    };
    if !options.grayscale {
        return image;
    }
    // Grey with transparency stays four-channel: not every encoder here writes grey-plus-alpha
    // (TIFF refuses it), and every one writes RGBA, which is what the plain path hands them.
    if image.color().has_alpha() {
        DynamicImage::ImageRgba8(image.grayscale().to_rgba8())
    } else {
        DynamicImage::ImageLuma8(image.to_luma8())
    }
}

/// Map a registry format identifier to the corresponding `image::ImageFormat`.
/// Returns `None` for any format we don't support, which the caller surfaces as
/// `ConvertError::UnsupportedFormat`.
fn image_format(identifier: &str) -> Option<ImageFormat> {
    Some(match identifier {
        "png" => ImageFormat::Png,
        "jpeg" | "jpg" => ImageFormat::Jpeg,
        "webp" => ImageFormat::WebP,
        "tiff" => ImageFormat::Tiff,
        "gif" => ImageFormat::Gif,
        "bmp" => ImageFormat::Bmp,
        _ => return None,
    })
}

fn mime_for(format: ImageFormat) -> &'static str {
    match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::WebP => "image/webp",
        ImageFormat::Tiff => "image/tiff",
        ImageFormat::Gif => "image/gif",
        ImageFormat::Bmp => "image/bmp",
        _ => "application/octet-stream",
    }
}

/// Build decoder limits that reject pixel/decompression bombs before allocation.
/// 512 MiB working set and 40 000 × 40 000 pixels are well above any legitimate
/// legal document image while blocking maliciously crafted inputs.
fn decode_limits() -> image::Limits {
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(512 * 1024 * 1024);
    limits.max_image_width = Some(40_000);
    limits.max_image_height = Some(40_000);
    limits
}

/// Decode `bytes` using `source_format` into a `DynamicImage`, applying the
/// pixel/decompression-bomb guard from `decode_limits`. Shared by both the
/// raster transcode path and the image-to-PDF path.
fn decode_source(bytes: &[u8], source_format: &str) -> Result<DynamicImage, ConvertError> {
    let format = image_format(source_format).ok_or(ConvertError::UnsupportedFormat)?;
    // `ImageReader::new` requires `BufRead + Seek`; `Cursor` only implements
    // `Read + Seek`, so wrap it in a `BufReader`.
    let buffered = BufReader::new(Cursor::new(bytes));
    let mut reader = ImageReader::new(buffered);
    reader.set_format(format);
    reader.limits(decode_limits());
    reader.decode().map_err(|_| ConvertError::Decode)
}

/// Render a single decoded image into a one-page PDF.
///
/// Page geometry: the longer side is fixed at 792.0 pt (the US Letter long edge)
/// and the shorter side is scaled proportionally. This preserves the image's
/// aspect ratio without distortion. If the image is square both sides are 792.0 pt.
///
/// The image is placed starting at the page origin (bottom-left in PDF coordinates)
/// and scaled to fill the entire page surface — one image, one page, no margins.
fn image_to_pdf(image: &DynamicImage) -> Result<Vec<u8>, ()> {
    let pixel_width = image.width();
    let pixel_height = image.height();

    // Compute page dimensions in points. The longer side is anchored at 792.0 pt.
    const LONG_SIDE_PT: f32 = 792.0;
    let (page_width_pt, page_height_pt) = if pixel_width >= pixel_height {
        let height = LONG_SIDE_PT * (pixel_height as f32 / pixel_width as f32);
        (LONG_SIDE_PT, height.max(1.0))
    } else {
        let width = LONG_SIDE_PT * (pixel_width as f32 / pixel_height as f32);
        (width.max(1.0), LONG_SIDE_PT)
    };

    let page_size = Size::from_wh(page_width_pt, page_height_pt).ok_or(())?;

    // Convert the decoded image to raw RGBA pixels — the channel layout that
    // `krilla::image::Image::from_rgba8` expects.
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    let krilla_image = Image::from_rgba8(rgba.into_raw(), width, height);

    let mut document = Document::new();
    let mut page = document.start_page_with(PageSettings::new(page_size));
    let mut surface = page.surface();
    // Draw the image scaled to cover the full page. `draw_image` places the image
    // anchored at the current origin; the `size` argument controls the rendered
    // dimensions in points.
    surface.draw_image(krilla_image, page_size);
    surface.finish();
    page.finish();

    document.finish().map_err(|_| ())
}

/// Transcode `bytes` from `source_format` to `target_format`, applying the member's `options`
/// (size, colour, and JPEG quality). `_recipe` is reserved for per-edge variants such as page
/// geometry.
///
/// Returns the encoded bytes and the canonical MIME type string for the target
/// format, or a `ConvertError` on unsupported format, decode failure, or encode
/// failure.
///
/// JPEG cannot carry an alpha channel. When the decoded image has alpha and the
/// target format is JPEG, the image is flattened to RGB before encoding (alpha is
/// composited against an opaque black background by `into_rgb8`).
pub fn convert(
    bytes: &[u8],
    source_format: &str,
    target_format: &str,
    _recipe: &str,
    options: &ConvertOptions,
) -> Result<(Vec<u8>, &'static str), ConvertError> {
    if target_format == "pdf" {
        if options.quality.is_some() {
            return Err(ConvertError::InvalidOption);
        }
        let image = apply_options(decode_source(bytes, source_format)?, options);
        let pdf = image_to_pdf(&image).map_err(|_| ConvertError::Encode)?;
        return Ok((pdf, "application/pdf"));
    }

    let destination = image_format(target_format).ok_or(ConvertError::UnsupportedFormat)?;
    let image = apply_options(decode_source(bytes, source_format)?, options);

    // Flatten alpha to RGB when encoding to JPEG, which has no alpha channel.
    let image = if destination == ImageFormat::Jpeg && image.color().has_alpha() {
        DynamicImage::ImageRgb8(image.into_rgb8())
    } else if destination == ImageFormat::Gif && image.color() == image::ColorType::L8 {
        // The GIF encoder writes only RGB and RGBA, so a grey image is widened for it.
        DynamicImage::ImageRgb8(image.into_rgb8())
    } else {
        image
    };

    let mut output = Cursor::new(Vec::new());
    match (destination, options.quality) {
        (ImageFormat::Jpeg, Some(quality)) => image
            .write_with_encoder(JpegEncoder::new_with_quality(&mut output, quality))
            .map_err(|_| ConvertError::Encode)?,
        _ => image
            .write_to(&mut output, destination)
            .map_err(|_| ConvertError::Encode)?,
    }
    Ok((output.into_inner(), mime_for(destination)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, RgbaImage};

    /// Build a small PNG from a solid-colour RGBA image. Used by tests that need
    /// a valid PNG byte sequence without committing binary fixtures.
    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let img = RgbaImage::from_pixel(width, height, image::Rgba([10, 20, 30, 255]));
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(img)
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    }

    #[test]
    fn transcodes_png_to_webp_preserving_dimensions() {
        let source = png_bytes(8, 5);
        let (output, mime) = convert(&source, "png", "webp", "raster", &ConvertOptions::default())
            .expect("convert ok");
        assert_eq!(mime, "image/webp");
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::WebP).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (8, 5));
    }

    #[test]
    fn transcodes_png_rgba_to_jpeg_strips_alpha() {
        // JPEG has no alpha channel; the alpha flatten path must not error.
        let source = png_bytes(4, 4);
        let (output, mime) = convert(&source, "png", "jpeg", "raster", &ConvertOptions::default())
            .expect("png→jpeg ok");
        assert_eq!(mime, "image/jpeg");
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::Jpeg).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (4, 4));
    }

    #[test]
    fn rejects_unsupported_target_format() {
        let source = png_bytes(4, 4);
        assert!(matches!(
            convert(&source, "png", "mp4", "raster", &ConvertOptions::default()),
            Err(ConvertError::UnsupportedFormat)
        ));
    }

    #[test]
    fn rejects_unsupported_source_format() {
        let source = png_bytes(4, 4);
        assert!(matches!(
            convert(&source, "mp4", "png", "raster", &ConvertOptions::default()),
            Err(ConvertError::UnsupportedFormat)
        ));
    }

    #[test]
    fn rejects_malformed_source_bytes() {
        let garbage = [0u8, 1, 2, 3, 4, 5, 6, 7];
        assert!(convert(
            &garbage,
            "png",
            "webp",
            "raster",
            &ConvertOptions::default()
        )
        .is_err());
    }

    #[test]
    fn wraps_png_into_a_single_page_pdf() {
        let src = png_bytes(120, 80); // existing test helper
        let (out, mime) = convert(&src, "png", "pdf", "image-pdf", &ConvertOptions::default())
            .expect("convert ok");
        assert_eq!(mime, "application/pdf");
        // Structural checks only — no PDF parser, to keep the dependency tree free of any C
        // compiler (a parser like lopdf transitively pulls chrono -> a Haiku-only `cc`). The
        // single-page property is an implementation guarantee of `image_to_pdf`, which adds
        // exactly one page; here we verify the output is a real, non-trivial PDF document.
        assert!(out.starts_with(b"%PDF-"), "PDF magic header");
        assert!(
            out.windows(5).any(|w| w == b"%%EOF"),
            "PDF EOF marker present"
        );
        assert!(out.len() > 500, "a PDF embedding the image is non-trivial");
    }

    /// A photograph-like source: a gradient, so JPEG quality has detail to spend bytes on.
    fn gradient_png(width: u32, height: u32) -> Vec<u8> {
        let img = RgbaImage::from_fn(width, height, |x, y| {
            image::Rgba([
                (x * 7 % 256) as u8,
                (y * 5 % 256) as u8,
                ((x + y) % 256) as u8,
                255,
            ])
        });
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(img)
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    }

    /// The same gradient with no alpha channel, as a JPEG source would decode.
    fn gradient_rgb_png(width: u32, height: u32) -> Vec<u8> {
        let decoded =
            image::load_from_memory_with_format(&gradient_png(width, height), ImageFormat::Png)
                .unwrap();
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(decoded.to_rgb8())
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    }

    fn options(max_dimension: Option<u32>, quality: Option<u8>, grayscale: bool) -> ConvertOptions {
        ConvertOptions {
            max_dimension,
            quality,
            grayscale,
        }
    }

    #[test]
    fn a_longest_side_limit_scales_down_keeping_the_aspect_ratio() {
        let source = png_bytes(400, 200);
        let (output, _) = convert(
            &source,
            "png",
            "png",
            "png",
            &options(Some(100), None, false),
        )
        .unwrap();
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::Png).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (100, 50));
    }

    #[test]
    fn a_longest_side_limit_never_enlarges_a_smaller_image() {
        let source = png_bytes(40, 20);
        let (output, _) = convert(
            &source,
            "png",
            "webp",
            "webp",
            &options(Some(1000), None, false),
        )
        .unwrap();
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::WebP).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (40, 20));
    }

    #[test]
    fn grayscale_drops_the_colour_for_every_raster_target() {
        let targets = [
            ("png", ImageFormat::Png),
            ("jpeg", ImageFormat::Jpeg),
            ("webp", ImageFormat::WebP),
            ("tiff", ImageFormat::Tiff),
            ("gif", ImageFormat::Gif),
            ("bmp", ImageFormat::Bmp),
        ];
        // Both a source with an alpha channel and one without, since they take different paths.
        for (source, (target, format)) in [gradient_png(16, 16), gradient_rgb_png(16, 16)]
            .iter()
            .flat_map(|source| targets.iter().map(move |target| (source, *target)))
        {
            let (output, _) = convert(source, "png", target, target, &options(None, None, true))
                .unwrap_or_else(|error| panic!("{target}: {error:?}"));
            let decoded = image::load_from_memory_with_format(&output, format)
                .unwrap()
                .to_rgb8();
            assert!(
                decoded.pixels().all(|pixel| {
                    let [red, green, blue] = pixel.0;
                    red.abs_diff(green) <= 2 && green.abs_diff(blue) <= 2
                }),
                "{target} copy still carries colour"
            );
        }
    }

    #[test]
    fn a_lower_jpeg_quality_makes_a_smaller_file() {
        let source = gradient_png(256, 256);
        let (high, _) = convert(
            &source,
            "png",
            "jpeg",
            "jpeg",
            &options(None, Some(95), false),
        )
        .unwrap();
        let (low, _) = convert(
            &source,
            "png",
            "jpeg",
            "jpeg",
            &options(None, Some(20), false),
        )
        .unwrap();
        assert!(
            low.len() < high.len(),
            "quality 20 ({}) should be smaller than 95 ({})",
            low.len(),
            high.len()
        );
    }

    #[test]
    fn options_shrink_and_grey_an_image_bound_for_pdf() {
        let source = gradient_png(600, 300);
        let (plain, _) = convert(
            &source,
            "png",
            "pdf",
            "image-pdf",
            &ConvertOptions::default(),
        )
        .unwrap();
        let (smaller, mime) = convert(
            &source,
            "png",
            "pdf",
            "image-pdf",
            &options(Some(60), None, true),
        )
        .unwrap();
        assert_eq!(mime, "application/pdf");
        assert!(smaller.starts_with(b"%PDF-"));
        assert!(smaller.len() < plain.len());
    }

    #[test]
    fn option_headers_parse_and_refuse_what_cannot_be_honoured() {
        assert_eq!(
            ConvertOptions::parse(Some("1200"), Some("80"), Some("true"), "jpeg"),
            Ok(options(Some(1200), Some(80), true))
        );
        assert_eq!(
            ConvertOptions::parse(None, None, None, "png"),
            Ok(ConvertOptions::default())
        );
        // Out of range, malformed, or a quality for a target that has none.
        for (max_dimension, quality, grayscale, target) in [
            (Some("8"), None, None, "png"),
            (Some("40001"), None, None, "png"),
            (Some("big"), None, None, "png"),
            (None, Some("0"), None, "jpeg"),
            (None, Some("101"), None, "jpeg"),
            (None, Some("80"), None, "png"),
            (None, Some("80"), None, "pdf"),
            (None, None, Some("yes"), "png"),
        ] {
            assert_eq!(
                ConvertOptions::parse(max_dimension, quality, grayscale, target),
                Err(ConvertError::InvalidOption),
                "{max_dimension:?} {quality:?} {grayscale:?} {target}"
            );
        }
    }

    #[test]
    fn pdf_target_still_rejects_a_malformed_source() {
        let garbage = [0u8, 1, 2, 3, 4, 5, 6, 7];
        assert!(convert(
            &garbage,
            "png",
            "pdf",
            "image-pdf",
            &ConvertOptions::default()
        )
        .is_err());
    }
}
