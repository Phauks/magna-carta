use image::{DynamicImage, ImageFormat, ImageReader};
use std::io::{BufReader, Cursor};

#[derive(Debug, PartialEq)]
pub enum ConvertError {
    UnsupportedFormat,
    Decode,
    Encode,
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

/// Transcode `bytes` from `source_format` to `target_format`, applying `_recipe`
/// (reserved for future per-recipe transforms such as resize or quality tuning).
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
) -> Result<(Vec<u8>, &'static str), ConvertError> {
    let source = image_format(source_format).ok_or(ConvertError::UnsupportedFormat)?;
    let destination = image_format(target_format).ok_or(ConvertError::UnsupportedFormat)?;

    // `ImageReader::new` requires `BufRead + Seek`; `Cursor` only implements
    // `Read + Seek`, so wrap it in a `BufReader`.
    let buffered = BufReader::new(Cursor::new(bytes));
    let mut reader = ImageReader::new(buffered);
    reader.set_format(source);
    reader.limits(decode_limits());
    let image: DynamicImage = reader.decode().map_err(|_| ConvertError::Decode)?;

    // Flatten alpha to RGB when encoding to JPEG, which has no alpha channel.
    let image = if destination == ImageFormat::Jpeg && image.color().has_alpha() {
        DynamicImage::ImageRgb8(image.into_rgb8())
    } else {
        image
    };

    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, destination)
        .map_err(|_| ConvertError::Encode)?;
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
        let (output, mime) = convert(&source, "png", "webp", "raster").expect("convert ok");
        assert_eq!(mime, "image/webp");
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::WebP).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (8, 5));
    }

    #[test]
    fn transcodes_png_rgba_to_jpeg_strips_alpha() {
        // JPEG has no alpha channel; the alpha flatten path must not error.
        let source = png_bytes(4, 4);
        let (output, mime) = convert(&source, "png", "jpeg", "raster").expect("png→jpeg ok");
        assert_eq!(mime, "image/jpeg");
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::Jpeg).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (4, 4));
    }

    #[test]
    fn rejects_unsupported_target_format() {
        let source = png_bytes(4, 4);
        assert!(matches!(
            convert(&source, "png", "mp4", "raster"),
            Err(ConvertError::UnsupportedFormat)
        ));
    }

    #[test]
    fn rejects_unsupported_source_format() {
        let source = png_bytes(4, 4);
        assert!(matches!(
            convert(&source, "mp4", "png", "raster"),
            Err(ConvertError::UnsupportedFormat)
        ));
    }

    #[test]
    fn rejects_malformed_source_bytes() {
        let garbage = [0u8, 1, 2, 3, 4, 5, 6, 7];
        assert!(convert(&garbage, "png", "webp", "raster").is_err());
    }
}
